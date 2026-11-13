using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class StandardSeriesCoverageTests
{
    [Fact]
    public void StandardSeries_LineAlternativesPreserveExactJson()
    {
        foreach (LineStep step in new LineStep[] { false, "start", "middle", "end" })
            foreach (BooleanOrAuto show in new BooleanOrAuto[] { false, true, "auto" })
            {
                // Arrange
                var options = new ChartOptions
                {
                    Series = OneOrMany<SeriesOption>.One(new LineSeriesOption
                    {
                        Id = "line",
                        Step = step,
                        ShowAllSymbol = show,
                        SymbolOffset = new NumberOrString?[] { "20%", 0d },
                        ConnectNulls = false,
                        Z = 0,
                        Data = [],
                        Name = null,
                    }),
                };

                // Act
                var json = Json(options);

                // Assert
                var series = json.GetProperty("series");
                Assert.Contains(series.GetProperty("step").ValueKind, new[] { JsonValueKind.True, JsonValueKind.False, JsonValueKind.String });
                Assert.Equal("20%", series.GetProperty("symbolOffset")[0].GetString());
                Assert.Equal(0, series.GetProperty("symbolOffset")[1].GetDouble());
                Assert.False(series.GetProperty("connectNulls").GetBoolean());
                Assert.Equal(JsonValueKind.Null, series.GetProperty("name").ValueKind);
                Assert.Empty(series.GetProperty("data").EnumerateArray());
                Assert.False(series.TryGetProperty("stack", out _));
                Assert.True(JsonElement.DeepEquals(json, Json(GeneratedOptionMetadata.ReadChartOptions(json))));
            }

        // Act & Assert
        Assert.Throws<ArgumentException>(() => LineStep.From("center"));
        Assert.Throws<ArgumentException>(() => LineStep.From(true));
        Assert.Throws<ArgumentException>(() => BooleanOrAuto.From("sometimes"));
    }

    internal static JsonElement Json(ChartOptions options) => OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json;

    [Theory]
    [InlineData("bar", "data")]
    [InlineData("heatmap", "data")]
    [InlineData("gauge", "data")]
    [InlineData("parallel", "data")]
    [InlineData("chord", "links")]
    public void ItemTooltip_IsWrittenOnTheItemOnly(string name, string collection)
    {
        // Act
        var json = OptionSerializer.Serialize(StandardSeriesCatalog.ItemTooltip(name), GeneratedOptionMetadata.CreateContext()).Json;
        var items = json.GetProperty("series").GetProperty(collection);

        // Assert
        Assert.Equal("item tooltip", items[0].GetProperty("tooltip").GetProperty("formatter").GetString());
        Assert.False(items[1].TryGetProperty("tooltip", out _));
    }
}
