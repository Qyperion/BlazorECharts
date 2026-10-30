# Export

Exports capture what the chart shows after its latest accepted update. Every export first waits
for a stable chart, so an image never misses a late animation frame, image, font or WordCloud word.

## Wait for a stable chart

`OnReady`, a completed `SetOptionAsync` and the ECharts `rendered` event do not mean the chart has
finished drawing. `AwaitStableAsync` waits until:

- animations, lazy updates, progressive rendering and pending actions have finished;
- images used by the options or the background are loaded and decoded;
- document fonts that are loading have loaded;
- extensions, such as the WordCloud layout, report completion.

<!-- snippet: Guides.Export.Stable -->
```csharp
await chart.AwaitStableAsync(new ChartStabilityOptions { Timeout = TimeSpan.FromSeconds(5) });

await using var canvas = await chart.RenderToCanvasAsync();   // a browser canvas, not pixels in .NET
```

`ChartStabilityOptions.Timeout` (30 seconds by default) limits the whole operation, including
queueing, image decoding and retries. It must be greater than zero: setting zero or a negative
value throws `ArgumentOutOfRangeException`. When the timeout expires, the call throws
`TimeoutException`. Cancellation and disposal of the chart cancel the wait. A failed image or
extension layout rejects the wait.

Looping effects never finish: `effectScatter` ripples and the trail effect of `lines` keep
animating, so a chart that shows them never becomes stable and every export times out. Disable
the effect before exporting, or do not export such charts.

A browser gives no animation frames to a page in a background tab or a minimized window, and
Chromium on Windows also to a window that another window covers. Animations there stop, so the
wait can time out too. Wait for the page to become visible (`document.visibilityState`) and call
`AwaitStableAsync` or the export again.

An export captures the latest accepted update. When `SetOptionAsync`, an action or a resize is
accepted while the capture waits, the export waits for that update too and captures again. A
chart that updates continuously, for example from a timer or a live feed faster than one capture,
therefore times out the same way, in WebAssembly as well. Pause the updates for the export and
resume them afterwards.

## PNG and JPEG

<!-- snippet: Guides.Export.Png -->
```csharp
string png = await chart.GetDataUrlAsync(
    new ChartDataUrlOptions { Type = ChartImageFormat.Png, PixelRatio = 2, BackgroundColor = "#ffffff" },
    new ChartStabilityOptions { Timeout = TimeSpan.FromSeconds(10) },
    cancellationToken);
// png is "data:image/png;base64,..."
```

`ChartDataUrlOptions` has `Type` (`Png`, `Jpeg`, `Svg`), `PixelRatio`, `BackgroundColor` and
`ExcludeComponents` (for example `["toolbox"]`). Unset options keep the ECharts defaults. PNG and
JPEG need the Canvas renderer; without `Type`, `GetDataUrlAsync` uses the chart's renderer.

## SVG

<!-- snippet: Guides.Export.Svg -->
```csharp
// Requires InitOptions.Renderer = "svg".
string markup = await svgChart.RenderToSvgStringAsync(new ChartSvgExportOptions { UseViewBox = true });
string dataUrl = await svgChart.GetSvgDataUrlAsync();
```

SVG markup and SVG data URLs need the SVG renderer
(`InitOptions = new() { Renderer = "svg" }`). Exporting a format the renderer cannot produce
throws with the code `ExportRendererUnsupported`.

The markup contains attribute values from the options unescaped. Never insert it with
`MarkupString`; show the data URL as an image instead (`<img src="@dataUrl">`). See
[SVG export](security.md#svg-export).

## Canvas

`RenderToCanvasAsync` returns the rendered canvas as a [browser reference](graphic-and-references.md).
ECharts may reuse that canvas for later frames, so retaining the reference does not freeze its
pixels. `GetRenderedCanvasAsync` is the deprecated ECharts alias.

## Connected charts

`GetConnectedDataUrlAsync` draws all [connected charts](events.md#connected-charts) into one
image. It waits for every member, including charts of other components, and retries when any
member accepts new work before the capture.

<!-- snippet: Guides.Export.Connected -->
```csharp
await runtime.ConnectAsync([first, second]);
string both = await first.GetConnectedDataUrlAsync(
    new ChartConnectedDataUrlOptions { Type = ChartImageFormat.Png, ConnectedBackgroundColor = "#ffffff" });
```

ECharts 6.1.0 limitations:

- Connected **SVG** export fails inside ECharts itself; the call throws with the code
  `ExportUpstreamFailed`. Connected PNG and JPEG, and SVG of a single chart, work.
- ECharts ignores `ExcludeComponents` for connected exports.

## Large results in Interactive Server

In Interactive Server, the image string travels to .NET as one SignalR message. A PNG often
exceeds the default limit of 32 KiB, and the export then throws `ResultTooLarge`.
Raise both limits for the expected image size, or let the browser download the image itself with
a module function; see [message size](render-modes.md#message-size-on-interactive-server).

## Exports of extensions

An extension with asynchronous rendering takes part in stability through `stabilityParticipant`
of `_content/BlazorECharts/js/blazor-echarts.js`. Call `begin(name, scope)` synchronously when its
work starts, after the chart accepted the update, and settle the ticket when the work ends:

```javascript
import { stabilityParticipant } from '../_content/BlazorECharts/js/blazor-echarts.js';

const ticket = stabilityParticipant(nativeChart).begin('my-layout', 'layout');
layout.then(() => ticket.complete(), error => ticket.fail(error));
// A new update replaces the layout: ticket.retire(), then begin a ticket for the new layout.
```

The scope is required and decides when stable waits stop waiting for an unsettled ticket:

| Scope | The ticket ends | Use it for |
|---|---|---|
| `'layout'` | When it is settled or retired, or the chart is recreated | Work that a later action or resize does not restart, such as the WordCloud layout |
| `'revision'` | Also at the next render revision: any `SetOptionAsync`, action or resize drops it | Work that every render redoes |

Another scope, or none, throws `LayoutScopeInvalid`. The ticket is a frozen object:

- `complete()` ends the work.
- `fail(error)` and `cancel()` reject stable waits with `LayoutFailed` and `LayoutCancelled`. A
  `'layout'` ticket keeps rejecting them until it is retired or the chart is recreated; a
  `'revision'` ticket, until the next render revision. `fail` also raises a
  [`blazorecharts:error`](errors.md#browser-error-event) event with the code `LayoutFailed` on the
  chart container.
- `retire()` removes a superseded ticket without an error, including its failure.
- `generation`, `revision` and `token` identify the chart generation, the render revision the
  ticket began in, and the ticket.

Only the first of `complete`, `fail` and `cancel` counts. A ticket of an older update cannot
complete or fail the current one.

`stabilityParticipant` throws `ChartDisposed` for a chart that the library does not own, for
example one created with `getECharts().init(...)`. `tryStabilityParticipant` returns `null`
instead, so an extension can skip the ticket for such charts. The WordCloud package uses this
contract.
