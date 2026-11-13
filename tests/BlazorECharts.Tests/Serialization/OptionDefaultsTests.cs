using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>Default options lie under the options of a chart: objects merge by key, every other value of the chart wins.</summary>
public sealed class OptionDefaultsTests
{
    private static readonly EChartsSerializationContext Context = OptionMetadata.CreateContext();

    private static PreparedOption Apply(ChartOptions options, ChartOptions defaults) =>
        OptionDefaults.Apply(OptionSerializer.Serialize(options, Context), OptionSerializer.Serialize(defaults, Context));

    private static string Path(JsBinding binding) => string.Join('.', binding.Path);

    [Fact]
    public void Objects_MergeByKey_AndTheChartWins()
    {
        // Arrange
        var defaults = new ChartOptions
        {
            Animation = false,
            Toolbox = new ToolboxComponentOption { Show = true, Right = 8 },
            Tooltip = new TooltipOption { Trigger = "axis" },
        };
        var options = new ChartOptions
        {
            Toolbox = new ToolboxComponentOption { Right = 24 },
            Tooltip = new TooltipOption { Trigger = "item" },
            Series = new BarSeriesOption(),
        };

        // Act
        var merged = Apply(options, defaults).Json;

        // Assert
        Assert.Equal(
            """{"series":{"type":"bar"},"toolbox":{"right":24,"show":true},"tooltip":{"trigger":"item"},"animation":false}""",
            merged.GetRawText());
    }

    [Fact]
    public void ArraysAndNull_ReplaceTheDefault()
    {
        // Arrange
        var defaults = new ChartOptions { Color = ["#111", "#222"], Legend = new LegendOption { Bottom = 0 } };
        var options = new ChartOptions { Color = ["#333"], Legend = null };

        // Act
        var merged = Apply(options, defaults).Json;

        // Assert
        Assert.Equal("""{"color":["#333"],"legend":null}""", merged.GetRawText());
    }

    [Fact]
    public void BaseOption_TakesTheDefaults_AndTheRootDoesNot()
    {
        // Arrange
        var defaults = new ChartOptions { Toolbox = new ToolboxComponentOption { Show = true } };
        var options = new ChartOptions
        {
            BaseOption = new ChartOptions { Timeline = new SliderTimelineOption { Data = ["2025", "2026"] } },
            Options = [new ChartOptions { Series = new BarSeriesOption() }],
        };

        // Act
        var merged = Apply(options, defaults).Json;

        // Assert
        Assert.True(merged.GetProperty("baseOption").GetProperty("toolbox").GetProperty("show").GetBoolean());
        Assert.False(merged.TryGetProperty("toolbox", out _));
        Assert.False(merged.GetProperty("options")[0].TryGetProperty("toolbox", out _));
    }

    [Fact]
    public void DefaultFunction_IsKeptOnlyWhereTheChartHasNoValue()
    {
        // Arrange
        var label = JsFunction.Module<TooltipValueFormatterSignature>("js/defaults.js", "value");
        var defaults = new ChartOptions
        {
            Tooltip = new TooltipOption { ValueFormatter = label },
            Legend = new LegendOption { Formatter = JsFunction.Module<LegendFormatterAlternativeSignature>("js/defaults.js", "legend") },
        };
        var options = new ChartOptions
        {
            Tooltip = new TooltipOption { Trigger = "axis" },
            Legend = new LegendOption { Formatter = "{name}" },
            Series = new BarSeriesOption
            {
                Label = new() { Formatter = JsFunction.Module<SeriesLabelFormatterAlternativeSignature>("js/chart.js", "label") },
            },
        };

        // Act
        var merged = Apply(options, defaults);

        // Assert
        Assert.Equal(["series.label.formatter", "tooltip.valueFormatter"], merged.Bindings.Select(Path));
        Assert.Equal(2, merged.Bindings.Select(b => b.Token).Distinct().Count());
        Assert.Equal("{name}", merged.Json.GetProperty("legend").GetProperty("formatter").GetString());
        Assert.Equal(JsonValueKind.Null, merged.Json.GetProperty("tooltip").GetProperty("valueFormatter").ValueKind);
    }

    [Fact]
    public void DefaultFunction_MovesUnderBaseOption()
    {
        // Arrange
        var defaults = new ChartOptions
        {
            Tooltip = new TooltipOption { ValueFormatter = JsFunction.Module<TooltipValueFormatterSignature>("js/defaults.js", "value") },
        };
        var options = new ChartOptions { BaseOption = new ChartOptions { Series = new BarSeriesOption() } };

        // Act
        var merged = Apply(options, defaults);

        // Assert
        Assert.Equal("baseOption.tooltip.valueFormatter", Path(Assert.Single(merged.Bindings)));
    }
}
