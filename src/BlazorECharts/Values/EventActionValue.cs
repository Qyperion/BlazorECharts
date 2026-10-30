using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Values;

/// <summary>An explicit JSON union for source-defined event/action alternatives, with shape validation.</summary>
public readonly struct EventActionValue : IOptionValue
{
    private readonly JsonElement _json;
    private readonly JsFunction? _function;

    private EventActionValue(JsonElement json)
    {
        _json = json.Clone();
        _function = null;
    }

    private EventActionValue(JsFunction function)
    {
        _json = default;
        _function = function;
    }

    /// <summary>Gets the complete JSON value, including nested unknown fields.</summary>
    public JsonElement Json => _function is null ? _json : throw new InvalidOperationException("A function descriptor is not ordinary JSON.");

    /// <summary>Creates a numeric alternative.</summary>
    public static EventActionValue From(double value)
    {
        if (!double.IsFinite(value))
            throw new ArgumentOutOfRangeException(nameof(value), EChartsSerializationContext.NonFiniteMessage(value));

        return Create(w => w.WriteNumberValue(value));
    }

    /// <summary>Creates a string alternative.</summary>
    public static EventActionValue From(string value) => Create(w => w.WriteStringValue(value));

    /// <summary>Creates a boolean alternative.</summary>
    public static EventActionValue From(bool value) => Create(w => w.WriteBooleanValue(value));

    /// <summary>Creates an exact array, including mixed identifier or coordinate alternatives.</summary>
    public static EventActionValue Array(params EventActionValue[] values) => Create(w =>
    {
        w.WriteStartArray();
        foreach (var value in values)
            value.Json.WriteTo(w);

        w.WriteEndArray();
    });

    /// <summary>Captures an explicitly registered nested DTO such as ChartTooltipBoxLayout.</summary>
    public static EventActionValue From(OptionObject value, EChartsSerializationContext? context = null)
    {
        var prepared = OptionSerializer.Serialize(value, context ?? GeneratedOptionMetadata.CreateContext());
        if (prepared.Bindings.Count != 0)
            throw new NotSupportedException("Nested union DTO bindings require the binding bridge.");

        return FromJson(prepared.Json);
    }

    /// <summary>Creates the exact tooltip position function alternative without executing JavaScript.</summary>
    public static EventActionValue From(JsFunction<TooltipPositionCallback> function) =>
        new(function ?? throw new ArgumentNullException(nameof(function)));

    /// <summary>Creates a numeric array alternative.</summary>
    public static EventActionValue From(double[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        EnsureFinite(values, nameof(values));
        return Create(w => WriteNumbers(w, values));
    }

    /// <summary>Creates a string array alternative, such as several ids or names.</summary>
    public static EventActionValue From(string[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        foreach (var value in values)
            ArgumentNullException.ThrowIfNull(value, nameof(values));

        return Create(w =>
        {
            w.WriteStartArray();
            foreach (var value in values)
                w.WriteStringValue(value);

            w.WriteEndArray();
        });
    }

    /// <summary>Creates a numeric matrix alternative, such as a brush range or an interval list.</summary>
    public static EventActionValue From(double[][] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        for (var i = 0; i < values.Length; i++)
        {
            ArgumentNullException.ThrowIfNull(values[i], nameof(values));
            EnsureFinite(values[i], $"{nameof(values)}[{i}]");
        }

        return Create(w =>
        {
            w.WriteStartArray();
            foreach (var row in values)
                WriteNumbers(w, row);

            w.WriteEndArray();
        });
    }

    /// <summary>Reads the numeric alternative.</summary>
    public bool TryGetNumber(out double value)
    {
        value = 0;
        if (Kind != JsonValueKind.Number)
            return false;

        value = _json.GetDouble();
        return true;
    }

    /// <summary>Reads the string alternative.</summary>
    public bool TryGetString([NotNullWhen(true)] out string? value)
    {
        value = Kind == JsonValueKind.String ? _json.GetString() : null;
        return value is not null;
    }

    /// <summary>Reads the boolean alternative.</summary>
    public bool TryGetBoolean(out bool value)
    {
        value = Kind == JsonValueKind.True;
        return Kind is JsonValueKind.True or JsonValueKind.False;
    }

    /// <summary>Reads an array whose items are all numbers.</summary>
    public bool TryGetNumbers([NotNullWhen(true)] out double[]? values)
    {
        values = Kind == JsonValueKind.Array ? ReadNumbers(_json) : null;
        return values is not null;
    }

    /// <summary>Reads an array whose items are all strings.</summary>
    public bool TryGetStrings([NotNullWhen(true)] out string[]? values)
    {
        values = null;
        if (Kind != JsonValueKind.Array)
            return false;

        var items = new string[_json.GetArrayLength()];
        var i = 0;
        foreach (var item in _json.EnumerateArray())
            if (item.ValueKind != JsonValueKind.String)
                return false;
            else
                items[i++] = item.GetString()!;

        values = items;
        return true;
    }

    /// <summary>Reads an array whose items are all numeric arrays.</summary>
    public bool TryGetNumberMatrix([NotNullWhen(true)] out double[][]? values)
    {
        values = null;
        if (Kind != JsonValueKind.Array)
            return false;

        var rows = new double[_json.GetArrayLength()][];
        var i = 0;
        foreach (var item in _json.EnumerateArray())
            if (item.ValueKind != JsonValueKind.Array || ReadNumbers(item) is not { } row)
                return false;
            else
                rows[i++] = row;

        values = rows;
        return true;
    }

    /// <summary>Reads an object whose values are all booleans, such as a selection map; false entries are retained.</summary>
    public bool TryGetBooleanMap([NotNullWhen(true)] out IReadOnlyDictionary<string, bool>? values)
    {
        values = null;
        if (Kind != JsonValueKind.Object)
            return false;

        var map = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var property in _json.EnumerateObject())
            if (property.Value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return false;
            else
                map[property.Name] = property.Value.GetBoolean();

        values = map;
        return true;
    }

    private JsonValueKind Kind => _function is null ? _json.ValueKind : JsonValueKind.Undefined;

    private static double[]? ReadNumbers(JsonElement json)
    {
        var numbers = new double[json.GetArrayLength()];
        var i = 0;
        foreach (var item in json.EnumerateArray())
            if (item.ValueKind != JsonValueKind.Number)
                return null;
            else
                numbers[i++] = item.GetDouble();

        return numbers;
    }

    private static void EnsureFinite(double[] values, string name)
    {
        for (var i = 0; i < values.Length; i++)
            if (!double.IsFinite(values[i]))
                throw new ArgumentOutOfRangeException(name.Split('[')[0], EChartsSerializationContext.NonFiniteMessage(values[i], $"in {name}[{i}]"));
    }

    private static void WriteNumbers(Utf8JsonWriter writer, double[] values)
    {
        writer.WriteStartArray();
        foreach (var value in values)
            writer.WriteNumberValue(value);

        writer.WriteEndArray();
    }

    /// <summary>Converts a numeric alternative.</summary>
    public static implicit operator EventActionValue(double value) => From(value);

    /// <summary>Converts a string alternative.</summary>
    public static implicit operator EventActionValue(string value) => From(value);

    /// <summary>Converts a boolean alternative.</summary>
    public static implicit operator EventActionValue(bool value) => From(value);

    /// <summary>Converts a numeric array alternative, such as several indices.</summary>
    public static implicit operator EventActionValue(double[] values) => From(values);

    /// <summary>Converts a string array alternative, such as several ids or names.</summary>
    public static implicit operator EventActionValue(string[] values) => From(values);

    private static EventActionValue Create(Action<Utf8JsonWriter> write)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
            write(writer);

        using var json = JsonDocument.Parse(stream.ToArray());
        return FromJson(json.RootElement);
    }

    /// <summary>Clones a JSON value. Validation against the property union occurs at assignment.</summary>
    public static EventActionValue FromJson(JsonElement json)
    {
        if (json.ValueKind == JsonValueKind.Undefined)
            throw new ArgumentException("Undefined JSON is not a value.", nameof(json));

        return new(json);
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string[]> s_alternatives = new(StringComparer.Ordinal);

    /// <summary>Validates every array element against the documented alternatives.</summary>
    internal void Validate(string alternatives)
    {
        if (_function is not null)
        {
            if (s_alternatives.GetOrAdd(alternatives, static value => value.Split('|')).Contains("function", StringComparer.Ordinal))
                return;

            throw new ArgumentException($"A function is not an alternative of {alternatives}.");
        }

        var json = _json;
        if (json.ValueKind == JsonValueKind.Null)
            return;

        if (s_alternatives.GetOrAdd(alternatives, static value => value.Split('|')).Any(a => Matches(json, a)))
            return;

        throw new ArgumentException($"Expected {alternatives}; received {json.ValueKind}.");
    }

    private static bool Matches(JsonElement json, string alternative) => alternative.EndsWith("[]", StringComparison.Ordinal)
        ? json.ValueKind == JsonValueKind.Array && json.EnumerateArray().All(e => Matches(e, alternative[..^2]))
        : alternative switch
        {
            "unknown" => true,
            "id" => json.ValueKind is JsonValueKind.String or JsonValueKind.Number,
            "false" => json.ValueKind == JsonValueKind.False,
            "all" => json.ValueKind == JsonValueKind.String && json.GetString() == "all",
            "none" => json.ValueKind == JsonValueKind.String && json.GetString() == "none",
            "auto" => json.ValueKind == JsonValueKind.String && json.GetString() == "auto",
            "click" or "mousemove" or "leave" or "mousewheel" or "rollUp" or "drillDown" or "main" or "node" or "edge" or
            "line" or "bar" or "stack" or "tiled" or "geo" or "series" or
            "polygon" or "rect" or "lineX" or "lineY" or "single" or "multiple" => json.ValueKind == JsonValueKind.String
                && json.GetString() == alternative,
            "string" => json.ValueKind == JsonValueKind.String,
            "number" => json.ValueKind == JsonValueKind.Number,
            "boolean" => json.ValueKind is JsonValueKind.True or JsonValueKind.False,
            "object" => json.ValueKind == JsonValueKind.Object,
            _ => false,
        };

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        if (_function is null)
            _json.WriteTo(writer);
        else
            context.WriteValue(writer, _function, path);
    }
}
