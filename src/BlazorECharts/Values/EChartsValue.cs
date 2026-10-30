using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>Explicit dynamic JSON data, registered custom CLR data, or an explicit native/function binding.</summary>
/// <remarks>The default value is JSON null. Ordinary data never becomes code; explicit descriptors use separate
/// bindings. CLR objects remain live until preparation.</remarks>
public readonly struct EChartsValue : IOptionValue, IJsonOnSerializing, IScalarOptionValue
{
    private readonly object? _value;

    internal object? RawValue => _value;

    private EChartsValue(object? value) => _value = value;

    /// <summary>Wraps JSON-compatible data or a custom value requiring exact runtime-type metadata.</summary>
    public static EChartsValue From<T>(T value) => value is JsonElement json ? FromJson(json) : new(value);

    /// <summary>Clones a JSON value immediately so its source document may be disposed before serialization.</summary>
    public static EChartsValue FromJson(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Undefined)
            throw new ArgumentException("Undefined JSON is not a value; use explicit JSON null.", nameof(value));

        return new(value.Clone());
    }

    /// <summary>Gets the JSON of a value created from JSON, such as a value read from a getOption snapshot.</summary>
    public bool TryGetJson(out JsonElement json)
    {
        if (_value is JsonElement element)
        {
            json = element;
            return true;
        }

        json = default;
        return false;
    }

    /// <summary>Creates an explicit JSON array and copies its container.</summary>
    public static EChartsValue Array(params EChartsValue[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return new((EChartsValue[])values.Clone());
    }

    /// <summary>Copies an explicit JSON object's fields; fields serialize in ordinal name order.</summary>
    public static EChartsValue Object(IReadOnlyDictionary<string, EChartsValue> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return new(new ObjectValue(new Dictionary<string, EChartsValue>(values, StringComparer.Ordinal)));
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path) => context.WriteValue(writer, _value, path);

    bool IScalarOptionValue.TryWriteScalar(Utf8JsonWriter writer, EChartsSerializationContext context) => context.TryWriteScalar(writer, _value);

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(typeof(EChartsValue));

    private sealed class ObjectValue(Dictionary<string, EChartsValue> values) : IOptionValue
    {
        public void Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
        {
            writer.WriteStartObject();
            foreach (var (key, value) in values.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                context.WritePropertyValue(writer, value, path, key);
            }

            writer.WriteEndObject();
        }
    }
}
