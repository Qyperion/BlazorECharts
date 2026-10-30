using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>A typed upstream string index signature, preserving keys and nested bindings.</summary>
public sealed class OptionDictionary<T> : Dictionary<string, T>, IOptionValue, IJsonOnSerializing
{
    /// <summary>Creates an empty option dictionary with ordinal keys.</summary>
    public OptionDictionary() : base(StringComparer.Ordinal) { }

    // Reached only through IOptionValue: as in OneOrMany<T>, no T is passed by value here, so values are copied out and read through Array.
    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        var keys = new string[Count];
        Keys.CopyTo(keys, 0);
        var values = new T[Count];
        Values.CopyTo(values, 0);
        var order = new int[keys.Length];
        for (var i = 0; i < order.Length; i++)
            order[i] = i;

        Array.Sort(keys, order, StringComparer.Ordinal);
        Array boxed = values;
        writer.WriteStartObject();
        for (var i = 0; i < keys.Length; i++)
            context.WritePropertyValue(writer, boxed.GetValue(order[i]), path, keys[i]);

        writer.WriteEndObject();
    }

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(GetType());
}
