using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Runtime;

internal static class MethodJson
{
    internal static bool IsNumber(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number
        || (value.ValueKind == JsonValueKind.Object
            && value.EnumerateObject().Count() == 1
            && value.TryGetProperty("$number", out var number)
            && number.ValueKind == JsonValueKind.String
            && number.GetString() is "NaN" or "Infinity" or "-Infinity");

    internal static double Number(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number
            ? value.GetDouble()
            : IsNumber(value)
                ? value.GetProperty("$number").GetString() switch
                {
                    "NaN" => double.NaN,
                    "Infinity" => double.PositiveInfinity,
                    _ => double.NegativeInfinity,
                }
                : throw new JsonException("Expected a native numeric result.");

    internal static void WriteNumber(Utf8JsonWriter writer, double value)
    {
        if (double.IsFinite(value))
            writer.WriteNumberValue(value);
        else
        {
            writer.WriteStartObject();
            writer.WriteString("$number", double.IsNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity");
            writer.WriteEndObject();
        }
    }

    internal static JsonElement Create(Action<Utf8JsonWriter> write)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
            write(writer);

        using var json = JsonDocument.Parse(stream.ToArray());
        return json.RootElement.Clone();
    }
}

/// <summary>A native ModelFinder string or selector object. Selectors retain all/none/false and identifier arrays.</summary>
public sealed class ChartFinder : IOptionValue
{
    private ChartFinder(JsonElement json) => Json = json.Clone();

    /// <summary>Gets the captured native finder.</summary>
    public JsonElement Json { get; }

    /// <summary>Selects the first component of a native main type.</summary>
    public static ChartFinder Component(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return new(MethodJson.Create(w => w.WriteStringValue(name)));
    }

    /// <summary>Selects components by native index, ID and name, optionally narrowing to a data item.</summary>
    public static ChartFinder Select(
        string component,
        EventActionValue? index = null,
        EventActionValue? id = null,
        EventActionValue? name = null,
        int? dataIndex = null,
        int? dataIndexInside = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(component);
        index?.Validate("number|number[]|all|none|false");
        id?.Validate("id|id[]");
        name?.Validate("id|id[]");
        return new(MethodJson.Create(w =>
        {
            w.WriteStartObject();
            if (!index.HasValue && !id.HasValue && !name.HasValue)
                w.WriteNumber(component + "Index", 0);

            if (index is { } i)
            {
                w.WritePropertyName(component + "Index");
                i.Json.WriteTo(w);
            }

            if (id is { } d)
            {
                w.WritePropertyName(component + "Id");
                d.Json.WriteTo(w);
            }

            if (name is { } n)
            {
                w.WritePropertyName(component + "Name");
                n.Json.WriteTo(w);
            }

            if (dataIndex.HasValue)
                w.WriteNumber("dataIndex", dataIndex.Value);

            if (dataIndexInside.HasValue)
                w.WriteNumber("dataIndexInside", dataIndexInside.Value);

            w.WriteEndObject();
        }));
    }

    /// <summary>Adds selectors of another component, e.g. <c>{xAxisIndex: 2, yAxisId: 'y1'}</c>. A string finder
    /// expands to its first component. Repeating a key is an error.</summary>
    public ChartFinder And(string component, EventActionValue? index = null, EventActionValue? id = null, EventActionValue? name = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(component);
        if (component == "data")
            throw new ArgumentException("ECharts reserves the data prefix for data item selectors.", nameof(component));

        index?.Validate("number|number[]|all|none|false");
        id?.Validate("id|id[]");
        name?.Validate("id|id[]");
        var added = new List<(string Key, JsonElement? Value)>();
        if (!index.HasValue && !id.HasValue && !name.HasValue)
            added.Add((component + "Index", null));

        if (index is { } i)
            added.Add((component + "Index", i.Json));

        if (id is { } d)
            added.Add((component + "Id", d.Json));

        if (name is { } n)
            added.Add((component + "Name", n.Json));

        HashSet<string> existing = Json.ValueKind == JsonValueKind.String
            ? [Json.GetString() + "Index"]
            : Json.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        foreach (var (key, _) in added)
            if (existing.Contains(key))
                throw new ArgumentException($"The finder already selects {key}.", nameof(component));

        return new(MethodJson.Create(w =>
        {
            w.WriteStartObject();
            if (Json.ValueKind == JsonValueKind.String)
                w.WriteNumber(Json.GetString() + "Index", 0);
            else
                foreach (var property in Json.EnumerateObject())
                    property.WriteTo(w);

            foreach (var (key, value) in added)
                if (value is { } json)
                {
                    w.WritePropertyName(key);
                    json.WriteTo(w);
                }
                else
                    w.WriteNumber(key, 0);

            w.WriteEndObject();
        }));
    }

    /// <summary>Clones an explicit native finder, including extension selectors.</summary>
    public static ChartFinder FromJson(JsonElement json)
    {
        if (json.ValueKind is not (JsonValueKind.String or JsonValueKind.Object))
            throw new ArgumentException("A finder must be a string or object.", nameof(json));

        return new(json);
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path) => Json.WriteTo(writer);
}

/// <summary>An OptionDataValue or native coordinate array, including matrix ranges and null entries.</summary>
public readonly struct CoordinateValue : IOptionValue
{
    private readonly JsonElement _json;

    private CoordinateValue(JsonElement json) => _json = json;

    /// <summary>Creates a number coordinate.</summary>
    public static CoordinateValue From(double value) => new(MethodJson.Create(w => MethodJson.WriteNumber(w, value)));

    /// <summary>Creates an ordinal or time string coordinate.</summary>
    public static CoordinateValue From(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new(MethodJson.Create(w => w.WriteStringValue(value)));
    }

    /// <summary>Creates a native JavaScript Date coordinate without treating ordinary strings as code.</summary>
    public static CoordinateValue From(DateTimeOffset value) => new(MethodJson.Create(w =>
    {
        w.WriteStartObject();
        w.WriteNumber("$date", value.ToUnixTimeMilliseconds());
        w.WriteEndObject();
    }));

    /// <summary>Creates a date coordinate as option data does: a Utc or Local value is that instant; an Unspecified
    /// value is a wall-clock time without offset, which ECharts reads in the browser's time zone.</summary>
    public static CoordinateValue From(DateTime value) => value.Kind == DateTimeKind.Unspecified
        ? new(MethodJson.Create(w => w.WriteStringValue(EChartsDate.Format(value)))) : From(new DateTimeOffset(value));

    /// <summary>Creates a date coordinate as yyyy-MM-dd, which ECharts reads as midnight in the browser's time zone.</summary>
    public static CoordinateValue From(DateOnly value) => new(MethodJson.Create(w => w.WriteStringValue(EChartsDate.Format(value))));

    /// <summary>Creates an array without collapsing singleton arrays.</summary>
    public static CoordinateValue Array(params CoordinateValue[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return new(MethodJson.Create(w =>
        {
            w.WriteStartArray();
            foreach (var v in values)
                v.Write(w);

            w.WriteEndArray();
        }));
    }

    /// <summary>Converts a numeric coordinate.</summary>
    public static implicit operator CoordinateValue(double value) => From(value);

    /// <summary>Converts a string coordinate.</summary>
    public static implicit operator CoordinateValue(string value) => From(value);

    /// <summary>Converts an instant as <see cref="From(DateTimeOffset)"/> does.</summary>
    public static implicit operator CoordinateValue(DateTimeOffset value) => From(value);

    /// <summary>Converts a date as <see cref="From(DateTime)"/> does.</summary>
    public static implicit operator CoordinateValue(DateTime value) => From(value);

    /// <summary>Converts a calendar date as <see cref="From(DateOnly)"/> does.</summary>
    public static implicit operator CoordinateValue(DateOnly value) => From(value);

    private void Write(Utf8JsonWriter writer)
    {
        if (_json.ValueKind == JsonValueKind.Undefined)
            writer.WriteNullValue();
        else
            _json.WriteTo(writer);
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path) => Write(writer);
}

/// <summary>A numeric scalar or array returned by native coordinate conversion.</summary>
public sealed class ChartPixelValue
{
    internal ChartPixelValue(JsonElement value)
    {
        if (MethodJson.IsNumber(value))
            Scalar = MethodJson.Number(value);
        else if (value.ValueKind == JsonValueKind.Array)
            Numbers = value.EnumerateArray().Select(MethodJson.Number).ToArray();
        else
            throw new InvalidOperationException("[CoordinateConversionUnavailable] No matching coordinate system returned a numeric result.");
    }

    /// <summary>Gets the scalar alternative, or null for an array.</summary>
    public double? Scalar { get; }

    /// <summary>Gets the array alternative, or null for a scalar.</summary>
    public double[]? Numbers { get; }
}

/// <summary>A source-defined RectLike returned by convertToLayout.</summary>
public sealed record ChartRect(double X, double Y, double Width, double Height);

/// <summary>An open native action Payload with its required action discriminator.</summary>
public sealed class ChartActionResult
{
    internal ChartActionResult(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object
            || !value.TryGetProperty("type", out var type)
            || type.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(type.GetString()))
            throw new InvalidOperationException("[ActionMappingUnavailable] The native event has no registered action type.");

        Type = type.GetString()!;
        Raw = value.Clone();
    }

    /// <summary>Gets the registered action discriminator.</summary>
    public string Type { get; }

    /// <summary>Gets the complete open action payload.</summary>
    public JsonElement Raw { get; }
}

/// <summary>The native CoordinateSystemDataLayout result.</summary>
public sealed class ChartCoordinateLayout
{
    internal ChartCoordinateLayout(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("[CoordinateConversionUnavailable] No coordinate layout was returned.");

        Raw = value.Clone();
        Rect = ReadRect("rect");
        ContentRect = ReadRect("contentRect");
        if (value.TryGetProperty("matrixXYLocatorRange", out var ranges) && ranges.ValueKind != JsonValueKind.Null)
            MatrixXYLocatorRange = ranges.EnumerateArray().Select(r => r.EnumerateArray().Select(MethodJson.Number).ToArray()).ToArray();

        ChartRect? ReadRect(string name) =>
            value.TryGetProperty(name, out var r) && r.ValueKind != JsonValueKind.Null
                ? new(
                    MethodJson.Number(r.GetProperty("x")),
                    MethodJson.Number(r.GetProperty("y")),
                    MethodJson.Number(r.GetProperty("width")),
                    MethodJson.Number(r.GetProperty("height")))
                : null;
    }

    /// <summary>Gets the complete result, including extension fields.</summary>
    public JsonElement Raw { get; }

    /// <summary>Gets the outer rectangle.</summary>
    public ChartRect? Rect { get; }

    /// <summary>Gets the content rectangle.</summary>
    public ChartRect? ContentRect { get; }

    /// <summary>Gets the matrix XY locator ranges.</summary>
    public double[][]? MatrixXYLocatorRange { get; }
}

/// <summary>A captured native visual union with independently owned browser bindings.</summary>
public sealed class ChartVisual : IAsyncDisposable
{
    private readonly EChartsOptionSnapshot? _owner;

    internal ChartVisual(JsonElement json, EChartsOptionSnapshot? owner = null)
    {
        if (json.ValueKind is not (JsonValueKind.String or JsonValueKind.Number or JsonValueKind.Array or JsonValueKind.Object)
            && (owner?.References.Count ?? 0) == 0)
            throw new InvalidOperationException("[VisualUnavailable] The native series or visual returned no supported value.");

        Json = json.Clone();
        _owner = owner;
    }

    /// <summary>Gets the serializable value. Browser objects occupy explicit null placeholders.</summary>
    public JsonElement Json { get; }

    /// <summary>Gets a color or symbol string.</summary>
    public string? Text => Json.ValueKind == JsonValueKind.String ? Json.GetString() : null;

    /// <summary>Gets a numeric visual.</summary>
    public double? Scalar => MethodJson.IsNumber(Json) ? MethodJson.Number(Json) : null;

    /// <summary>Gets a numeric array visual.</summary>
    public double[]? Numbers => Json.ValueKind == JsonValueKind.Array ? Json.EnumerateArray().Select(MethodJson.Number).ToArray() : null;

    /// <summary>Gets native gradient, pattern or image bindings.</summary>
    public IReadOnlyList<JsBinding> Bindings => _owner?.Bindings ?? [];

    /// <summary>Gets the owned browser handles for independent lease retention.</summary>
    public IReadOnlyList<EChartsObjectReference> References => _owner?.References ?? [];

    /// <summary>Releases owned references without disposing native resources.</summary>
    public ValueTask DisposeAsync() => _owner?.DisposeAsync() ?? ValueTask.CompletedTask;
}
