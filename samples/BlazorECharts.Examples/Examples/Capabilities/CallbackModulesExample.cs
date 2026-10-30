using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Examples.Capabilities;

/// <summary>Browser callbacks imported from an ES module: no eval and compatible with a strict script CSP.</summary>
public static class CallbackModulesExample
{
    private const string Module = ExampleModules.Functions;

    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Weekend messages in a different color", Left = "center" },
        Tooltip = new TooltipOption
        {
            Trigger = "axis",
            ValueFormatter = JsFunction.Module<TooltipValueFormatterSignature>(Module, "messagesValue"),
        },
        XAxis = new XAxisCategoryOption
        {
            Data = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        },
        YAxis = new YAxisValueOption(),
        Series = new BarSeriesOption
        {
            Name = "Messages",
            Data = [820, 932, 901, 934, 1290, 1630, 1520],
            ItemStyle = new() { Color = JsFunction.Module<ItemColorCallbackSignature>(Module, "weekendColor") },
            Label = new()
            {
                Show = true,
                Position = "top",
                Formatter = JsFunction.Module<SeriesLabelFormatterAlternativeSignature>(Module, "messagesLabel"),
            },
        },
    };
}
