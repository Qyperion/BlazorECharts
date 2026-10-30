# Chart and runtime API

`EChartInstance` is the .NET handle of one native ECharts instance; `EChart.Instance` and
`OnReady` provide it. `EChartsRuntime` is the scoped service that loads ECharts on the page,
creates instances and holds page-wide registrations. The method names follow ECharts:
`setOption` is `SetOptionAsync`, `getDataURL` is `GetDataUrlAsync`.

## Instance methods

<!-- snippet: Guides.ChartApi.Methods -->
```csharp
await chart.ResizeAsync(new ChartResizeOptions { Width = 640, Height = 360, Silent = true });
double width = await chart.GetWidthAsync();

await chart.ShowLoadingAsync(new ChartLoadingOptions { Text = "Loading…" });
await chart.HideLoadingAsync();

// Data coordinates of the first series to pixels and back.
var series = ChartFinder.Select("series", index: 0);
ChartPixelValue pixel = await chart.ConvertToPixelAsync(series, CoordinateValue.Array("Tue", 18));
ChartPixelValue data = await chart.ConvertFromPixelAsync(series, pixel.Numbers!);
bool inside = await chart.ContainPixelAsync(ChartFinder.Select("grid", index: 0), [120, 80]);
```

| Area | Methods |
|---|---|
| Options | `SetOptionAsync`, `GetOptionAsync`, `ClearAsync`, `AppendDataAsync` ([updates](updates.md)) |
| Size and state | `ResizeAsync`, `GetWidthAsync`, `GetHeightAsync`, `GetDevicePixelRatioAsync`, `GetIdAsync`, `IsDisposedAsync`, `IsSsrAsync` |
| Coordinates | `ConvertToPixelAsync`, `ConvertFromPixelAsync`, `ConvertToLayoutAsync`, `ContainPixelAsync`, `GetVisualAsync` |
| Events and actions | `SubscribeAsync`, `DispatchActionAsync`, `MakeActionFromEventAsync`, `TriggerAsync`, `TriggerWithContextAsync`, `IsSilentAsync` ([events](events.md)) |
| Theme and loading | `SetThemeAsync`, `ShowLoadingAsync`, `HideLoadingAsync`, `UpdateLabelLayoutAsync` |
| Groups | `SetGroupAsync`, `GetGroupAsync` ([connected charts](events.md#connected-charts)) |
| Export | `AwaitStableAsync`, `GetDataUrlAsync`, `GetConnectedDataUrlAsync`, `GetSvgDataUrlAsync`, `RenderToSvgStringAsync`, `RenderToCanvasAsync` ([export](export.md)) |
| Browser objects | `GetDomAsync`, `GetZrAsync` ([references](graphic-and-references.md)) |

- Every method takes a `CancellationToken` and runs in the chart's ordered queue.
- `ChartFinder.Select(component, index, id, name, dataIndex, dataIndexInside)` selects components
  as the ECharts finder object; `ChartFinder.Component("series")` is the string form. A component without an
  index, id or name selects index 0, as in ECharts.
- `CoordinateValue` holds numbers, strings, dates and arrays. Conversion results keep the
  scalar or array shape in `ChartPixelValue.Scalar` or `Numbers`; ECharts' `NaN` for a missing
  axis stays `double.NaN`. On a time axis the data values are milliseconds since the epoch (see
  [dates](options.md#dates-and-time-zones)).
- `IsDisposed` reports the .NET handle; `IsDisposedAsync` asks ECharts. `Id` is the handle's
  identity; `GetIdAsync` returns the native instance id.

## Ownership

`EChart` owns `EChart.Instance` and disposes it with itself. Disposing that handle elsewhere,
with `DisposeAsync` or `EChartsRuntime.DisposeChartAsync`, moves the component to `Failed` and
reports `ChartDisposed` to `OnError`; `InitializeAsync` then creates a new handle. Remove the
component instead when the chart should go away. A handle from `CreateInstanceAsync` is yours to
dispose.

## Threads

`EChartInstance` and `EChartsRuntime` may be called from any thread, for example from a timer.
Calls on one chart run one at a time, in the order they were made, in the chart's queue of at
most 64 pending calls. Calls on different charts run concurrently, and their options stay apart on
the way to the browser. An awaited call completes when the browser has applied it, which is not
yet a stable layout (see [export](export.md#wait-for-a-stable-chart)). Event handlers run outside the queue, so they can
await other calls on the same chart; wrap UI changes in `InvokeAsync`. `EChart.InitializeAsync`
and `UpdateAsync` move to the component's dispatcher themselves.

## Accessibility

Name a chart for assistive technology with `ChartOptions.Aria`: ECharts then sets `role="img"`
and an `aria-label` on the container, either `Label.Description` or a summary generated from the
series and data. Other container attributes pass through `EChart` as unmatched attributes, for
example `id` or `aria-describedby` for a text summary next to the chart:

<!-- snippet: Guides.ChartApi.Accessibility -->
```razor
<EChart Options="_options" Style="height:300px" id="sales-chart" aria-describedby="sales-summary" />
<p id="sales-summary">Sales grew in every quarter of 2026.</p>

@code {
    private readonly ChartOptions _options = new() { Aria = new AriaOption { Enabled = true } };
}
```

`Class` and `Style` are parameters, and `data-chart-state` is reserved. With labels enabled,
ECharts overwrites `role` and `aria-label` attributes of the container.

## Incremental data

<!-- snippet: Guides.ChartApi.Append -->
```csharp
// Incremental rendering for scatter and lines series with explicit data.
await chart.AppendDataAsync(0, EChartsValue.Array(
    EChartsValue.Array(EChartsValue.From(1.5), EChartsValue.From(3.2)),
    EChartsValue.Array(EChartsValue.From(2.1), EChartsValue.From(4.8))));
```

ECharts supports `appendData` for `scatter` and `lines` series with their own `data`; other series
and dataset-backed series throw `AppendDataUnsupported`. ECharts does not recompute axis extents
for appended data, so set axis `Min` and `Max` beforehand.

## The page runtime

`EChart` uses `EChartsRuntime` for you. Use it directly to register [themes, locales, maps and
custom series](extensions.md), to create [images and other browser objects](graphic-and-references.md),
to [connect charts](events.md#connected-charts), or to create an instance on your own element:

<!-- snippet: Guides.ChartApi.Runtime -->
```csharp
await runtime.InitializeAsync();   // loads ECharts; also retries a failed load
await using var chart = await runtime.CreateInstanceAsync(element, new() { Renderer = "canvas" }, theme: "dark");
await chart.SetOptionAsync(new BlazorECharts.Options.ChartOptions());
// Disposing the handle disposes the native chart; the page runtime stays loaded.
```

- Each service scope has its own `EChartsRuntime`. All of them share one page runtime: one loaded
  ECharts module, one set of registrations.
- `InitializeAsync` loads ECharts once. After a failure, for example a failed module import, the
  next `InitializeAsync` tries again; there is no automatic retry.
- `CreateInstanceAsync` rejects an element that already has a chart.
  `GetInstanceByDomAsync` returns only charts that this runtime created.
- Disposing the runtime disposes its charts and subscriptions, not the page registrations.
  `DisposeChartAsync` disposes one of its charts by handle, native id or DOM element.
- `Serialization` is the runtime's serialization context, used to register
  [custom data types](options.md#custom-data-types).

Global ECharts methods with typed parameters are `RegisterThemeAsync`, `RegisterLocaleAsync`,
`RegisterMapAsync`, `RegisterSvgMapAsync`, `GetMapAsync`, `RegisterCustomSeriesAsync`,
`ConnectAsync` and `DisconnectAsync`. Methods that pass browser values go through
[native helpers](graphic-and-references.md#native-helpers-and-constructors).
