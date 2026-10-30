using System.Buffers;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;
using CategoryAxis = BlazorECharts.Options.XAxisCategoryOption;
using ValueAxis = BlazorECharts.Options.YAxisValueOption;

namespace BrowserHost.Client.Shared;

/// <summary>Seeded synthetic chart inputs: the same workload and seed always produce the same JSON.</summary>
public static class SyntheticWorkloads
{
    public const int DefaultSeed = 20261023;

    /// <summary>Updates in one sample of a stream workload.</summary>
    public const int StreamUpdates = 1_000;

    private static readonly string[] Syllables = ["ka", "lo", "mi", "ra", "te", "su", "vi", "no", "pe", "za", "do", "ri", "an", "el", "or", "us"];

    public sealed record Workload(string Name, string Kind, int Size, int Charts);

    // Names, kinds, sizes and chart counts must match tools/Performance/workloads.json.
    public static readonly IReadOnlyList<Workload> All =
    [
        new("line-1k", "line", 1_000, 1),
        new("line-10k", "line", 10_000, 1),
        new("line-100k", "line", 100_000, 1),
        new("line-1m", "line", 1_000_000, 1),
        new("line-4x10k", "line", 10_000, 4),
        new("line-20x1k", "line", 1_000, 20),
        new("wordcloud-200", "wordcloud", 200, 1),
        new("wordcloud-2000", "wordcloud", 2_000, 1),
        new("stream-1k", "stream", 1_000, 1),
        new("hover-100", "hover", 100, 1),
    ];

    public static Workload Find(string? name) =>
        All.FirstOrDefault(workload => workload.Name == name) ?? throw new ArgumentException($"Unknown workload '{name}'.", nameof(name));

    /// <summary>The options of one chart in the mount or update stage. The update stage has its own seed so that the data
    /// actually changes.</summary>
    public static ChartOptions Create(Workload workload, int seed, int chart, string stage)
    {
        var chartSeed = seed + chart + (stage == "update" ? 50 : 0);
        var title = $"{stage}-{chart}";
        return workload.Kind switch
        {
            "wordcloud" => WordCloud(chartSeed, workload.Size, title),
            "hover" => Bars(chartSeed, workload.Size, title),
            _ => Line(chartSeed, workload.Size, title),
        };
    }

    /// <summary>The full replacement options of one stream update.</summary>
    public static ChartOptions Stream(Workload workload, int seed, int step) => Line(seed + 100 + step, workload.Size, "stream");

    /// <summary>The transport bytes of <see cref="Create"/>, the input of the native ECharts baseline. The stream stage is a JSON
    /// array of every <see cref="Stream"/> update.</summary>
    public static byte[] Payload(string workload, int seed, int chart, string stage)
    {
        var context = new EChartsSerializationContext();
        GeneratedOptionMetadata.Register(context);
        new WordCloudExtension().ConfigureSerialization(context);
        var selected = Find(workload);
        byte[] Bytes(ChartOptions options) => OptionSerializer.Serialize(options, context).Utf8;

        if (stage != "stream")
            return Bytes(Create(selected, seed, chart, stage));

        var buffer = new ArrayBufferWriter<byte>();
        buffer.Write("["u8);
        for (var step = 0; step < StreamUpdates; step++)
        {
            if (step > 0)
                buffer.Write(","u8);

            buffer.Write(Bytes(Stream(selected, seed, step)));
        }

        buffer.Write("]"u8);
        return buffer.WrittenSpan.ToArray();
    }

    public static ChartOptions Line(int seed, int points, string title)
    {
        var random = new Random(seed);
        var data = new LineSeriesOptionDataItem?[points];
        var value = 100.0;
        for (var i = 0; i < points; i++)
        {
            value += random.NextDouble() - 0.5;
            data[i] = Math.Round(value, 2);
        }

        return new ChartOptions
        {
            Animation = false,
            Title = OneOrMany<TitleOption>.One(new() { Text = title }),
            XAxis = OneOrMany<XAxisOption?>.One(new CategoryAxis()),
            YAxis = OneOrMany<YAxisOption?>.One(new ValueAxis { Scale = true }),
            Series = OneOrMany<SeriesOption>.One(new LineSeriesOption { Name = "Synthetic", ShowSymbol = false, Data = data }),
        };
    }

    // Adjacent bars from 50 to 100 on a 0–100 axis: the lower half of the grid is always over a bar.
    public static ChartOptions Bars(int seed, int bars, string title)
    {
        var random = new Random(seed);
        var data = new BarSeriesOptionDataItem?[bars];
        for (var i = 0; i < bars; i++)
            data[i] = Math.Round(50 + random.NextDouble() * 50, 1);

        return new ChartOptions
        {
            Animation = false,
            Title = OneOrMany<TitleOption>.One(new() { Text = title }),
            Grid = OneOrMany<GridOption>.One(new() { Left = 40, Right = 40, Top = 40, Bottom = 40 }),
            XAxis = OneOrMany<XAxisOption?>.One(new CategoryAxis()),
            YAxis = OneOrMany<YAxisOption?>.One(new ValueAxis { Min = 0d, Max = 100d }),
            Series = OneOrMany<SeriesOption>.One(new BarSeriesOption { Name = "Synthetic bars", BarCategoryGap = "0%", Data = data }),
        };
    }

    public static ChartOptions WordCloud(int seed, int words, string title)
    {
        var random = new Random(seed);
        var names = new HashSet<string>(StringComparer.Ordinal);
        while (names.Count < words)
        {
            var name = string.Concat(Enumerable.Range(0, random.Next(2, 5)).Select(_ => Syllables[random.Next(Syllables.Length)]));
            names.Add(name);
        }

        var data = names.Select((name, rank) => new WordCloudDataItem { Name = name, Value = Math.Round(1000.0 / (rank + 1) + random.Next(0, 5), 1) })
            .ToArray();
        return new ChartOptions
        {
            Animation = false,
            Title = OneOrMany<TitleOption>.One(new() { Text = title }),
            Series = OneOrMany<SeriesOption>.One(new WordCloudSeriesOption
            {
                Name = "Synthetic words",
                Shape = "circle",
                Width = "96%",
                Height = "86%",
                Top = "12%",
                GridSize = 4,
                SizeRange = words > 500 ? [6, 28] : [10, 44],
                RotationRange = [0, 0],
                ShrinkToFit = false,
                LayoutAnimation = true,
                TextStyle = new WordCloudTextStyle { FontFamily = "Arial, sans-serif", Color = "#2f5d8a" },
                Data = data,
            }),
        };
    }
}
