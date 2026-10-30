using System.Text.Json;
using BlazorECharts.Values;

namespace BlazorECharts.Options;

/// <summary>An explicit escape hatch for a consumer series. It never replaces unknown standard mappings automatically.</summary>
public sealed class RawSeriesOption(string type) : SeriesOption(type)
{
    /// <summary>Reads an opaque series object while retaining its discriminator and all unknown fields.</summary>
    public static RawSeriesOption FromJson(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String)
            throw new JsonException("A raw series requires a string type discriminator.");

        var series = new RawSeriesOption(type.GetString()!);
        foreach (var property in json.EnumerateObject())
            if (property.Name != "type")
                series.AdditionalProperties[property.Name] = EChartsValue.FromJson(property.Value);

        return series;
    }
}
