using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace BlazorECharts.Serialization;

/// <summary>Explicit option writers and custom data metadata used to prepare JSON without assembly scanning.</summary>
/// <remarks>Configure registrations before use. Concurrent registration or mutation of options during serialization is
/// unsupported.</remarks>
public sealed class EChartsSerializationContext
{
    private readonly Dictionary<Type, JsonTypeInfo> _data = [];
    private readonly Dictionary<Type, Action<Utf8JsonWriter, OptionObject, EChartsSerializationContext, string>> _options = [];

    // Each value is the registration's Func<JsonElement, EChartsSerializationContext, T> for its exact key type.
    private readonly Dictionary<Type, Delegate> _readers = [];

    private readonly List<JsBinding>? _bindings;
    private readonly Dictionary<string, Func<JsonElement, EChartsSerializationContext, SeriesOption>> _series = new(StringComparer.Ordinal);
    private readonly Dictionary<Type, Action<Utf8JsonWriter, Array, EChartsSerializationContext, string>> _unionArrays = [];

    // Mutable structured path of the value being written; a binding copies it.
    private readonly List<PathSegment> _segments = [];

    /// <summary>Creates an explicit serializer registry.</summary>
    public EChartsSerializationContext() { }

    private EChartsSerializationContext(EChartsSerializationContext source)
    {
        _data = source._data;
        _options = source._options;
        _readers = source._readers;
        _series = source._series;
        _unionArrays = source._unionArrays;
        Statistics = source.Statistics;
        AllowInlineJavaScript = source.AllowInlineJavaScript;
        ReferenceRuntimeId = source.ReferenceRuntimeId;
        _bindings = [];
    }

    /// <summary>Allows explicit inline descriptors. Module descriptors do not require this opt-in.</summary>
    public bool AllowInlineJavaScript { get => _allowInlineJavaScript; init => _allowInlineJavaScript = value; }

    private bool _allowInlineJavaScript;

    internal void SetInlinePolicy(bool allow) => _allowInlineJavaScript = allow;

    /// <summary>Gets the expected browser runtime identity for native references. Required when references are present.</summary>
    public string? ReferenceRuntimeId { get => _referenceRuntimeId; init => _referenceRuntimeId = value; }

    private string? _referenceRuntimeId;

    internal void SetReferenceRuntime(string runtimeId) => _referenceRuntimeId = runtimeId;

    internal EChartsSerializationContext CreatePreparation() => new(this);

    // A getOption snapshot keeps a series of an unregistered extension as RawSeriesOption instead of failing.
    internal EChartsSerializationContext CreateSnapshotReader() => new(this) { _rawUnknownSeries = true };

    private bool _rawUnknownSeries;

    // An event payload reader defers a nested payload field it cannot read to that property's getter.
    internal EChartsSerializationContext CreateEventReader() => new(this) { _defersFieldErrors = true, _readOnly = true };

    private bool _defersFieldErrors;

    internal bool DefersFieldErrors => _defersFieldErrors;
    internal SerializationStatistics Statistics { get; } = new();
    internal IEnumerable<JsBinding> Bindings => _bindings ?? [];

    private bool _readOnly;

    internal void MakeReadOnly() => _readOnly = true;

    private void ThrowIfReadOnly()
    {
        if (_readOnly)
            throw new InvalidOperationException("This shared serialization context is read-only. Register types on a context from OptionMetadata.CreateContext.");
    }

    /// <summary>Registers custom CLR data metadata. Use a source-generated context for trimming and AOT.</summary>
    /// <remarks>Registration applies to the exact runtime type. Nested custom contracts are governed by the supplied
    /// metadata.</remarks>
    public void Register<T>(JsonTypeInfo<T> typeInfo)
    {
        ArgumentNullException.ThrowIfNull(typeInfo);
        ThrowIfReadOnly();
        if (!_data.TryAdd(typeof(T), typeInfo))
            throw new InvalidOperationException($"JSON metadata for '{typeof(T).FullName}' is already registered.");
    }

    /// <summary>Registers the typed-property writer and the optional reader for an exact option model type.</summary>
    public void Register<T>(OptionTypeRegistration<T> registration) where T : OptionObject
    {
        ArgumentNullException.ThrowIfNull(registration);
        ThrowIfReadOnly();
        if (!_options.TryAdd(typeof(T), (writer, value, context, path) => registration.WriteProperties(writer, (T)value, context, path)))
            throw new InvalidOperationException($"Option writer for '{typeof(T).FullName}' is already registered.");

        if (registration.Read is { } read)
            _readers.Add(typeof(T), read);
    }

    /// <summary>Reads an exact registered option model, such as a core model nested in an extension model.</summary>
    /// <remarks>Readers retain unknown JSON fields as <see cref="OptionObject.AdditionalProperties"/>. Use
    /// <see cref="ReadSeries"/> for a series of any registered type.</remarks>
    /// <exception cref="InvalidOperationException">No reader is registered for <typeparamref name="T"/>.</exception>
    /// <exception cref="JsonException">The JSON does not match the model.</exception>
    public T Read<T>(JsonElement json) where T : OptionObject
    {
        if (!_readers.TryGetValue(typeof(T), out var read))
            throw new InvalidOperationException($"No option reader for CLR type '{typeof(T).FullName}'. Register an OptionTypeRegistration<T> with a reader.");

        // Free inside a read; JSON of a disposable document is copied once instead of value by value.
        return ((Func<JsonElement, EChartsSerializationContext, T>)read)(json.Clone(), this);
    }

    // Generated for every array of a union: a typed loop writes the items without boxing each one through Array.GetValue.
    internal void RegisterUnionArray<T>() where T : struct, IScalarOptionValue
    {
        ThrowIfReadOnly();
        _unionArrays[typeof(T?[])] = static (writer, items, context, path) => context.WriteUnionArray(writer, (T?[])items, path);
    }

    private void WriteUnionArray<T>(Utf8JsonWriter writer, T?[] items, string path) where T : struct, IScalarOptionValue
    {
        writer.WriteStartArray();
        for (var i = 0; i < items.Length; i++)
        {
            if (items[i] is not { } item)
                writer.WriteNullValue();
            else if (!item.TryWriteScalar(writer, this))
                WriteArrayItem(writer, item, path, i);
        }

        writer.WriteEndArray();
    }

    /// <summary>Registers a series writer and an explicit discriminator reader, including consumer extensions.</summary>
    public void RegisterSeries<T>(string discriminator, OptionTypeRegistration<T> registration) where T : SeriesOption
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(discriminator);
        ArgumentNullException.ThrowIfNull(registration);
        ThrowIfReadOnly();
        if (registration.Read is null)
            throw new ArgumentException("A series registration requires a reader factory.", nameof(registration));

        if (_series.ContainsKey(discriminator))
            throw new InvalidOperationException($"Series discriminator '{discriminator}' is already registered.");

        Register(registration);
        _series.Add(discriminator, (json, context) => registration.Read(json, context));
    }

    /// <summary>Reads a registered series. Unknown discriminators require explicit registration or
    /// RawSeriesOption.FromJson.</summary>
    public SeriesOption ReadSeries(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String)
            throw new JsonException("A series requires a string type discriminator.");

        var discriminator = type.GetString()!;
        if (!_series.TryGetValue(discriminator, out var read))
        {
            if (_rawUnknownSeries)
                return RawSeriesOption.FromJson(json);

            throw new JsonException($"Unregistered series discriminator '{discriminator}'. Register its factory or explicitly use RawSeriesOption.FromJson.");
        }

        var series = read(json.Clone(), this);
        if (series.Type != discriminator)
            throw new JsonException("The series factory returned a different discriminator.");

        return series;
    }

    /// <summary>Writes an assigned typed property using its exact JSON name and propagates the public path.</summary>
    public void WriteProperty(Utf8JsonWriter writer, OptionObject options, string jsonName, object? value, string path)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(jsonName);
        ArgumentNullException.ThrowIfNull(path);
        if (!options.IsAssigned(jsonName))
            return;

        WritePropertyValue(writer, value, path, jsonName);
    }

    /// <summary>Writes a JSON value, registered option, one-dimensional array, or explicitly registered CLR value.</summary>
    /// <remarks>Undefined JSON, non-finite numbers, uninitialized unions and unregistered CLR types are errors. No
    /// reflection fallback is used.</remarks>
    public void WriteValue(Utf8JsonWriter writer, object? value, string path)
    {
        ArgumentNullException.ThrowIfNull(writer);
        ArgumentNullException.ThrowIfNull(path);
        try
        {
            switch (value)
            {
                case null:
                    writer.WriteNullValue();
                    break;
                case JsFunction function:
                    EnsurePreparation(path);
                    if (function.Kind == JsBindingKind.Inline && !AllowInlineJavaScript)
                        throw new OptionSerializationException(
                            $"Inline JavaScript at {path} requires AllowInlineJavaScript=true. Use JsFunction.Module for the default module policy.",
                            path,
                            value.GetType());

                    _bindings!.Add(
                        new JsBinding(
                            JsBindingPath.From(_segments),
                            "binding:" + _bindings.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                            function));
                    writer.WriteNullValue();
                    break;
                case EChartsObjectReference reference:
                    EnsurePreparation(path);
                    reference.Validate(ReferenceRuntimeId);
                    _bindings!.Add(new JsBinding(JsBindingPath.From(_segments), reference));
                    writer.WriteNullValue();
                    break;
                case IOptionValue optionValue:
                    optionValue.Write(writer, this, path);
                    break;
                case OptionObject options:
                    WriteOptions(writer, options, path);
                    break;
                case JsonElement json when json.ValueKind != JsonValueKind.Undefined:
                    json.WriteTo(writer);
                    break;
                case object registered when _data.TryGetValue(registered.GetType(), out var metadata):
                    JsonSerializer.Serialize(writer, registered, metadata);
                    break;
                case string text:
                    writer.WriteStringValue(text);
                    break;
                case bool flag:
                    writer.WriteBooleanValue(flag);
                    break;
                case byte number:
                    writer.WriteNumberValue(number);
                    break;
                case sbyte number:
                    writer.WriteNumberValue(number);
                    break;
                case short number:
                    writer.WriteNumberValue(number);
                    break;
                case ushort number:
                    writer.WriteNumberValue(number);
                    break;
                case int number:
                    writer.WriteNumberValue(number);
                    break;
                case uint number:
                    writer.WriteNumberValue(number);
                    break;
                case long number:
                    writer.WriteNumberValue(number);
                    break;
                case ulong number:
                    writer.WriteNumberValue(number);
                    break;
                case decimal number:
                    writer.WriteNumberValue(number);
                    break;
                case float number:
                    if (!float.IsFinite(number))
                        throw new OptionSerializationException(NonFiniteMessage(number, "at " + path), path, typeof(float));

                    writer.WriteNumberValue(number);
                    break;
                case double number:
                    if (!double.IsFinite(number))
                        throw new OptionSerializationException(NonFiniteMessage(number, "at " + path), path, typeof(double));

                    writer.WriteNumberValue(number);
                    break;
                case DateTime date:
                    writer.WriteStringValue(EChartsDate.Format(date));
                    break;
                case DateTimeOffset date:
                    writer.WriteStringValue(EChartsDate.Format(date));
                    break;
                case DateOnly date:
                    writer.WriteStringValue(EChartsDate.Format(date));
                    break;
                case double[] numbers when !_data.ContainsKey(typeof(double)):
                    writer.WriteStartArray();
                    for (var i = 0; i < numbers.Length; i++)
                        WriteFinite(writer, numbers[i], path, i);

                    writer.WriteEndArray();
                    break;
                case double?[] numbers when !_data.ContainsKey(typeof(double)):
                    writer.WriteStartArray();
                    for (var i = 0; i < numbers.Length; i++)
                        if (numbers[i] is { } number)
                            WriteFinite(writer, number, path, i);
                        else
                            writer.WriteNullValue();

                    writer.WriteEndArray();
                    break;
                case string?[] texts when !_data.ContainsKey(typeof(string)):
                    writer.WriteStartArray();
                    foreach (var text in texts)
                        if (text is null)
                            writer.WriteNullValue();
                        else
                            writer.WriteStringValue(text);

                    writer.WriteEndArray();
                    break;
                case Array array when _unionArrays.TryGetValue(array.GetType(), out var writeUnions):
                    writeUnions(writer, array, this, path);
                    break;
                case Array array when array.Rank == 1 && array.GetLowerBound(0) == 0:
                    writer.WriteStartArray();
                    for (var i = 0; i < array.Length; i++)
                        WriteArrayItem(writer, array.GetValue(i), path, i);

                    writer.WriteEndArray();
                    break;
                default:
                    throw new OptionSerializationException(
                        $"No JSON metadata for CLR type '{value.GetType().FullName}' at {path}. Register<T>(JsonTypeInfo<T>) for custom data.", path, value.GetType());
            }
        }
        catch (JsonException error)
        {
            var errorType = error is NestedOptionValueException unsupported ? unsupported.ClrType : value?.GetType();

            // STJ may report CLR member names, or omit its path on a generated fast path.
            // The custom value's transport path is exact; preserve STJ's diagnostic in the inner exception.
            throw new OptionSerializationException(
                $"Invalid JSON value of CLR type '{errorType?.FullName}' at {path}: {error.Message}",
                path,
                errorType,
                error);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            throw new OptionSerializationException(
                $"Cannot serialize CLR type '{value?.GetType().FullName}' at {path}: {error.Message}",
                path,
                value?.GetType(),
                error);
        }
    }

    private void WriteOptions(Utf8JsonWriter writer, OptionObject options, string path)
    {
        if (!_options.TryGetValue(options.GetType(), out var writeProperties))
            throw new OptionSerializationException(
                $"No option writer for CLR type '{options.GetType().FullName}' at {path}. Register an OptionTypeRegistration<T>.",
                path,
                options.GetType());

        var additional = options.AdditionalProperties.Count == 0
            ? []
            : options.AdditionalProperties.OrderBy(pair => pair.Key, StringComparer.Ordinal).ToArray();
        foreach (var (key, _) in additional)
        {
            if (options.IsAssigned(key))
            {
                var collisionPath = PropertyPath(path, key);
                throw new OptionSerializationException(
                    $"Additional property conflicts with an assigned typed property at {collisionPath}.",
                    collisionPath,
                    options.GetType());
            }
        }

        writer.WriteStartObject();
        writeProperties(writer, options, this, path);
        foreach (var (key, value) in additional)
        {
            WritePropertyValue(writer, value, path, key);
        }

        writer.WriteEndObject();
    }

    internal void WritePropertyValue(Utf8JsonWriter writer, object? value, string path, string name)
    {
        writer.WritePropertyName(name);
        WriteChild(writer, value, path, new(name, 0));
    }

    /// <summary>Writes an array item and records its numeric binding path segment. Call inside array delimiters.</summary>
    public void WriteArrayItem(Utf8JsonWriter writer, object? value, string path, int index)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(index);
        WriteChild(writer, value, path, new(null, index));
    }

    // Scalars need neither the child path text nor a path segment unless they fail, so they skip both.
    private void WriteChild(Utf8JsonWriter writer, object? value, string parent, PathSegment segment)
    {
        if (TryWriteScalar(writer, value))
            return;

        var path = segment.Name is { } name ? PropertyPath(parent, name) : IndexPath(parent, segment.Index);
        _segments.Add(segment);
        try
        {
            WriteValue(writer, value, path);
        }
        finally
        {
            _segments.RemoveAt(_segments.Count - 1);
        }
    }

    internal bool TryWriteScalar(Utf8JsonWriter writer, object? value)
    {
        switch (value)
        {
            case null:
                writer.WriteNullValue();
                return true;
            case IScalarOptionValue scalar:
                return scalar.TryWriteScalar(writer, this);
            case JsonElement json when json.ValueKind is not (JsonValueKind.Undefined or JsonValueKind.Object or JsonValueKind.Array):
                json.WriteTo(writer);
                return true;
        }

        if (_data.Count != 0 && _data.ContainsKey(value.GetType()))
            return false;

        switch (value)
        {
            case double number when double.IsFinite(number):
                writer.WriteNumberValue(number);
                return true;
            case string text:
                writer.WriteStringValue(text);
                return true;
            case bool flag:
                writer.WriteBooleanValue(flag);
                return true;
            case int number:
                writer.WriteNumberValue(number);
                return true;
            case long number:
                writer.WriteNumberValue(number);
                return true;
            case DateTimeOffset date:
                writer.WriteStringValue(EChartsDate.Format(date));
                return true;
            default:
                return false;
        }
    }

    private static void WriteFinite(Utf8JsonWriter writer, double number, string path, int index)
    {
        if (!double.IsFinite(number))
        {
            var item = IndexPath(path, index);
            throw new OptionSerializationException(NonFiniteMessage(number, "at " + item), item, typeof(double));
        }

        writer.WriteNumberValue(number);
    }

    private void EnsurePreparation(string path)
    {
        if (_bindings is null || _segments.Count == 0)
            throw new OptionSerializationException(
                $"Binding at {path} requires OptionSerializer preparation at a structured property/index path.",
                path);
    }

    internal static string PropertyPath(string path, string name)
    {
        var identifier = name.Length > 0 && (char.IsAsciiLetter(name[0]) || name[0] is '_' or '$');
        for (var i = 1; identifier && i < name.Length; i++)
            identifier = char.IsAsciiLetterOrDigit(name[i]) || name[i] is '_' or '$';

        return identifier ? path + "." + name : path + "[\"" + JsonEncodedText.Encode(name) + "\"]";
    }

    internal static string NonFiniteMessage(double value, string? location = null, string remedy = "use null or \"-\" for a missing value") =>
        $"The number {(double.IsNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity")}{(location is null ? "" : " " + location)} has no JSON form; {remedy}.";

    // Hand-written method and export DTOs have no "-" form for a missing number.
    internal static void WriteFiniteNumber(Utf8JsonWriter writer, string name, double value, string path)
    {
        if (!double.IsFinite(value))
        {
            var member = PropertyPath(path, name);
            throw new OptionSerializationException(NonFiniteMessage(value, "at " + member, "use null to omit the option"), member, typeof(double));
        }

        writer.WriteNumber(name, value);
    }

    internal static string IndexPath(string path, int index) => path + "[" + index.ToString(System.Globalization.CultureInfo.InvariantCulture) + "]";
}
