# Render modes

`EChart` does not choose a render mode; the page or the host does. Charts work in Interactive
Server, Interactive WebAssembly, Interactive Auto and standalone WebAssembly. The verified hosts
and browsers are listed in [hosting and browser compatibility](compatibility/hosting.md).

## Registration

Every project that renders charts interactively calls `AddECharts`, and `AddWordCloud` when it
uses word clouds. In a Blazor Web App with WebAssembly or Auto components, register in both the
server project and the client project:

<!-- snippet: Guides.RenderModes.WebApp -->
```csharp
// Program.cs of a Blazor Web App (server project)
using BlazorECharts.Runtime;

builder.Services.AddECharts();
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents()
    .AddInteractiveWebAssemblyComponents();
```

The client project calls `builder.Services.AddECharts()` in its own `Program.cs`. A standalone
WebAssembly app registers the same way. Extensions must be registered identically in every host
that renders the same charts.

## Prerendering and static rendering

During prerendering and static server rendering, `EChart` renders the empty container with
`data-chart-state="NotInitialized"` and performs no JavaScript interop. When the component
becomes interactive, the chart initializes in the same container. Give the container its size
in CSS so that the page layout does not shift.

## Interactive Server

- Charts live in the browser; the circuit sends options and receives results and events. Each
  result and each event is one SignalR message with a size limit; see
  [message size](#message-size-on-interactive-server).
- Events are not delivered while the connection is down; the chart container reports one
  `CircuitDisconnected` on the [DOM error event](errors.md#browser-error-event) instead.
- Browser callbacks are [module or inline functions](functions.md) and run without a round trip.
- When the connection drops and the circuit is retained, the charts keep working and are not
  recreated after reconnection. A reply lost in the outage ends its call after the JS interop call
  timeout with a `TimeoutException` (`ResultTimeout`): `EChart` reports a lost update to `OnError`
  as `ChartUpdateFailed` and applies the parameters that follow. Events sent just before the outage
  was detected are dropped. A chart container removed during the outage disposes its component
  after reconnection. If the circuit is lost, the browser disposes charts whose elements are
  removed; pending .NET calls throw `JSDisconnectedException`.
- While the connection is down, browser errors are still reported on the
  [DOM error event](errors.md#browser-error-event). The library detects the outage from the
  `components-reconnect-state-changed` event of a reconnect UI such as the template's
  `ReconnectModal`, or from Blazor's default reconnect overlay. A host that replaces the
  reconnection handler and shows neither must dispatch that event itself, with `detail.state`
  `"show"` when the connection drops and `"hide"` when it returns.

### Message size on Interactive Server

The circuit sends options to the browser without a size limit, but every message from the browser
to .NET is limited by `HubOptions.MaximumReceiveMessageSize`, 32 KiB by default. Only Interactive
Server has this limit; WebAssembly and other hosts that run .NET in process, such as Blazor Hybrid,
do not. Each of these is one such message:

| Message | Grows with |
|---|---|
| Exports: `GetDataUrlAsync`, `GetConnectedDataUrlAsync`, `GetSvgDataUrlAsync`, `RenderToSvgStringAsync` | Image size and pixel ratio |
| `GetOptionAsync` | All data of the chart: a line series with about a thousand category points already exceeds 32 KiB |
| `GetMapAsync` | The registered GeoJSON |
| `InvokeNativeAsync` and the results of other methods | The returned value |
| An event payload | The event: `brushselected` with several thousand selected points, tree and treemap events with about a thousand nodes |

A result or event larger than `EChartsRuntimeOptions.MaximumServerResultSize` (32 KiB by default)
stays in the browser, and the circuit keeps working. The call throws a `JSException` with the code
`ResultTooLarge`; the event is not delivered, and the container raises `EventTooLarge` on the
[DOM error event](errors.md#browser-error-event).

A call whose reply does not arrive within the JS interop call timeout throws a `TimeoutException`
with the code `ResultTimeout`. The timeout is `CircuitOptions.JSInteropDefaultCallTimeout`, 1 minute
by default; raise it when large results travel over slow connections.

A message larger than `MaximumReceiveMessageSize` closes the circuit. That happens only when
`MaximumServerResultSize` is null or higher than the hub limit: the browser console shows
`Connection disconnected with error 'Error: Server returned an error on close: Connection closed
with an error.'`, the reconnect UI appears, and with SignalR logging at `Debug` the server logs an
`InvalidDataException` about the maximum message size.

To stay within the limit:

- Read less. Subscribe only to the events you handle and filter them with `EventQuery`; call
  `GetOptionAsync` only when you need the whole option; let a module function download an
  exported image in the browser instead of returning it to .NET.
- Make events less frequent; see [event rate](events.md#event-rate-on-interactive-server).
- Raise both limits together, to the size of your largest result or event:

<!-- snippet: Guides.RenderModes.ResultLimit -->
```csharp
// Only for results or events larger than 32 KiB: a larger limit costs server memory per message.
const long limit = 512 * 1024;
builder.Services.AddECharts(options => options.MaximumServerResultSize = limit);
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents()
    .AddHubOptions(options => options.MaximumReceiveMessageSize = limit);
```

A larger limit lets every client send messages of that size. As the
[ASP.NET Core guidance](https://learn.microsoft.com/aspnet/core/blazor/fundamentals/signalr#maximum-receive-message-size)
notes, that costs server memory and raises the risk of denial-of-service attacks, so raise it
only as far as you need.

## Interactive WebAssembly and Auto

- Options are serialized in the browser. Large option graphs cost more than on Server; see the
  [performance baseline](compatibility/performance-baseline.md).
- Auto starts on the Server circuit and switches to WebAssembly on a later page load, once the
  runtime is cached. Register the services in both projects so both phases work.
- Trimmed and AOT-compiled publishing is supported. Custom data types need source-generated
  `System.Text.Json` metadata; see [chart options](options.md#custom-data-types) and
  [trimming and AOT](compatibility/wasm-aot.md).

## Several charts and scopes

`EChartsRuntime` is a scoped service over one page runtime. Charts in different components share
the loaded ECharts module and page registrations, also between Interactive Server and WebAssembly
components on one page. Disposing a scope disposes only its own charts. A scope disposed
synchronously, as in a bUnit test with `using var context = new BunitContext()`, starts that
release without waiting for the browser; `DisposeAsync` waits for it.

## Loading the scripts early

The first chart of a page imports the interop module `_content/BlazorECharts/js/runtime-loader.js`,
which imports ECharts, `_content/BlazorECharts/js/echarts-6.1.0.js` (about 1.1 MB before
compression). Both downloads start only when the first chart initializes, after the page has
become interactive. To download them while the page loads, add `modulepreload` links after
`<ImportMap />` in the `<head>` of `App.razor`:

<!-- snippet: Guides.RenderModes.Preload -->
```razor
<link rel="modulepreload" href="@Assets["_content/BlazorECharts/js/runtime-loader.js"]" />
<link rel="modulepreload" href="@Assets["_content/BlazorECharts/js/echarts-6.1.0.js"]" />
```

- A preload helps only when its URL is the one the page imports; otherwise the browser downloads
  the file twice. With `MapStaticAssets`, the component imports the fingerprinted URL of the
  interop module, and the import map of `<ImportMap />` maps ECharts to its fingerprinted URL;
  `@Assets[...]` writes the same URLs. A page without `<ImportMap />` imports ECharts by its plain
  URL, `_content/BlazorECharts/js/echarts-6.1.0.js`.
- A standalone WebAssembly app has no `@Assets`: preload the URLs that the network log of the
  browser shows for these two imports.
- Every page with these links downloads the files, also a page without charts.
- With WebAssembly the first chart imports the modules only after the .NET runtime has started.
  When that takes more than a few seconds after the page load, Safari logs that a preloaded
  resource was not used in time; the preload still saved the download.

## Updating the application

The .NET interop module `_content/BlazorECharts/js/runtime-loader.js` changes with the package.
With `MapStaticAssets` the component imports it by its fingerprinted URL, so after an update a page
that is still open loads the new module on its next circuit, for example after enhanced
navigation. Other hosts import the stable URL; a page that kept the module of another package
version then fails to initialize charts with `RuntimeVersionMismatch`, and reloading the page
loads the current scripts. `_content/BlazorECharts/js/blazor-echarts.js`, the browser API for
function modules and extensions, keeps its URL and reads the page runtime that .NET initialized.
