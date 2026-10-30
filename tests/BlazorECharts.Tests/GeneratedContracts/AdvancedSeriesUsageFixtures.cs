using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class AdvancedSeriesUsageFixtures
{
    [Fact]
    public void AdvancedUsage_RecursiveDataAndLinksCompile()
    {
        // Arrange
        var options = new ChartOptions
        {
            Series = OneOrMany<SeriesOption>.Many(
                new TreeSeriesOption
                {
                    Data = [new() { Name = "root", Children = [new() { Name = "leaf", Value = 0d, Collapsed = false, Children = [] }] }],
                },
                new SunburstSeriesOption
                {
                    Data = [new() { Name = "root", Children = [new() { Name = "leaf", Value = 3d, ItemStyle = new() { BorderRadius = "20%" } }] }],
                    Levels = [new() { Radius = [0d, "80%"] }],
                },
                new TreemapSeriesOption
                {
                    Data = [new() { Name = "root", Children = [new() { Name = "leaf", Value = OneOrMany<double?>.Many(3d, 5d) }] }],
                },
                new GraphSeriesOption
                {
                    Layout = "force",
                    Force = new() { Repulsion = OneOrMany<double?>.Many(100d, 200d) },
                    Data = [new GraphNodeItemOption { Id = "a", Name = "A" }, new GraphNodeItemOption { Id = "b", Name = "B" }],
                    Links = [new() { Source = "a", Target = "b", Value = 3d, LineStyle = new() { Curveness = 0 } }],
                },
                new CustomSeriesOption
                {
                    Data = [new CustomDataItemOption { Name = "A", Value = 0d, GroupId = "group", ItemStyle = new() { Opacity = 0d } }],
                }),
        };

        // Act
        var json = AdvancedSeriesCoverageTests.Json(options);

        // Assert
        Assert.Empty(json.GetProperty("series")[0].GetProperty("data")[0].GetProperty("children")[0].GetProperty("children").EnumerateArray());
        Assert.False(json.GetProperty("series")[0].GetProperty("data")[0].GetProperty("children")[0].GetProperty("collapsed").GetBoolean());
        Assert.Equal(
            "20%",
            json.GetProperty("series")[1]
                .GetProperty("data")[0]
                .GetProperty("children")[0]
                .GetProperty("itemStyle")
                .GetProperty("borderRadius")
                .GetString());
        Assert.Equal("a", json.GetProperty("series")[3].GetProperty("links")[0].GetProperty("source").GetString());
        Assert.Equal(0, json.GetProperty("series")[4].GetProperty("data")[0].GetProperty("value").GetDouble());
        Assert.True(JsonElement.DeepEquals(json, AdvancedSeriesCoverageTests.Json(GeneratedOptionMetadata.ReadChartOptions(json))));
    }

    [Fact]
    public void AdvancedCatalog_AllFactoriesRoundTripTypedData()
    {
        // Act & Assert
        Assert.Equal(new[] { "chord", "custom", "graph", "sankey", "sunburst", "tree", "treemap" }.Order(), AdvancedSeriesCatalog.Cases.Keys.Order());
        foreach (var name in AdvancedSeriesCatalog.Cases.Keys)
        {
            var options = AdvancedSeriesCatalog.Create(name);
            var json = AdvancedSeriesCoverageTests.Json(options);
            Assert.Equal(name, json.GetProperty("series")[0].GetProperty("type").GetString());
            Assert.True(JsonElement.DeepEquals(json, AdvancedSeriesCoverageTests.Json(GeneratedOptionMetadata.ReadChartOptions(json))), name);
        }
    }

    [Fact]
    public void CustomRenderItem_UsesBrowserModuleAndKeepsDataItemFields()
    {
        // Act
        var prepared = OptionSerializer.Serialize(
            AdvancedSeriesCatalog.Create("custom", "/modules/custom-renderers.js"),
            GeneratedOptionMetadata.CreateContext());

        // Assert
        var binding = Assert.Single(prepared.Bindings);
        Assert.Equal(JsBindingKind.Module, binding.Kind);
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("series")[0].GetProperty("renderItem").ValueKind);

        // Act
        var custom = GeneratedOptionMetadata.ReadCustomSeriesOption(
            AdvancedSeriesCatalog.Parse("""{"data":[{"value":[1,2],"arbitrary":{"flag":false}},[3,4]]}"""));
        var json = AdvancedSeriesCoverageTests.Json(custom);

        // Assert
        Assert.False(json.GetProperty("data")[0].GetProperty("arbitrary").GetProperty("flag").GetBoolean());
        Assert.Equal(2, json.GetProperty("data")[1].GetArrayLength());
    }

    [Fact]
    public void AdvancedSeries_SankeyInsideEdgeLabelsReadAndWrite()
    {
        // Arrange
        var options = new SankeySeriesOption
        {
            Emphasis = new() { EdgeLabel = new() { Position = "inside", Distance = 0 } },
            Blur = new() { EdgeLabel = new() { Position = "inside", Distance = 0 } },
            Select = new() { EdgeLabel = new() { Position = "inside", Distance = 0 } },
            Links =
            [
                new()
                {
                    Source = "A",
                    Target = "B",
                    Value = 3d,
                    Emphasis = new() { EdgeLabel = new() { Position = "inside", Distance = 0 } },
                    Blur = new() { EdgeLabel = new() { Position = "inside", Distance = 0 } },
                    Select = new() { EdgeLabel = new() { Position = "inside", Distance = 0 } },
                },
            ],
            Levels = [new() { Depth = 0, EdgeLabel = new() { Position = "inside", Distance = 0 } }],
        };

        // Act
        var json = AdvancedSeriesCoverageTests.Json(options);

        // Assert
        foreach (var state in new[] { "emphasis", "blur", "select" })
        {
            Assert.Equal("inside", json.GetProperty(state).GetProperty("edgeLabel").GetProperty("position").GetString());
            Assert.Equal(0, json.GetProperty(state).GetProperty("edgeLabel").GetProperty("distance").GetDouble());
            Assert.Equal("inside", json.GetProperty("links")[0].GetProperty(state).GetProperty("edgeLabel").GetProperty("position").GetString());
        }

        Assert.Equal("inside", json.GetProperty("levels")[0].GetProperty("edgeLabel").GetProperty("position").GetString());
        Assert.True(JsonElement.DeepEquals(json, AdvancedSeriesCoverageTests.Json(GeneratedOptionMetadata.ReadSankeySeriesOption(json))));
    }

    [Fact]
    public void AdvancedSeries_SankeyAuthoredInsideJsonRetainsScalarDistance()
    {
        // Arrange
        using var input = JsonDocument.Parse("""{"type":"sankey","emphasis":{"edgeLabel":{"position":"inside","distance":0}},"levels":[{"depth":0,"edgeLabel":{"position":"inside","distance":4}}]}""");

        // Act
        var read = GeneratedOptionMetadata.ReadSankeySeriesOption(input.RootElement);

        // Assert
        Assert.True(JsonElement.DeepEquals(input.RootElement, AdvancedSeriesCoverageTests.Json(read)));
    }
}
