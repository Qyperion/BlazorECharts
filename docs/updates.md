# Updates

A rendered chart changes in three ways: a new `Options` reference, an explicit `UpdateAsync`
after mutating the current options, or an imperative `SetOptionAsync` on the chart instance.
All of them go through one ordered queue per chart.

## Automatic and explicit updates

`EChart` applies `Options` when the parameter gets a different object reference (for
`RawOptions`, a different `JsonElement`). It never compares option graphs: re-rendering the
parent with the same reference does not serialize anything. After mutating the current object,
call `UpdateAsync`.

<!-- snippet: Guides.Updates.Component -->
```razor
<EChart @ref="_chart" Options="_options" Style="height:360px" />
<button @onclick="Replace">Replace</button>
<button @onclick="AppendAsync">Append</button>

@code {
    private EChart? _chart;
    private ChartOptions _options = Build([5, 8, 3]);

    private LineSeriesOption Series => (LineSeriesOption)_options.Series!.Value.Items[0];

    private static ChartOptions Build(double[] values) => new()
    {
        XAxis = new XAxisCategoryOption(),
        YAxis = new YAxisValueOption(),
        Series = new LineSeriesOption { Data = [.. values.Select(v => (LineSeriesOptionDataItem?)v)] },
    };

    // A new reference is applied on the next render.
    private void Replace() => _options = Build([1, 2, 3]);

    // Mutating the current object needs an explicit update.
    private async Task AppendAsync()
    {
        Series.Data = [.. Series.Data!, 4];
        await _chart!.UpdateAsync();
    }
}
```

Each update uses the component's `UpdateOptions` (`SetOptionOptions`) as the native `setOption`
settings. Options and settings are serialized when the update is accepted, so later mutations do
not affect an update that is already queued.

> With the default `UpdateOptions`, ECharts **merges** each new `Options` into the chart, as
> described [below](#merge-replace-and-partial-options): series are matched by `id`, `name` and
> then position, and a series or component without a counterpart in the new options stays on the
> chart. When every `Options` describes the whole chart, for example after switching a data set,
> replace instead of merging.

<!-- snippet: Guides.Updates.Replace -->
```razor
<EChart Options="_options" UpdateOptions="_replace" Style="height:360px" />
<button @onclick="ShowTotal">Total only</button>

@code {
    // Each new Options describes the whole chart: replace the chart instead of merging into it.
    private readonly SetOptionOptions _replace = new() { NotMerge = true };

    private ChartOptions _options = new()
    {
        XAxis = new XAxisCategoryOption { Data = ["Q1", "Q2", "Q3"] },
        YAxis = new YAxisValueOption(),
        Series = [new BarSeriesOption { Name = "North", Data = [12, 20, 17] }, new BarSeriesOption { Name = "South", Data = [18, 22, 21] }],
    };

    // Merged, the new series would take the place of "North" and "South" would stay on the chart.
    private void ShowTotal() => _options = new()
    {
        XAxis = new XAxisCategoryOption { Data = ["Q1", "Q2", "Q3"] },
        YAxis = new YAxisValueOption(),
        Series = [new BarSeriesOption { Name = "Total", Data = [30, 42, 38] }],
    };
}
```

`ReplaceMerge = "series"` replaces only the series and merges the other components.

## Merge, replace and partial options

`EChartInstance.SetOptionAsync` sends a partial or complete option. ECharts merges by default:
components match by `id`, then `name`, then index, and components missing from the new option
stay. A shorter `series` array therefore does not remove series.

<!-- snippet: Guides.Updates.Partial -->
```csharp
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
```

| `SetOptionOptions` | Effect |
|---|---|
| `NotMerge = true` | Replaces the whole option. |
| `ReplaceMerge` | Replaces the listed component types (`"series"`, `"xAxis"`, ...) and merges the rest. |
| `LazyUpdate = true` | Renders in the next animation frame. |
| `Silent = true` | Suppresses the events of this update. |
| `Transition` | Series transition settings for universal transitions. |

Unset settings use the ECharts defaults (`notMerge = false`, `lazyUpdate = false`,
`silent = false`). `SetOptionAsync(options, notMerge, lazyUpdate)` is the legacy boolean overload.
Both typed and `JsonElement` options are accepted.

## Order, backpressure and cancellation

Updates, actions, theme changes, reads and other chart methods run in the order they are
accepted. A read sees all earlier accepted work. The queue holds up to 64 pending operations;
one more throws `InvalidOperationException`, so await imperative calls in loops.

- Consecutive automatic updates with `NotMerge = true` can replace each other before they reach
  the browser. The queue never combines merging updates, but when it is full the component applies
  only the latest parameters (see below), so declarative `Options` should describe the whole
  chart, not only the fields that changed.
- Cancelling before an operation is sent skips it. Cancelling later completes your task, but the
  browser may already have applied the operation.
- A completed update means ECharts accepted the option. It does not mean animation or layout have
  finished; see [stable charts](export.md#wait-for-a-stable-chart).
- Event handlers run outside this queue, so a handler can await chart calls.

## Themes and init options

Changing the `Theme` parameter calls ECharts `setTheme` on the existing chart; `null` selects the
default theme. `EChartInstance.SetThemeAsync` does the same imperatively and accepts a theme name,
a theme object or JSON.

> ECharts 6.1.0 `setTheme` rebuilds the chart from its initial option, so options applied after
> initialization can be reset. Apply such changes again after a theme change.

Changing `InitOptions`, for example from the Canvas to the SVG renderer, recreates the native
chart inside the same component. The current options, including user changes such as legend
selection, carry over to the new chart; theme defaults are reapplied. Subscriptions, the
`EChartInstance` and queued operations move to the new chart. When the container is hidden at that
moment, for example in an inactive tab, the current chart stays and keeps receiving updates,
including new `Options`; the component recreates it with the latest `InitOptions` once the
container has a size again, also when `AutoResize` changed meanwhile. Invalid `InitOptions` that
wait for the container, or for a free queue slot, reach `OnError` as `ChartUpdateFailed` with the
`recreate` operation; later parameters apply as usual.

Updates from parameters never fail because the chart is busy. When 64 operations are already
waiting, for example during frequent live updates over a slow connection, the component keeps
only the latest parameters and applies them as soon as an operation completes; intermediate
renders are skipped. Calls on `EChart.Instance` still throw `InvalidOperationException` when the
queue is full.

## Read the current options

`GetOptionAsync` returns the chart's normalized options as typed `ChartOptions`, read with the
same models. ECharts fills in defaults and turns components into arrays, so the result differs
from the options you supplied. Fields without a typed member are kept in `AdditionalProperties`.
A series whose type has no registered model, such as one from a JavaScript-only extension, is
read as a `RawSeriesOption`. A value that does not fit its typed member, for example a number
where the model expects a string after `RawOptions`, makes `GetOptionAsync` throw a
`JsonException` whose `Path` names the value (`$.title[0].text`).

<!-- snippet: Guides.Updates.Snapshot -->
```csharp
await using var snapshot = await chart.GetOptionAsync();
ChartOptions current = snapshot.Options;   // normalized: components are arrays, defaults are filled in

foreach (var series in current.Series?.Items ?? [])
    Console.WriteLine($"{series.Type}: {series.AdditionalProperties.Count} untyped fields");

// Reapply with the native callbacks and objects the snapshot captured.
await chart.SetOptionAsync(snapshot, new SetOptionOptions { NotMerge = true });
```

On Interactive Server the snapshot is one message from the browser and contains all data of the
chart: a line series with about a thousand category points already exceeds the default limit of
32 KiB, and `GetOptionAsync` throws a `JSException` with the code `ResultTooLarge`. Keep the state
you need in .NET, or read it from events, for example the range from `datazoom`; see
[message size](render-modes.md#message-size-on-interactive-server).

Callbacks, images, DOM elements and typed arrays are not JSON. The snapshot replaces them with
`null` and keeps them as browser references in `Bindings` and `References`. Reapply a snapshot
with `SetOptionAsync(snapshot, ...)` to keep those values. `SetOptionAsync(snapshot.Options)`
sends those `null` placeholders as values, so in a merge it removes the chart's callbacks and
objects at their paths. Keep the snapshot until the call completes, then dispose it. The
snapshot's references are its own: disposing it never affects the chart.

You can edit `snapshot.Options` before reapplying it. A union value read from the snapshot keeps
the alternative that `TryGet` returns, so changes to that object are written. The browser
references are bound by position: after you add, remove or reorder components or data items on
the path of a reference, or assign your own value at its path, `SetOptionAsync(snapshot, ...)`
throws an `InvalidOperationException` that names the path. Components keep their `id`, so
appending one is allowed; for data items without an `id` any change in the array length is
rejected. Apply such edits as new options with their own values instead of the snapshot.

## Large data

A chart with tens of thousands of points costs time in three places: serializing and sending
its options, drawing them, and every message that carries the data back.

- **Draw less.** `Sampling` on line and bar series in a grid (`"lttb"`, `"average"`, `"min"`,
  `"max"`, `"minmax"`, `"sum"`) draws a representative subset when there are more points than
  pixels. `Large = true` on bar, scatter, lines and candlestick series draws all items in one batch,
  without per-item styles, once there are more than `LargeThreshold` items. Scatter, lines,
  heatmap, custom, parallel and large bar and candlestick series render progressively: once there
  are more than `ProgressiveThreshold` items, they draw `Progressive` items per animation frame.
  Turn `Animation` off for large data.
- **Send the data once.** Put the data into a `Dataset` that several series read through
  `DatasetIndex` and `Encode`, instead of repeating it in every series; see
  [datasets](options.md#datasets-and-open-values). `AppendDataAsync` adds points to a `scatter`
  or `lines` series without sending the existing points again; see
  [incremental data](chart-api.md#incremental-data). A [merging update](#merge-replace-and-partial-options)
  that changes only titles, colors or axes leaves out the data.
- **Keep the data in the browser.** A module can load the data itself, for example from a binary
  file, and return a typed array. .NET then holds only a [reference](graphic-and-references.md#native-objects-from-modules),
  and the points never travel through .NET or the circuit. A dataset or a series takes a flat
  typed array with its `Dimensions`:

<!-- snippet: Guides.Updates.LargeData -->
```csharp
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
```

On Interactive Server the options travel through the circuit: a line of 100,000 points is about
660 KB of JSON for every full update, which every connected user sends over their own circuit.
Only messages from the browser are limited, so sending works, but `GetOptionAsync` of such a chart
exceeds the [message size](render-modes.md#message-size-on-interactive-server) and throws
`ResultTooLarge`; so do event payloads with many items, such as `brushselected`. Measurements
for both render modes are in the [performance baseline](compatibility/performance-baseline.md).

## Clearing and loading

`ClearAsync` removes all components and series. `ShowLoadingAsync` and `HideLoadingAsync` show
the ECharts loading animation; see [chart and runtime API](chart-api.md).
