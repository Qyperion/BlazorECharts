using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class PolymorphicRegistrationTests
{
    [Fact]
    public void ConsumerSeriesRegistration_WorksWithoutCoreEdit()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        context.RegisterSeries("consumer", new OptionTypeRegistration<ConsumerSeries>(
            (writer, value, ctx, path) =>
            {
                ctx.WriteProperty(writer, value, "type", value.Type, path);
                ctx.WriteProperty(writer, value, "weight", value.Weight, path);
            },
            (json, _) => new ConsumerSeries { Weight = json.GetProperty("weight").GetDouble() }));
        var chart = new ChartOptions
        {
            Series = OneOrMany<SeriesOption>.Many(
                new LineSeriesOption { ShowSymbol = false },
                new ConsumerSeries { Weight = 0 },
                new RawSeriesOption("rawConsumer") { AdditionalProperties = { ["values"] = EChartsValue.Array() } }),
        };

        // Act
        var json = OptionSerializer.Serialize(chart, context).Json;

        // Assert
        Assert.Equal("consumer", json.GetProperty("series")[1].GetProperty("type").GetString());
        Assert.Equal(0, json.GetProperty("series")[1].GetProperty("weight").GetDouble());
        Assert.Empty(json.GetProperty("series")[2].GetProperty("values").EnumerateArray());
        Assert.IsType<LineSeriesOption>(context.ReadSeries(json.GetProperty("series")[0]));
        var custom = Assert.IsType<ConsumerSeries>(context.ReadSeries(json.GetProperty("series")[1]));
        Assert.Equal(0, custom.Weight);
        Assert.Throws<JsonException>(() => context.ReadSeries(json.GetProperty("series")[2]));
        var raw = RawSeriesOption.FromJson(json.GetProperty("series")[2]);
        Assert.Equal(json.GetProperty("series")[2].GetRawText(), OptionSerializer.Serialize(raw, context).Json.GetRawText());
    }

    [Fact]
    public void MissingDerivedWriterAndUnknownDiscriminator_AreExplicitErrors()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act & Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(new ConsumerSeries(), context));

        // Arrange
        using var unknown = JsonDocument.Parse("""{"type":"unknownStandard"}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => context.ReadSeries(unknown.RootElement));
    }

    private sealed class ConsumerSeries : SeriesOption
    {
        private double _weight;

        public ConsumerSeries() : base("consumer") { }

        public double Weight { get => _weight; set => SetProperty(ref _weight, value, "weight"); }
    }
}
