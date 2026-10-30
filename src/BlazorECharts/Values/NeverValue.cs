using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>An uninhabitable upstream alternative. Only an empty array of this type is serializable.</summary>
public readonly struct NeverValue : IOptionValue
{
    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
        => throw new OptionSerializationException("The upstream never type has no value.", path, typeof(NeverValue));
}
