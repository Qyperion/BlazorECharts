using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using CategoryAxis = BlazorECharts.Options.XAxisCategoryOption;
using ValueAxis = BlazorECharts.Options.YAxisValueOption;

namespace PackageConsumer.CoreOnly.Components;

public static class ConsumerCharts
{
    // Resolved against the application base URI, so it follows a path base.
    public const string Functions = "consumer-functions.js";

    public static ChartOptions Bar(string title) => new()
    {
        Animation = false,
        Title = new TitleOption { Text = title },
        XAxis = new CategoryAxis { Data = ["A", "B", "C"] },
        YAxis = new ValueAxis(),
        Series = new BarSeriesOption
        {
            Data = [12, 18, 9],
            // A color nothing else on the chart uses, for the pixel check of the PNG export.
            ItemStyle = new() { Color = "#ff00ff" },
            Label = new()
            {
                Show = true,
                Position = "top",
                Formatter = JsFunction.Module<SeriesLabelFormatterAlternativeSignature>(Functions, "valueLabel"),
            },
        },
    };
}
