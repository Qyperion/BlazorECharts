using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>A value converts to One, an array or a collection expression to Many.</summary>
public sealed class OneOrManyConversionTests
{
    private static string Json(ChartOptions options) => OptionSerializer.Serialize(options, OptionMetadata.CreateContext()).Json.GetRawText();

    [Fact]
    public void Model_ConvertsToOne()
    {
        // Act
        var options = new ChartOptions { Title = new TitleOption { Text = "Sales" }, Series = new BarSeriesOption() };

        // Assert
        Assert.False(options.Title!.Value.IsMany);
        Assert.Equal("""{"series":{"type":"bar"},"title":{"text":"Sales"}}""", Json(options));
    }

    [Fact]
    public void CollectionExpression_IsMany_AlsoWithOneElement()
    {
        // Act
        var options = new ChartOptions { Series = [new LineSeriesOption()], Color = ["#5470c6", "#91cc75"] };

        // Assert
        Assert.True(options.Series!.Value.IsMany);
        Assert.Equal("""{"color":["#5470c6","#91cc75"],"series":[{"type":"line"}]}""", Json(options));
    }

    [Fact]
    public void UnionAlternative_ConvertsToOne_WithoutExplicitOne()
    {
        // Act
        var options = new ChartOptions
        {
            Color = "#5470c6",
            Series = new PieSeriesOption
            {
                Radius = "50%",
                ItemStyle = new() { BorderRadius = 6, Color = new LinearGradientObject { X = 0, Y = 0, X2 = 0, Y2 = 1, ColorStops = [] } },
                Data = [new PieDataItemOption { Name = "A", Value = 1048 }],
            },
        };

        // Assert
        Assert.False(options.Color!.Value.IsMany);

        // Act
        var json = OptionSerializer.Serialize(options, OptionMetadata.CreateContext()).Json;
        var pie = json.GetProperty("series");

        // Assert
        Assert.Equal("#5470c6", json.GetProperty("color").GetString());
        Assert.Equal("50%", pie.GetProperty("radius").GetString());
        Assert.Equal(6, pie.GetProperty("itemStyle").GetProperty("borderRadius").GetDouble());
        Assert.Equal("linear", pie.GetProperty("itemStyle").GetProperty("color").GetProperty("type").GetString());
        Assert.Equal("""{"name":"A","value":1048}""", pie.GetProperty("data")[0].GetRawText());

        // Act
        var many = new PieSeriesOption
        {
            Radius = ["40%", 120],
            Center = ["50%", "50%"],
            Data = [new PieDataItemOption { Value = new OptionDataValueNumeric?[] { 1, "-" } }],
        };

        // Assert
        Assert.True(many.Radius!.Value.IsMany);

        // Act
        var manyJson = OptionSerializer.Serialize(many, OptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("""["40%",120]""", manyJson.GetProperty("radius").GetRawText());
        Assert.Equal("""["50%","50%"]""", manyJson.GetProperty("center").GetRawText());
        Assert.Equal("""[1,"-"]""", manyJson.GetProperty("data")[0].GetProperty("value").GetRawText());
    }

    [Fact]
    public void ComponentVariant_ConvertsToItsComponentUnion()
    {
        // Act
        var options = new ChartOptions
        {
            XAxis = new XAxisCategoryOption { Data = ["A", "B"] },
            YAxis = [new YAxisValueOption(), new YAxisValueOption { Position = "right" }],
            DataZoom = [new InsideDataZoomOption(), new SliderDataZoomOption()],
            Legend = new LegendOption(),
            VisualMap = new ContinuousVisualMapOption(),
        };

        // Assert
        Assert.False(options.XAxis!.Value.IsMany);
        Assert.Equal(2, options.DataZoom!.Value.Items.Count);
        Assert.Equal(
            """{"dataZoom":[{"type":"inside"},{"type":"slider"}],"legend":{"type":"plain"},"visualMap":{"type":"continuous"},"xAxis":{"data":["A","B"],"type":"category"},"yAxis":[{"type":"value"},{"position":"right","type":"value"}]}""",
            Json(options));
    }

    [Fact]
    public void Array_ConvertsToMany_AndNullStaysUnset()
    {
        // Arrange
        SeriesOption[] series = [new BarSeriesOption(), new LineSeriesOption()];

        // Act
        var options = new ChartOptions { Series = series, Title = null };

        // Assert
        Assert.True(options.Series!.Value.IsMany);
        Assert.Null(options.Title);
        Assert.Equal("""{"series":[{"type":"bar"},{"type":"line"}],"title":null}""", Json(options));
        Assert.Equal("""{"color":[]}""", Json(new ChartOptions { Color = [] }));
    }
}
