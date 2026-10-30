using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using BlazorECharts.WordCloud;
using CategoryAxis = BlazorECharts.Options.XAxisCategoryOption;
using ValueAxis = BlazorECharts.Options.YAxisValueOption;

namespace PackageConsumer.Standalone;

public static class ConsumerCharts
{
    // Resolved against the application base URI.
    public const string Functions = "consumer-functions.js";

    public static readonly CustomPoint[] Points = [new(0, 4, "alpha"), new(1, 9, "beta"), new(2, 6, "gamma"), new(3, 11, "delta")];

    // Every series is declared through the SeriesOption base, so its derived fields depend on the registered writers.
    public static ChartOptions Mixed() => new()
    {
        Animation = false,
        // Containers of value types (nullable unions, double?, bool?) exercise WebAssembly AOT shared generic code;
        // the line data, a union array with a null and an object item, the typed loop of union arrays.
        Legend = new LegendOption
        {
            Padding = [4, 8],
            Selected = new OptionDictionary<bool?> { ["custom"] = true, ["bar"] = true },
        },
        XAxis = new CategoryAxis { Data = ["A", "B", "C", "D"] },
        YAxis = new ValueAxis(),
        Dataset = CustomDataset(),
        Series =
        [
            new LineSeriesOption
            {
                Name = "line",
                Smooth = true,
                Symbol = "diamond",
                SymbolSize = 9,
                Data = [3, null, new LineDataItemOption { Value = 4 }, 7],
            },
            new BarSeriesOption
            {
                Name = "bar",
                BarWidth = 18,
                Data = [12, 18, 9, 15],
                Label = new()
                {
                    Show = true,
                    Position = "top",
                    Formatter = JsFunction.Module<SeriesLabelFormatterAlternativeSignature>(Functions, "valueLabel"),
                },
            },
            new ScatterSeriesOption { Name = "custom", DatasetIndex = 0, SymbolSize = 14 },
            new PieSeriesOption
            {
                Name = "pie",
                Center = ["88%", "22%"],
                Radius = [0, 36],
                Data = [3, 5],
            },
        ],
    };

    // Consumer data has no static schema in the library: its contract is the consumer's JsonTypeInfo.
    private static DatasetOption CustomDataset()
    {
        var dataset = new DatasetOption { Dimensions = ["x", "y", "tag"] };
        dataset.AdditionalProperties["source"] = EChartsValue.From(Points);
        return dataset;
    }

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

    public static ChartOptions LargeLine(int count) => new()
    {
        Animation = false,
        Series = new LineSeriesOption { Data = [.. Enumerable.Range(0, count).Select(i => (LineSeriesOptionDataItem?)(double)(i % 997))] },
    };

    private static readonly string[] Words =
        ["blazor", "echarts", "trimmed", "aot", "static", "assembly", "export", "layout", "series", "option",
         "module", "runtime", "linker", "release", "feed", "consumer", "canvas", "vector", "chart", "cloud"];
}
