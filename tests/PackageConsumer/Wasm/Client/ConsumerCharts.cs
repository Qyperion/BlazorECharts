using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using BlazorECharts.WordCloud;
using CategoryAxis = BlazorECharts.Options.XAxisCategoryOption;
using ValueAxis = BlazorECharts.Options.YAxisValueOption;

namespace PackageConsumer.Wasm.Client;

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
            Label = new()
            {
                Show = true,
                Position = "top",
                Formatter = JsFunction.Module<SeriesLabelFormatterAlternativeSignature>(Functions, "valueLabel"),
            },
        },
    };

    public static ChartOptions Cloud() => new()
    {
        Animation = false,
        Series = new WordCloudSeriesOption
        {
            Shape = "circle",
            GridSize = 4,
            SizeRange = [12, 40],
            RotationRange = [0, 0],
            TextStyle = new WordCloudTextStyle { FontFamily = "Arial, sans-serif", Color = "#2f5d8a" },
            Data = [.. Words.Select((word, rank) => new WordCloudDataItem { Name = word, Value = 100 - rank * 3 })],
        },
    };

    private static readonly string[] Words =
        ["blazor", "echarts", "package", "offline", "server", "assembly", "export", "layout", "series", "option",
         "module", "runtime", "notice", "release", "feed", "consumer", "canvas", "vector", "chart", "cloud"];
}
