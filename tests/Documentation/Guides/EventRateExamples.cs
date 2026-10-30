using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Runtime;

namespace DocumentationExamples.Guides;

internal static class EventRateExamples
{
    internal static async Task<IAsyncDisposable> Sequential(ChartOptions options, EChartInstance chart, Func<BrushSelectedEvent, Task> saveAsync)
    {
        // snippet: Guides.Events.ServerRate
        // One brushselected event after the pointer rests for 300 ms, instead of one per pointer move.
        options.Brush = new BrushOption { ThrottleType = "debounce", ThrottleDelay = 300 };

        // Deliveries of one subscription can overlap at every await: handle them one at a time.
        var gate = new SemaphoreSlim(1, 1);
        var selection = await chart.SubscribeAsync(ChartEvents.BrushSelected, async e =>
        {
            await gate.WaitAsync();
            try
            {
                await saveAsync(e);
            }
            finally
            {
                gate.Release();
            }
        });
        // endsnippet
        return selection;
    }
}
