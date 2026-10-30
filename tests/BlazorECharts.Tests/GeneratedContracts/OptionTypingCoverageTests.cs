using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class OptionTypingCoverageTests
{
    [Fact]
    public void VisualMapInRangeColorAcceptsArray()
    {
        // Arrange
        var visualMap = new ContinuousVisualMapOption { InRange = new VisualMapChannelsOption { Color = new string?[] { "#f6efa6", "#bf444c" } } };

        // Act
        var json = Write(visualMap);

        // Assert
        Assert.Equal(["#f6efa6", "#bf444c"], json.GetProperty("inRange").GetProperty("color").EnumerateArray().Select(c => c.GetString()));
        AssertRoundTrip(json, GeneratedOptionMetadata.ReadContinuousVisualMapOption(json));
    }

    [Fact]
    public void VisualMapChannelsAcceptScalarValues()
    {
        // Arrange
        var channels = new VisualMapChannelsOption
        {
            Color = "#2480cc",
            Symbol = "diamond",
            SymbolSize = 12d,
            Opacity = 0.5,
            ColorAlpha = 0.8,
            ColorHue = 200d,
            ColorSaturation = 0.4,
            ColorLightness = 0.6,
            LiftZ = 2d,
            Decal = new DecalObject { Symbol = OneOrMany<string>.One("rect"), Color = "rgba(0,0,0,0.2)" },
        };

        // Act
        var json = Write(new PiecewiseVisualMapOption { OutOfRange = channels }).GetProperty("outOfRange");

        // Assert
        Assert.Equal("#2480cc", json.GetProperty("color").GetString());
        Assert.Equal("diamond", json.GetProperty("symbol").GetString());
        Assert.Equal(12, json.GetProperty("symbolSize").GetDouble());
        Assert.Equal(0.6, json.GetProperty("colorLightness").GetDouble());
        Assert.Equal(2, json.GetProperty("liftZ").GetDouble());
        Assert.Equal("rect", json.GetProperty("decal").GetProperty("symbol").GetString());
    }

    [Fact]
    public void VisualMapChannelsAcceptRangeArrays()
    {
        // Act
        var json = Write(new ContinuousVisualMapOption
        {
            InRange = new VisualMapChannelsOption
            {
                SymbolSize = new double?[] { 10, 40 },
                ColorLightness = new double?[] { 0.8, 0.2 },
                Symbol = new string?[] { "circle", "rect" },
            },
            Controller = new ControllerOption
            {
                InRange = new VisualMapChannelsOption { Opacity = new double?[] { 0.4, 1 } },
                OutOfRange = new VisualMapChannelsOption { Color = "#999" },
            },
        });

        // Assert
        Assert.Equal([10d, 40d], json.GetProperty("inRange").GetProperty("symbolSize").EnumerateArray().Select(v => v.GetDouble()));
        Assert.Equal(JsonValueKind.Array, json.GetProperty("inRange").GetProperty("symbol").ValueKind);
        Assert.Equal(2, json.GetProperty("controller").GetProperty("inRange").GetProperty("opacity").GetArrayLength());
        Assert.Equal("#999", json.GetProperty("controller").GetProperty("outOfRange").GetProperty("color").GetString());
        AssertRoundTrip(json, GeneratedOptionMetadata.ReadContinuousVisualMapOption(json));
    }

    [Fact]
    public void VisualMapChannelsAcceptCategoryTables()
    {
        // Act
        var json = Write(new PiecewiseVisualMapOption
        {
            Categories = ["Warden", "Paladin"],
            InRange = new VisualMapChannelsOption
            {
                Color = new OptionDictionary<string?> { ["Warden"] = "red", [""] = "green" },
                SymbolSize = new OptionDictionary<double?> { ["Paladin"] = 24 },
                Decal = new OptionDictionary<DecalObject?> { ["Warden"] = new DecalObject { Symbol = OneOrMany<string>.One("triangle") } },
            },
        });

        // Assert
        var inRange = json.GetProperty("inRange");
        Assert.Equal("green", inRange.GetProperty("color").GetProperty("").GetString());
        Assert.Equal(24, inRange.GetProperty("symbolSize").GetProperty("Paladin").GetDouble());
        Assert.Equal("triangle", inRange.GetProperty("decal").GetProperty("Warden").GetProperty("symbol").GetString());
        AssertRoundTrip(json, GeneratedOptionMetadata.ReadPiecewiseVisualMapOption(json));
    }

    [Fact]
    public void VisualMapNumberChannelRejectsText()
    {
        // Act & Assert
        Assert.ThrowsAny<Exception>(
            () => GeneratedOptionMetadata.ReadContinuousVisualMapOption(ComponentOptionFixtures.Parse("""{"inRange":{"opacity":"half"}}""")));
        Assert.ThrowsAny<Exception>(
            () => GeneratedOptionMetadata.ReadContinuousVisualMapOption(ComponentOptionFixtures.Parse("""{"inRange":{"color":[1,2]}}""")));
    }

    [Fact]
    public void VisualMapDimensionAcceptsName()
    {
        // Act & Assert
        Assert.Equal("amount", Write(new ContinuousVisualMapOption { Dimension = "amount" }).GetProperty("dimension").GetString());
        Assert.Equal(2, Write(new PiecewiseVisualMapOption { Dimension = 2d }).GetProperty("dimension").GetInt32());
        Assert.Equal("kind", Write(new PiecewiseVisualMapOption { Dimension = "kind" }).GetProperty("dimension").GetString());
    }

    [Fact]
    public void GaugeSplitLineLengthAcceptsPercent()
    {
        // Act
        var json = Write(new GaugeSeriesOption { SplitLine = new GaugeSeriesOptionSplitLine { Length = "12%" } });

        // Assert
        Assert.Equal("12%", json.GetProperty("splitLine").GetProperty("length").GetString());
        Assert.Equal(
            18,
            Write(new GaugeSeriesOption { SplitLine = new GaugeSeriesOptionSplitLine { Length = 18d } }).GetProperty("splitLine")
                .GetProperty("length")
                .GetInt32());
    }

    [Fact]
    public void LegendPageIconSizeAcceptsWidthAndHeight()
    {
        // Act
        var json = Write(new ScrollableLegendOption { PageIconSize = OneOrMany<double?>.Many(12, 8) });

        // Assert
        Assert.Equal([12d, 8d], json.GetProperty("pageIconSize").EnumerateArray().Select(v => v.GetDouble()));
        Assert.Equal(10, Write(new ScrollableLegendOption { PageIconSize = OneOrMany<double?>.One(10) }).GetProperty("pageIconSize").GetDouble());
    }

    [Fact]
    public void MagicTypeSeriesIndexAcceptsArrays()
    {
        // Act
        var json = Write(new ToolboxMagicTypeFeatureOption
        {
            SeriesIndex = new ToolboxMagicTypeFeatureOptionSeriesIndex { Line = OneOrMany<double?>.Many(0, 2), Bar = OneOrMany<double?>.One(1) },
        }).GetProperty("seriesIndex");

        // Assert
        Assert.Equal(2, json.GetProperty("line").GetArrayLength());
        Assert.Equal(1, json.GetProperty("bar").GetInt32());
    }

    [Fact]
    public void CandlestickBorderColor0AcceptsGradient()
    {
        // Arrange
        var gradient = new LinearGradientObject
        {
            Type = "linear",
            X = 0,
            Y = 0,
            X2 = 0,
            Y2 = 1,
            ColorStops = [new GradientColorStop { Offset = 0, Color = "#ec0000" }, new GradientColorStop { Offset = 1, Color = "#8a0000" }],
        };

        // Act
        var json = Write(new CandlestickItemStyleOption { BorderColor0 = gradient, Color0 = "#00da3c" });

        // Assert
        Assert.Equal("linear", json.GetProperty("borderColor0").GetProperty("type").GetString());
        Assert.Equal("#8a0000", Write(new CandlestickItemStyleOption { BorderColor0 = "#8a0000" }).GetProperty("borderColor0").GetString());
        AssertRoundTrip(json, GeneratedOptionMetadata.ReadCandlestickItemStyleOption(json));
    }

    [Fact]
    public void RadarItemStyleColorAcceptsCallback()
    {
        // Act
        var prepared = OptionSerializer.Serialize(new RadarSeriesOption
        {
            ItemStyle = new ItemStyleOption { Color = JsFunction.Module<ItemColorCallbackSignature>("./series.js", "color") },
        }, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("itemStyle").GetProperty("color").ValueKind);
        Assert.Equal(["itemStyle", "color"], Assert.Single(prepared.Bindings).Path.Select(p => p.ToString()));
    }

    [Fact]
    public void CustomSeriesDataAcceptsValuesValueArraysAndItems()
    {
        // Arrange
        var series = new CustomSeriesOption
        {
            Data =
            [
                3d,
                "label",
                new OptionDataValue?[] { 1d, "B", null },
                new CustomDataItemOption { Name = "C", Value = new OptionDataValue?[] { 4d, 5d } },
                null,
            ],
        };

        // Act
        var json = Write(series).GetProperty("data");

        // Assert
        Assert.Equal(3, json[0].GetInt32());
        Assert.Equal("label", json[1].GetString());
        Assert.Equal(JsonValueKind.Null, json[2][2].ValueKind);
        Assert.Equal("C", json[3].GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, json[4].ValueKind);

        // Act
        var read = GeneratedOptionMetadata.ReadCustomSeriesOption(Write(series));

        // Assert
        Assert.Equal(5, read.Data!.Length);
        AssertRoundTrip(Write(series), read);
    }

    [Fact]
    public void FunnelSortAcceptsComparator()
    {
        // Act
        var prepared = OptionSerializer.Serialize(
            new FunnelSeriesOption { Sort = JsFunction.Module<FunnelSortComparatorSignature>("./series.js", "funnelSort") },
            GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("sort").ValueKind);
        Assert.Equal("sort", Assert.Single(prepared.Bindings).Path[0].ToString());
        Assert.Equal("ascending", Write(new FunnelSeriesOption { Sort = "ascending" }).GetProperty("sort").GetString());
        Assert.Throws<ArgumentException>(() => new FunnelSeriesOption { Sort = "random" });
    }

    private static JsonElement Write(OptionObject value) => OptionSerializer.Serialize(value, GeneratedOptionMetadata.CreateContext()).Json;

    private static void AssertRoundTrip(JsonElement json, OptionObject read) => Assert.True(JsonElement.DeepEquals(json, Write(read)));
}
