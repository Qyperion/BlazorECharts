using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>A conditional expression with a null branch assigns a union property without a nullable warning.</summary>
public sealed class ConditionalNullTests
{
    private static string Json(ChartOptions options) => OptionSerializer.Serialize(options, OptionMetadata.CreateContext()).Json.GetRawText();

    [Fact]
    public void ComponentVariant_OrNull_WritesTheVariantOrNull()
    {
        // Act
        var shown = Json(new ChartOptions { Legend = Legend(true) });
        var hidden = Json(new ChartOptions { Legend = Legend(false) });

        // Assert
        Assert.Equal("""{"legend":{"top":0,"type":"scroll"}}""", shown);
        Assert.Equal("""{"legend":null}""", hidden);

        static OneOrMany<LegendComponentOption?>? Legend(bool shown) => shown ? new ScrollableLegendOption { Top = 0 } : null;
    }

    [Fact]
    public void Array_OrNull_WritesTheArrayOrNull()
    {
        // Act
        var shown = Json(new ChartOptions { DataZoom = DataZoom(true), Color = Palette(true) });
        var hidden = Json(new ChartOptions { DataZoom = DataZoom(false), Color = Palette(false) });

        // Assert
        Assert.Equal("""{"color":["#5470c6"],"dataZoom":[{"type":"inside"}]}""", shown);
        Assert.Equal("""{"color":null,"dataZoom":null}""", hidden);

        static OneOrMany<DataZoomOption?>? DataZoom(bool shown) => shown ? new DataZoomOption?[] { new InsideDataZoomOption() } : null;

        static ZRColorOneOrMany? Palette(bool shown) => shown ? new ZRColor?[] { "#5470c6" } : null;
    }

    [Fact]
    public void UnionAlternative_OrNull_WritesTheValueOrNull()
    {
        // Act
        var shown = Json(Options(true));
        var hidden = Json(Options(false));

        // Assert
        Assert.Equal("""{"color":"#5470c6","series":{"type":"bar","itemStyle":{"borderColor":"#fff"}},"tooltip":{"trigger":"axis"}}""", shown);
        Assert.Equal("""{"color":null,"series":{"type":"bar","itemStyle":{"borderColor":null}},"tooltip":{"trigger":null}}""", hidden);

        static ChartOptions Options(bool shown) => new()
        {
            Color = shown ? "#5470c6" : null,
            Tooltip = new TooltipOption { Trigger = shown ? "axis" : null },
            Series = new BarSeriesOption { ItemStyle = new() { BorderColor = shown ? "#fff" : null } },
        };
    }

    [Fact]
    public void NullArray_HasNoItems()
    {
        // Act
        OneOrMany<double> value = (double[]?)null;

        // Assert
        Assert.False(value.IsMany);
        Assert.False(value.TryGetOne(out _));
        Assert.Empty(value.Items);
    }
}
