# Events and actions

ECharts reports user interaction and chart changes as events and accepts actions that change the
chart state. `ChartEvents` lists the documented ECharts 6.1.0 events with typed payloads; every
documented action has a typed model deriving from `ChartAction`.

## Subscribe

`SubscribeAsync` attaches a native listener and returns a `ChartSubscription<TEvent>`. No listener exists
until you subscribe; dispose the subscription when you no longer need it.

<!-- snippet: Guides.Events.Subscribe -->
```razor
@implements IAsyncDisposable

<EChart Options="_options" Style="height:360px" OnReady="SubscribeAsync" />
<p>@_selected</p>

@code {
    private readonly ChartOptions _options = new()
    {
        XAxis = new XAxisCategoryOption { Data = ["A", "B", "C"] },
        YAxis = new YAxisValueOption(),
        Series = new BarSeriesOption { Name = "Votes", Data = [5, 8, 3] },
    };

    private ChartSubscription? _click;
    private string? _selected;

    private async Task SubscribeAsync(EChartInstance chart)
    {
        _click = await chart.SubscribeAsync(ChartEvents.Click, e => InvokeAsync(() =>
        {
            _selected = $"{e.SeriesName}: {e.Name}";
            StateHasChanged();
        }));
    }

    public async ValueTask DisposeAsync()
    {
        if (_click is not null)
            await _click.DisposeAsync();
    }
}
```

- The handler returns `Task` and runs outside the chart's command queue, so it can await other
  chart calls. Wrap UI changes in `InvokeAsync` and call `StateHasChanged`.
- Each subscription is independent. `ReplaceHandler` swaps the handler, of the same payload type,
  without a new native listener.
- When the chart is [recreated](updates.md#themes-and-init-options), live subscriptions attach
  to the new chart. Disposing the chart or the component releases its subscriptions.
- A handler that throws is reported on the container's `blazorecharts:error` DOM event with the
  code `EventHandlerFailed` and logged at `Error`, with a rate limit (see
  [errors](errors.md#onerror)).

## Filter and throttle

`EventQuery` is the ECharts event query, evaluated by ECharts itself. `Component("series.bar")`
filters by component type; `Select` builds an object query from component and data selectors;
`FromJson` passes any query object. Throttling is opt-in: the first event of each interval is
delivered, the rest are dropped, including the last one. After a drag, the final `datazoom` or
`brushselected` event can be among the dropped ones. Subscribe to `datazoom` without a throttle
when you need the final range: its payload is small. Reading the range from `GetOptionAsync`
returns the whole option with all data, which on Interactive Server soon exceeds the
[message size](render-modes.md#message-size-on-interactive-server) and throws `ResultTooLarge`.
For brush selections, let ECharts debounce the events instead (see
[event rate](#event-rate-on-interactive-server)).

<!-- snippet: Guides.Events.Query -->
```csharp
// Only clicks on the series named "Votes".
await using var votes = await chart.SubscribeAsync(ChartEvents.Click, e => Task.CompletedTask,
    EventQuery.Select(component: "series", name: "Votes"));

// At most one delivery per 200 ms; intermediate events are dropped.
await using var moves = await chart.SubscribeAsync(ChartEvents.MouseMove, e => Task.CompletedTask,
    EventQuery.Component("series").WithThrottle(TimeSpan.FromMilliseconds(200)));
```

### Event rate on Interactive Server

On Interactive Server every delivered event is a separate message from the browser to the
server, with no batching. Pointer events fire at the frame rate, and a brush with the ECharts
defaults (`throttleType: 'fixRate'`, `throttleDelay: 0`) sends `brushselected` with every
selected index on each pointer move. Deliveries of one subscription are not queued: when a
handler awaits, the next event can start the handler again.

- Subscribe only to the events you handle, and throttle pointer events with `WithThrottle`.
- Debounce the brush, so that ECharts emits one event when the pointer rests.
- Serialize slow handlers yourself:

<!-- snippet: Guides.Events.ServerRate -->
```csharp
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
```

A payload over the [message size limit](render-modes.md#message-size-on-interactive-server) is not
delivered: the container raises `EventTooLarge` instead.

## Payloads

Payload properties are the documented fields of the event. A field that the event did not include
is `null`; an index of `null` does not mean zero. Indices such as `SeriesIndex` and `DataIndex` are
`int?`; other numbers are `double?`. Fields with several possible shapes are
`EventActionValue`, read with `TryGetNumber`, `TryGetString`, `TryGetNumbers`, `TryGetStrings` and
similar methods. Actions take such a field as a number, a string, a boolean, a `double[]` or a
`string[]`: `SeriesId = new[] { "a", "b" }` selects two series.
`Raw` holds the complete payload as JSON, including fields without a typed member.

<!-- snippet: Guides.Events.Raw -->
```csharp
await using var brush = await chart.SubscribeAsync(ChartEvents.BrushSelected, e =>
{
    JsonElement payload = e.Raw;   // the complete serializable payload, unknown fields included
    Console.WriteLine(payload.GetRawText());
    return Task.CompletedTask;
});

// An event without a typed descriptor, for example one emitted by an extension.
var custom = new ChartEvent<JsonElement>("productselected", json => json);
await using var selected = await chart.SubscribeAsync(custom, json => Task.CompletedTask);
```

`ChartEvent<T>` with your own reader subscribes to any event name, for example events of an
extension. ECharts emits lowercase event names.

### Browser objects in payloads

Some events carry browser objects, such as tree nodes or DOM events. They are not JSON: the payload
lists them in `NativeReferences` as `{ path, reference }` entries, valid until the handler
completes. Retain one with `EChartsRuntime.RetainReferenceAsync` to keep it, and dispose the
returned reference when done:

<!-- snippet: Guides.Events.Retain -->
```csharp
await using var roots = await chart.SubscribeAsync(ChartEvents.TreemapRootToNode, async e =>
{
    foreach (var entry in e.NativeReferences.EnumerateArray())
    {
        // Native values are valid only during the handler unless they are retained.
        kept.Add(await runtime.RetainReferenceAsync(entry.GetProperty("reference")));
    }
});
```

## Dispatch actions

<!-- snippet: Guides.Events.Actions -->
```csharp
await chart.DispatchActionAsync(new HighlightAction { SeriesIndex = 0, DataIndex = 2 });
await chart.DispatchActionAsync(new ShowTipAction { SeriesIndex = 0, DataIndex = 2 });
await chart.DispatchActionAsync(new LegendToggleSelectAction { Name = "Votes" });

// The native settings object: silent dispatch, flushed immediately.
await chart.DispatchActionAsync(new DispatchActionOptions(new DownplayAction { SeriesIndex = 0 }) { Silent = true, Flush = true });
```

Actions enter the same ordered queue as updates. `DispatchActionAsync(action, silent)` is the
legacy boolean overload. An action's typed properties are its documented payload; other fields go
into `AdditionalProperties`. To dispatch an action of an extension, derive from `ChartAction` and
register its writer as for [custom series types](extensions.md#custom-series-types).

Notes on specific actions in ECharts 6.1.0:

- `DragNodeAction` moves a **Sankey** node; it is not a graph-node drag.
- `FocusNodeAdjacencyAction` and `UnfocusNodeAdjacencyAction` emit their events but no longer
  change graph emphasis. Use `Emphasis.Focus = "adjacency"` on the graph series instead.
- `ShowTipAction` and `HideTipAction` deliver `ChartEvents.ShowTip` and `ChartEvents.HideTip`.
  Subscribe before dispatching.

`MakeActionFromEventAsync` turns an event payload into the matching action payload.
`TriggerAsync` and `TriggerWithContextAsync` raise an event on the chart, as the native `trigger`
and `triggerWithContext`.

## Connected charts

Connected charts share tooltips, highlights, legend selection and data zoom, and can be
[exported together](export.md#connected-charts).

<!-- snippet: Guides.Events.Connect -->
```csharp
string group = await runtime.ConnectAsync([first, second]);

// Tooltips, highlights and data zoom now follow each other.
await runtime.DisconnectAsync(group);
```

`ConnectAsync(string group)` connects the charts whose `SetGroupAsync` set that group. Charts of
different components and runtime instances on one page can be connected. Disconnecting stops the
sharing and keeps the group membership; disposing a chart removes it from its group.
