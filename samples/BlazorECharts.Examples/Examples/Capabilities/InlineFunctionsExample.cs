using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Examples.Capabilities;

/// <summary>
/// Inline function source is an explicit opt-in: the host sets
/// <c>AddECharts(options => options.AllowInlineJavaScript = true)</c> and its CSP must permit unsafe-eval.
/// Prefer <see cref="CallbackModulesExample"/> when a module can hold the function.
/// </summary>
public static class InlineFunctionsExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Inline formatter and color callbacks", Left = "center" },
        Tooltip = new TooltipOption
        {
            Trigger = "axis",
            ValueFormatter = JsFunction.Inline<TooltipValueFormatterSignature>("value => `${value} replies`"),
        },
        XAxis = new XAxisCategoryOption { Data = ["Q1", "Q2", "Q3", "Q4"] },
        YAxis = new YAxisValueOption(),
        Series = new BarSeriesOption
        {
            Name = "Replies",
            Data = [310, 420, 380, 510],
            ItemStyle = new()
            {
                Color = JsFunction.Inline<ItemColorCallbackSignature>("params => params.value > 400 ? '#2f9e44' : '#adb5bd'"),
            },
            Label = new()
            {
                Show = true,
                Position = "top",
                Formatter = JsFunction.Inline<SeriesLabelFormatterAlternativeSignature>("params => `${params.value}`"),
            },
        },
    };
}
