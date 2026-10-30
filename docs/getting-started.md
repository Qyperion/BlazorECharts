# Getting started

BlazorECharts targets .NET 10 and Apache ECharts 6.1.0. The `EChart` component works in every
interactive render mode; the host chooses the mode (see [render modes](render-modes.md)).

## Register the services

Reference the `Qyperion.BlazorECharts` package and call `AddECharts` in every project that renders charts
interactively. In a Blazor Web App with WebAssembly or Auto components, that is both the server
project and the client project.

<!-- snippet: Package.Core.Program -->
```csharp
// Program.cs
using BlazorECharts.Runtime;

builder.Services.AddECharts();
```

Registration performs no JavaScript interop. The ECharts module loads from
`_content/BlazorECharts/` the first time a chart initializes; it is resolved against the
application base URI, so apps under a path base work without changes. `AddECharts` takes an
optional configuration callback for [inline functions](functions.md#inline-functions) and
[runtime providers](extensions.md#runtime-providers).

## Add the namespaces

Add the namespaces to `_Imports.razor`:

<!-- snippet: Guides.GettingStarted.Imports -->
```razor
@using BlazorECharts
@using BlazorECharts.Events
@using BlazorECharts.Options
@using BlazorECharts.Runtime
@using BlazorECharts.Values
@using BlazorECharts.Values.Signatures
```

| Namespace | Contents |
|---|---|
| `BlazorECharts` | The `EChart` component and `ChartState` |
| `BlazorECharts.Options` | `ChartOptions`, components, series, actions, `SetOptionOptions`, `ChartInitOptions` |
| `BlazorECharts.Values` | `OneOrMany<T>`, `EChartsValue`, `JsFunction`, `OptionDictionary<T>`, `OptionArrayLike<T>` and union value types such as `ZRColor`, `NumberOrString`, `XAxisOption` |
| `BlazorECharts.Values.Signatures` | Callback signatures for `JsFunction<TSignature>` |
| `BlazorECharts.Events` | `ChartEvents`, event payloads, `EventQuery`, `ChartSubscription` |
| `BlazorECharts.Runtime` | `EChartInstance`, `EChartsRuntime`, exports, errors, browser references |

## Render a chart

<!-- snippet: Guides.GettingStarted.FirstChart -->
```razor
@page "/weekly-sales"
@rendermode InteractiveServer

<EChart Options="_options" Style="height:400px" OnReady="OnReady" OnError="OnError" />
<p>@_status</p>

@code {
    private readonly ChartOptions _options = new()
    {
        Title = new TitleOption { Text = "Weekly sales" },
        Tooltip = new TooltipOption { Trigger = "axis" },
        XAxis = new XAxisCategoryOption
        {
            Data = ["Mon", "Tue", "Wed", "Thu", "Fri"],
        },
        YAxis = new YAxisValueOption(),
        Series = new BarSeriesOption { Name = "Sales", Data = [120, 200, 150, 80, 70] },
    };

    private string _status = "Loading…";

    private void OnReady(EChartInstance chart) => _status = "Ready";

    private void OnError(EChartsError error) => _status = $"{error.Code}: {error.Message}";
}
```

- The container needs a non-zero size. Set it with `Style` or `Class`; the chart waits until the
  container has a width and height, for example inside a hidden tab, and then initializes once.
- During prerendering and static rendering the component renders only the empty container.
  The chart initializes after the component becomes interactive.
- `OnReady` runs once per successful initialization, after the first `setOption`. It does not
  mean that animations or layout have finished; use
  [`AwaitStableAsync`](export.md#wait-for-a-stable-chart) for that.
- `OnError` receives initialization and update failures. See [errors](errors.md).
- `Instance` is the `EChartInstance` for [imperative calls](chart-api.md), `State` is the
  lifecycle state (`NotInitialized`, `Initializing`, `Ready`, `Failed`, `Disposing`, `Disposed`).
  After a failure, `InitializeAsync()` retries.
- The chart follows its container size through a `ResizeObserver`; set `AutoResize="false"` to
  resize only explicitly. Removing the component, or its element from the DOM, disposes the chart.

## Renderer, theme and locale

`InitOptions` holds the native `echarts.init` options: renderer (`canvas` or `svg`), size,
device pixel ratio, locale and others. `Theme` names a built-in (`dark`) or
[registered theme](extensions.md#themes-and-locales).

<!-- snippet: Guides.GettingStarted.InitOptions -->
```razor
<EChart Options="Options" Class="chart" InitOptions="_init" Theme="dark" />

@code {
    private readonly ChartInitOptions _init = new() { Renderer = "svg", Locale = "EN" };
}
```

The ECharts module of the package contains the `EN` and `ZH` locales; register any other locale
first (see [locales](extensions.md#locales)).

Changing `Theme` applies the theme to the existing chart. Changing `InitOptions` recreates the
native chart in the same component and keeps its current options and subscriptions; see
[updates](updates.md#themes-and-init-options).

## Next steps

- Build options: [chart options](options.md).
- Change a rendered chart: [updates](updates.md).
- React to clicks and legend changes: [events and actions](events.md).
- Format labels and tooltips in the browser: [JavaScript functions](functions.md).
- Browse the examples of the demo app in `samples/BlazorECharts.Examples`: the Series group has one for
  every series type, and the Components group one for every top-level component, such as polar
  coordinates, geo, dataset, timeline, media and matrix.
