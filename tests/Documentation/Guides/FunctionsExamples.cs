// snippet: Guides.Functions.Module
using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
// endsnippet
using BlazorECharts.Runtime;

namespace DocumentationExamples.Guides;

internal static class FunctionsExamples
{
    internal static ChartOptions Module()
    {
        // snippet: Guides.Functions.Module
        const string callbacks = "js/chart-callbacks.js";

        var options = new ChartOptions
        {
            Tooltip = new TooltipOption
            {
                Trigger = "axis",
                ValueFormatter = JsFunction.Module<TooltipValueFormatterSignature>(callbacks, "messages"),
            },
            Series = new BarSeriesOption
            {
                Data = [820, 932, 901, 934, 1290, 1630, 1520],
                ItemStyle = new() { Color = JsFunction.Module<ItemColorCallbackSignature>(callbacks, "weekendColor") },
            },
        };
        // endsnippet
        return options;
    }

    internal static void InlineOptIn(WebApplicationBuilder builder)
    {
        // snippet: Guides.Functions.InlineOptIn
        builder.Services.AddECharts(options => options.AllowInlineJavaScript = true);
        // endsnippet
    }

    internal static TooltipOption Inline()
    {
        // snippet: Guides.Functions.Inline
        var tooltip = new TooltipOption
        {
            Trigger = "axis",
            ValueFormatter = JsFunction.Inline<TooltipValueFormatterSignature>("value => `${value} messages`"),
        };
        // endsnippet
        return tooltip;
    }

    internal static CustomSeriesOption RenderItem()
    {
        // snippet: Guides.Functions.RenderItem
        var series = new CustomSeriesOption
        {
            RenderItem = JsFunction.Module<CustomRenderItemSignature>("js/chart-callbacks.js", "rangeBar"),
            Encode = new OptionEncode
            {
                Entries =
                {
                    ["x"] = [1, 2],
                    ["y"] = 0,
                },
            },
            // Category index, start and end of each range.
            Data = [new OptionDataValue?[] { 0, 8, 17 }, new OptionDataValue?[] { 1, 10, 22 }],
        };
        // endsnippet
        return series;
    }

    internal static async Task RegisterCustomSeries(EChartsRuntime runtime)
    {
        // snippet: Guides.Functions.RegisterCustomSeries
        await runtime.RegisterCustomSeriesAsync("progressRing",
            JsFunction.Module<CustomRenderItemSignature>("js/chart-callbacks.js", "progressRing"));

        var series = new CustomSeriesOption { RenderItem = "progressRing", Data = [new OptionDataValue?[] { 1, 1, 0.82 }] };
        // endsnippet
        _ = series;
    }
}
