using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;

namespace BlazorECharts.Events;

/// <summary>Lossless event data. Native objects are separate borrowed descriptors, valid during the handler invocation.</summary>
public abstract class ChartEventPayload
{
    /// <summary>Clones the serializable event fields.</summary>
    protected ChartEventPayload(JsonElement json) => Raw = json.Clone();

    /// <summary>Gets all serializable fields, including unknown fields and explicit nulls.</summary>
    public JsonElement Raw { get; }

    /// <summary>Gets native reference path/identity descriptors; resolution and retention are provided by the binding
    /// bridge.</summary>
    public JsonElement NativeReferences { get; internal set; }

    /// <summary>Writes the exact serializable event without reflecting browser objects.</summary>
    public void Write(Utf8JsonWriter writer) => Raw.WriteTo(writer);

    /// <summary>Reads an optional string field.</summary>
    protected string? Text(string name) => Field(name) is { ValueKind: not JsonValueKind.Null } v ? v.GetString() : null;

    /// <summary>Reads an optional numeric field.</summary>
    protected double? Number(string name) => Field(name) is { ValueKind: not JsonValueKind.Null } v ? v.GetDouble() : null;

    /// <summary>Reads an optional integer field such as an index.</summary>
    protected int? Integer(string name) => Field(name) is { ValueKind: not JsonValueKind.Null } v ? v.GetInt32() : null;

    /// <summary>Reads an optional boolean field.</summary>
    protected bool? Boolean(string name) => Field(name) is { ValueKind: not JsonValueKind.Null } v ? v.GetBoolean() : null;

    private protected EventActionValue? ReadUnion(string name, string alternatives)
    {
        if (Field(name) is not { } json)
            return null;

        var value = EventActionValue.FromJson(json);
        value.Validate(alternatives);
        return value;
    }

    /// <summary>Reads a selection map, retaining false values.</summary>
    protected IReadOnlyDictionary<string, bool>? BooleanMap(string name) => Field(name) is { ValueKind: JsonValueKind.Object } v
        ? v.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetBoolean(), StringComparer.Ordinal) : null;

    private JsonElement? Field(string name) => Raw.ValueKind == JsonValueKind.Object && Raw.TryGetProperty(name, out var v) ? v : null;

    private protected EChartsSerializationContext PayloadSerialization => s_payloadSerialization.Value;

    private static readonly Lazy<EChartsSerializationContext> s_payloadSerialization = new(
        () => GeneratedOptionMetadata.ReadContext.CreateEventReader());

    /// <summary>Reads a known nested contract with retained extension properties.</summary>
    protected T? ReadField<T>(string name, Func<JsonElement, T> read) where T : class =>
        Field(name) is { ValueKind: not JsonValueKind.Null } json ? read(json) : null;

    /// <summary>Reads a known value-type contract, such as a generated union, with its own shape validation.</summary>
    protected T? ReadValue<T>(string name, Func<JsonElement, T> read) where T : struct =>
        Field(name) is { ValueKind: not JsonValueKind.Null } json ? read(json) : null;

    /// <summary>Reads an open user-defined field as explicit dynamic data without interpreting its shape.</summary>
    protected EChartsValue? JsonValue(string name) => Field(name) is { ValueKind: not JsonValueKind.Null } json ? EChartsValue.FromJson(json) : null;

    /// <summary>Reads a closed array shape with explicit element readers.</summary>
    protected static T[] ReadItems<T>(JsonElement json, Func<JsonElement, T> read) => json.EnumerateArray().Select(read).ToArray();
}
