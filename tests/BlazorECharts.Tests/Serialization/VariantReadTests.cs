using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>A snapshot item reads as exactly the variant that ECharts 6.1.0 creates from it.</summary>
public sealed class VariantReadTests
{
    private static ChartOptions Read(string json)
    {
        using var document = JsonDocument.Parse(json);
        return GeneratedOptionMetadata.ReadChartOptions(document.RootElement);
    }

    [Theory]
    [InlineData("""{"type":"inside"}""", "inside")]
    [InlineData("""{"type":"slider"}""", "slider")]
    [InlineData("{}", "slider")]
    public void DataZoom_ReadsTheVariantOfItsType(string item, string expected)
    {
        // Act
        var zoom = Read($$"""{"dataZoom":[{{item}}]}""").DataZoom!.Value.Items[0]!.Value;

        // Assert
        Assert.Equal(expected == "inside", zoom.TryGet(out InsideDataZoomOption? _));
        Assert.Equal(expected == "slider", zoom.TryGet(out SliderDataZoomOption? _));
    }

    [Theory]
    [InlineData("""{"type":"scroll"}""", "scroll")]
    [InlineData("""{"type":"plain"}""", "plain")]
    [InlineData("{}", "plain")]
    public void Legend_ReadsTheVariantOfItsType(string item, string expected)
    {
        // Act
        var legend = Read($$"""{"legend":[{{item}}]}""").Legend!.Value.Items[0]!.Value;

        // Assert
        Assert.Equal(expected == "scroll", legend.TryGet(out ScrollableLegendOption? _));
        Assert.Equal(expected == "plain", legend.TryGet(out LegendOption? _));
    }

    [Theory]
    [InlineData("""{"type":"time"}""", "time")]
    [InlineData("""{"type":"log"}""", "log")]
    [InlineData("""{"data":["A","B"]}""", "category")]
    [InlineData("{}", "value")]
    public void Axis_ReadsTheVariantOfItsTypeOrData(string item, string expected)
    {
        // Act
        var axis = Read($$"""{"xAxis":[{{item}}]}""").XAxis!.Value.Items[0]!.Value;

        // Assert
        Assert.Equal(expected == "category", axis.TryGet(out XAxisCategoryOption? _));
        Assert.Equal(expected == "value", axis.TryGet(out XAxisValueOption? _));
        Assert.Equal(expected == "time", axis.TryGet(out XAxisTimeOption? _));
        Assert.Equal(expected == "log", axis.TryGet(out XAxisLogOption? _));
    }

    [Theory]
    [InlineData("""{"type":"piecewise"}""", "piecewise")]
    [InlineData("""{"pieces":[{"min":0,"max":1}]}""", "piecewise")]
    [InlineData("""{"categories":["A"]}""", "piecewise")]
    [InlineData("""{"splitNumber":4}""", "piecewise")]
    [InlineData("""{"splitNumber":4,"calculable":true}""", "continuous")]
    [InlineData("{}", "continuous")]
    public void VisualMap_ReadsTheVariantOfTheEChartsDefaulter(string item, string expected)
    {
        // Act
        var visualMap = Read($$"""{"visualMap":[{{item}}]}""").VisualMap!.Value.Items[0]!.Value;

        // Assert
        Assert.Equal(expected == "continuous", visualMap.TryGet(out ContinuousVisualMapOption? _));
        Assert.Equal(expected == "piecewise", visualMap.TryGet(out PiecewiseVisualMapOption? _));
    }

    [Fact]
    public void Variants_WriteTheirTypeAndReadersKeepTheSnapshot()
    {
        // Act & Assert
        Assert.Equal("time", new XAxisTimeOption().Type!.Value.Value);
        Assert.Equal("inside", new InsideDataZoomOption().Type);
        Assert.Null(GeneratedOptionMetadata.ReadInsideDataZoomOption(JsonDocument.Parse("{}").RootElement).Type);
    }
}

public sealed class OneOrManyReadTests
{
    [Fact]
    public void RadarDataItem_ReadsTheCanonicalValueVector()
    {
        // A radar data item holds one value vector.

        // Arrange
        using var json = JsonDocument.Parse("""{"series":[{"type":"radar","data":[{"name":"A","value":[1,"2",null]}]}]}""");

        // Act
        var radar = Assert.IsType<RadarSeriesOption>(GeneratedOptionMetadata.ReadChartOptions(json.RootElement).Series!.Value.Items[0]);

        // Assert
        Assert.True(radar.Data![0]!.Value.TryGet(out RadarSeriesDataItemOption? item));
        Assert.Equal(3, item.Value!.Length);
        Assert.True(item.Value[1]!.Value.TryGet(out string? text) && text == "2");
        Assert.Null(item.Value[2]);
    }
}

public sealed class DateValueTests
{
    [Fact]
    public void DateTime_IsAnInstantUnlessUnspecified()
    {
        // Arrange
        OptionDataValue utc = new DateTime(2026, 10, 19, 8, 30, 0, DateTimeKind.Utc);
        OptionDataValue wallClock = new DateTime(2026, 10, 19, 8, 30, 0, DateTimeKind.Unspecified);
        OptionDataValue day = new DateOnly(2026, 10, 19);
        var item = new RadarSeriesDataItemOption { Value = [utc, wallClock, day] };

        // Act
        var json = BlazorECharts.Serialization.OptionSerializer.Serialize(item, BlazorECharts.Serialization.OptionMetadata.CreateContext()).Json
            .GetProperty("value")
            .GetRawText();

        // Assert
        Assert.Equal("""["2026-10-19T08:30:00.000Z","2026-10-19T08:30:00.000","2026-10-19"]""", json);
    }

    [Theory]
    [InlineData("\"2026-10-19T08:30:00Z\"", true)]
    [InlineData("\"2026-10-19T08:30:00+02:00\"", true)]
    [InlineData("\"2026-10-19T08:30:00\"", false)]
    [InlineData("\"2026-10-19\"", false)]
    [InlineData("\"2026/10/19\"", false)]
    public void ReadDate_IsAnInstantOnlyWithAnExplicitOffset(string json, bool instant)
    {
        // Arrange
        using var document = JsonDocument.Parse($$"""{"series":[{"type":"bar","data":[{{json}}]}]}""");

        // Act
        var bar = Assert.IsType<BarSeriesOption>(GeneratedOptionMetadata.ReadChartOptions(document.RootElement).Series!.Value.Items[0]);
        var value = bar.Data![0]!.Value;

        // Assert
        Assert.Equal(instant, value.TryGet(out DateTimeOffset _));
        Assert.True(value.TryGet(out string? text));
        Assert.Equal(JsonDocument.Parse(json).RootElement.GetString(), text);
    }
}
