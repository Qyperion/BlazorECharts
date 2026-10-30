using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace DocumentationExamples.Guides;

internal static class EventsExamples
{
    internal static async Task Query(EChartInstance chart)
    {
        // snippet: Guides.Events.Query
        // Only clicks on the series named "Votes".
        await using var votes = await chart.SubscribeAsync(ChartEvents.Click, e => Task.CompletedTask,
            EventQuery.Select(component: "series", name: "Votes"));

        // At most one delivery per 200 ms; intermediate events are dropped.
        await using var moves = await chart.SubscribeAsync(ChartEvents.MouseMove, e => Task.CompletedTask,
            EventQuery.Component("series").WithThrottle(TimeSpan.FromMilliseconds(200)));
        // endsnippet
    }

    internal static async Task Actions(EChartInstance chart)
    {
        // snippet: Guides.Events.Actions
        await chart.DispatchActionAsync(new HighlightAction { SeriesIndex = 0, DataIndex = 2 });
        await chart.DispatchActionAsync(new ShowTipAction { SeriesIndex = 0, DataIndex = 2 });
        await chart.DispatchActionAsync(new LegendToggleSelectAction { Name = "Votes" });

        // The native settings object: silent dispatch, flushed immediately.
        await chart.DispatchActionAsync(new DispatchActionOptions(new DownplayAction { SeriesIndex = 0 }) { Silent = true, Flush = true });
        // endsnippet
    }

    internal static async Task Raw(EChartInstance chart)
    {
        // snippet: Guides.Events.Raw
        await using var brush = await chart.SubscribeAsync(ChartEvents.BrushSelected, e =>
        {
            JsonElement payload = e.Raw;   // the complete serializable payload, unknown fields included
            Console.WriteLine(payload.GetRawText());
            return Task.CompletedTask;
        });

        // An event without a typed descriptor, for example one emitted by an extension.
        var custom = new ChartEvent<JsonElement>("productselected", json => json);
        await using var selected = await chart.SubscribeAsync(custom, json => Task.CompletedTask);
        // endsnippet
    }

    internal static async Task Retain(EChartsRuntime runtime, EChartInstance chart, List<EChartsObjectReference> kept)
    {
        // snippet: Guides.Events.Retain
        await using var roots = await chart.SubscribeAsync(ChartEvents.TreemapRootToNode, async e =>
        {
            foreach (var entry in e.NativeReferences.EnumerateArray())
            {
                // Native values are valid only during the handler unless they are retained.
                kept.Add(await runtime.RetainReferenceAsync(entry.GetProperty("reference")));
            }
        });
        // endsnippet
    }

    internal static async Task Connect(EChartsRuntime runtime, EChartInstance first, EChartInstance second)
    {
        // snippet: Guides.Events.Connect
        string group = await runtime.ConnectAsync([first, second]);

        // Tooltips, highlights and data zoom now follow each other.
        await runtime.DisconnectAsync(group);
        // endsnippet
    }
}
