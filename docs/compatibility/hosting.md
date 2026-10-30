# Hosting and browser compatibility

BlazorECharts targets net10.0, Apache ECharts 6.1.0 and @qyperion/echarts-wordcloud 3.0.0.
The `EChart` component does not choose a render mode; the host does. This page
records what is verified for each host and browser, and how to repeat it.

## Hosts

All hosts render the same catalog: `samples/BlazorECharts.Examples` provides the
`ExampleRegistry`, the example components and the catalog pages.

| Host | Project | Render mode | How it is selected |
|---|---|---|---|
| Interactive Server | `samples/BlazorECharts.Demo` | Server | default |
| Interactive WebAssembly | `samples/BlazorECharts.Demo` + `.Demo.Client` | WebAssembly | `?hosting=wasm` |
| Interactive Auto | `samples/BlazorECharts.Demo` + `.Demo.Client` | Server, then WebAssembly | `?hosting=auto` |
| Standalone WebAssembly | `samples/BlazorECharts.Standalone` | WebAssembly | always |

The query string selects the render mode of the whole page in `App.razor`. Tests do
not trust the URL: every example renders `data-render-mode` from
`ComponentBase.RendererInfo.Name`, and `data-interactive` from `RendererInfo.IsInteractive`.

Every interactive host registers the runtime and the extensions it needs, including
the WebAssembly client:

<!-- snippet: Compatibility.Hosting.Registration -->
```csharp
builder.Services.AddECharts().AddWordCloud();
```

Interactive Server returns results, such as exported images, and events through SignalR. The
demo and the test hosts export images and raise the hub receive limit and
`EChartsRuntimeOptions.MaximumServerResultSize` to 4 MiB for that; applications should raise them
only as far as they need (see [message size](../render-modes.md#message-size-on-interactive-server)).

## Prerendering

Prerendered markup contains the chart container and no chart. `EChart` performs no
JavaScript interop until the page is interactive; the container reports
`data-chart-state="NotInitialized"`. Tests hold `blazor.web.js` back and check the
placeholder in Server, WebAssembly and Auto modes: no canvas, no native instance and
no console errors, then the same page becomes interactive and draws the chart.

## Interactive Auto

In a browser context with an empty cache, Auto starts the page on a Server circuit and
downloads the WebAssembly runtime in the background. The next page load in the same
context runs on WebAssembly. A new context starts on Server again. The test creates
explicit browser contexts with service workers blocked, so this behavior depends only
on the browser cache and storage of that context.

## Lifecycle guarantees verified in browsers

The `lifecycle-lab` example and the hosting tests cover, in all four hosts:

- A chart in a hidden tab waits for a usable size, then initializes once.
- A container resized by a collapsing side panel resizes the chart (`ResizeObserver`).
- Removing a chart from the DOM releases its native instance; restoring it creates
  exactly one new instance.
- Click subscriptions can be added and disposed at runtime; a recreated chart rebinds
  live subscriptions.
- Changing `InitOptions` (Canvas to SVG) recreates the native chart inside the same
  component. A hidden container cannot host a new chart: the current chart stays, keeps
  receiving updates, and is recreated once the container has a size again, also when
  `AutoResize` is turned off while it waits.
- Disposing a second `EChartsRuntime` facade releases only its own charts.
- Back and forward navigation keeps exactly one native instance per chart container.
- Leaving a page while the ECharts module is still importing, or while a WordCloud
  layout runs, leaves no instance, late callback or unhandled rejection.
- Interactive Server reconnects to the retained circuit after the WebSocket is closed;
  the existing charts keep working and are not duplicated.

ECharts marks a disposed container with an empty `_echarts_instance_` attribute.
Count live charts with `[_echarts_instance_]:not([_echarts_instance_=""])`.

## Browser matrix

`docs/compatibility/browser-matrix.json` is written by the Playwright run of
`tests/browser/matrix/browser-matrix.spec.ts`. Each installed browser runs the same
scenarios against the Interactive Server demo; the `Wasm` scenarios repeat rendering and
export on the WebAssembly demo:

| Scenario | Checks |
|---|---|
| `CanvasAndSvgRender` | Canvas and SVG renderers draw the real series model. |
| `WordCloudCallbacks` | WordCloud text colors come from the module callback. |
| `BrushSelectsRange` | A pointer-drawn brush selects the category range through the typed event. |
| `PngAndSvgExport` | PNG and SVG exports after a stable layout; the PNG holds pixels of the series color. |
| `ViewportAndDevicePixelRatio` | A 390 px viewport at device pixel ratio 2 sizes the canvas backing store. |
| `CanvasAndSvgRenderWasm` | `CanvasAndSvgRender` on WebAssembly. |
| `PngAndSvgExportWasm` | `PngAndSvgExport` on WebAssembly. |

Statuses are `PASS`, `FAIL`, `BLOCKED` (the browser is installed but could not run) and
`NOT_VERIFIED` (not run). A browser that is not installed is `NOT_VERIFIED`, never
`PASS`. The tests never install browsers. To add the Playwright builds of Chromium,
Firefox and WebKit to a machine:

```powershell
npx playwright install chromium firefox webkit
npm run test:browser -- browser-matrix.spec.ts
```

Installed Google Chrome and Microsoft Edge run as Playwright channels. An installed
browser that cannot start is `BLOCKED`: its scenarios are skipped with the launch error
as the reason, so the run itself still succeeds.

A release needs `PASS` for Chrome, Edge and Firefox; the Playwright Chromium and WebKit
builds are engine checks, so only their failure fails the
[release gate](release-checklist.md). `BLAZOR_ECHARTS_MATRIX_REPORT` writes the report to
another path; the gate uses it to keep its run out of the tracked file.

Verified on Windows 11 Enterprise LTSC 2024 (x64), 2026-10-26: Chrome 155, Edge 156,
Playwright Chromium 156, Playwright Firefox 157 and Playwright WebKit 27.2 pass every
scenario.

On Windows, the Playwright browsers must not live in a virtualized `%LOCALAPPDATA%`. A
terminal started by a packaged (MSIX) desktop app writes new files under `%LOCALAPPDATA%`
to the package's private copy (`%LOCALAPPDATA%\Packages\<package>\LocalCache\Local`).
Processes of that app still see `%LOCALAPPDATA%\ms-playwright`, but Windows side-by-side
activation does not. `firefox.exe` declares the private assembly `mozglue`, so Firefox
fails with Win32 error 14001: Playwright reports `browserType.launch: spawn UNKNOWN`,
Windows logs SideBySide event 33 "dependent assembly mozglue 1.0.0.0 could not be found",
and the matrix marks Firefox `BLOCKED`. Chromium and WebKit start from either location.
Install the browsers from an ordinary terminal, or set `PLAYWRIGHT_BROWSERS_PATH` to a
folder outside `%LOCALAPPDATA%` for both the install and the test run:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'artifacts/ms-playwright'
npx playwright install chromium firefox webkit
npm run test:browser -- browser-matrix.spec.ts
```

## Minimum browser versions

The browser runtime of the library is ES2022 and uses `structuredClone`,
`AbortSignal.throwIfAborted` and `Object.hasOwn`. That needs Chrome or Edge 100, Firefox 97 or
Safari 15.4, or later. Only the versions in the matrix above are tested, and Blazor itself
supports only current browser versions; see
[ASP.NET Core Blazor supported platforms](https://learn.microsoft.com/aspnet/core/blazor/supported-platforms).

## Safari

Real Safari is not tested. Playwright WebKit in the browser matrix checks the engine that Safari
uses.

## Reproduce

```powershell
dotnet build BlazorECharts.slnx -c Release
npm run test:browser -- hosting.spec.ts browser-matrix.spec.ts
```

Playwright starts the test host (5187), the demo (5189, `BLAZOR_ECHARTS_DEMO_PORT`) and
the standalone demo (5186, `BLAZOR_ECHARTS_STANDALONE_PORT`) from the Release build.
