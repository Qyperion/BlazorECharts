using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class StandardSeriesUsageFixtures
{
    [Fact]
    public void StandardSeriesCatalog_AllFactoriesRoundTripTypedData()
    {
        // Act & Assert
        Assert.Equal(
            new[] { "bar", "boxplot", "candlestick", "effectScatter", "funnel", "gauge", "heatmap", "line", "lines", "map", "parallel", "pictorialBar", "pie", "radar", "scatter", "themeRiver" }.Order(),
            StandardSeriesCatalog.Cases.Keys.Order());
        foreach (var (name, count) in StandardSeriesCatalog.Cases)
        {
            var options = StandardSeriesCatalog.Create(name);
            var json = StandardSeriesCoverageTests.Json(options);
            var series = json.GetProperty("series")[0];
            Assert.Equal(name, series.GetProperty("type").GetString());
            Assert.Equal(name, series.GetProperty("id").GetString());
            Assert.Equal(count, series.GetProperty("data").GetArrayLength());
            Assert.True(JsonElement.DeepEquals(json, StandardSeriesCoverageTests.Json(GeneratedOptionMetadata.ReadChartOptions(json))), name);
        }
    }

    [Fact]
    public void StandardSeries_CallbacksUseStructuredBindingPaths()
    {
        // Act
        var prepared = OptionSerializer.Serialize(
            StandardSeriesCatalog.Create("line", "/modules/series-functions.js"),
            GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal(2, prepared.Bindings.Count);
        Assert.All(prepared.Bindings, b => Assert.Equal(JsBindingKind.Module, b.Kind));
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("series")[0].GetProperty("label").GetProperty("formatter").ValueKind);
    }
}
