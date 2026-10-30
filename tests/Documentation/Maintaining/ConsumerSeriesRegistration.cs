using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;

namespace DocumentationExamples.Maintaining;

public sealed class ConsumerSeries() : SeriesOption("consumerType")
{
    private double? _radius;

    public double? Radius { get => _radius; set => SetProperty(ref _radius, value, "radius"); }
}

internal static class ConsumerSeriesRegistration
{
    internal static void Register(EChartsSerializationContext context)
    {
        // snippet: Maintaining.Generator.ConsumerSeries
        context.RegisterSeries("consumerType",
            new OptionTypeRegistration<ConsumerSeries>(WriteConsumerProperties, ReadConsumer));
        // endsnippet
    }

    private static void WriteConsumerProperties(Utf8JsonWriter writer, ConsumerSeries series, EChartsSerializationContext context, string path)
        => context.WriteProperty(writer, series, "radius", series.Radius, path);

    private static ConsumerSeries ReadConsumer(JsonElement json, EChartsSerializationContext context)
    {
        var series = new ConsumerSeries();
        if (json.TryGetProperty("radius", out var radius))
            series.Radius = radius.GetDouble();

        return series;
    }
}
