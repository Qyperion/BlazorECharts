using BlazorECharts;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace DocumentationExamples.Guides;

internal static class UpdatesExamples
{
    internal static async Task Partial(EChart component)
    {
        // snippet: Guides.Updates.Partial
        EChartInstance chart = component.Instance!;

        // Merge: adds or updates the series with id "forecast"; other series stay.
        await chart.SetOptionAsync(new ChartOptions
        {
            Series = [new LineSeriesOption { Id = "forecast", Data = [6, 9, 7] }],
        });

        // Replace the series array: series missing from the option are removed.
        await chart.SetOptionAsync(
            new ChartOptions { Series = [new LineSeriesOption { Id = "actual" }] },
            new SetOptionOptions { ReplaceMerge = "series" });

        // Replace everything.
        await chart.SetOptionAsync(BuildCompleteOptions(), new SetOptionOptions { NotMerge = true });
        // endsnippet
    }

    internal static async Task Snapshot(EChartInstance chart)
    {
        // snippet: Guides.Updates.Snapshot
        await using var snapshot = await chart.GetOptionAsync();
        ChartOptions current = snapshot.Options;   // normalized: components are arrays, defaults are filled in

        foreach (var series in current.Series?.Items ?? [])
            Console.WriteLine($"{series.Type}: {series.AdditionalProperties.Count} untyped fields");

        // Reapply with the native callbacks and objects the snapshot captured.
        await chart.SetOptionAsync(snapshot, new SetOptionOptions { NotMerge = true });
        // endsnippet
    }

    internal static async Task LargeData(EChartsRuntime runtime, EChartInstance chart)
    {
        // snippet: Guides.Updates.LargeData
        // js/telemetry.js exports load(url): it fetches binary samples and returns a Float64Array
        // [time0, value0, time1, value1, ...]. The points stay in the browser.
        await using var samples = await runtime.ImportObjectAsync("js/telemetry.js", "load", [EChartsValue.From("data/sensor-42.bin")]);

        await chart.SetOptionAsync(new ChartOptions
        {
            Animation = false,
            Dataset = new DatasetOption
            {
                Dimensions = [new DimensionDefinitionLooseAlternative { Name = "time", Type = "time" }, "value"],
                Source = OptionArrayLike<double?>.From(samples),
            },
            XAxis = new XAxisTimeOption(),
            YAxis = new YAxisValueOption(),
            DataZoom = [new InsideDataZoomOption(), new SliderDataZoomOption()],
            // Draws a representative subset when there are more points than pixels.
            Series = new LineSeriesOption { Sampling = "lttb", ShowSymbol = false },
        });
        // endsnippet
    }

    private static ChartOptions BuildCompleteOptions() => new();
}
