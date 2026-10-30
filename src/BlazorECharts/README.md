# BlazorECharts

Typed Blazor components and C# API for [Apache ECharts](https://echarts.apache.org/) 6.1.0.
The package targets .NET 10 and works with Interactive Server, Interactive WebAssembly,
Interactive Auto and standalone WebAssembly hosts.

The pinned ECharts 6.1.0 ES module is included as a static web asset and loads from
`_content/BlazorECharts/` on first use. No npm, CDN or `<script>` tag is needed.

The [live demo](https://qyperion.github.io/BlazorECharts/) shows more than 45 examples with their C#
source.

## Get started

<!-- snippet: Package.Core.Program -->
```csharp
// Program.cs
using BlazorECharts.Runtime;

builder.Services.AddECharts();
```

<!-- snippet: Package.Core.Component -->
```razor
@page "/weekly-messages"
@rendermode InteractiveServer
@using BlazorECharts
@using BlazorECharts.Options
@using BlazorECharts.Values

<EChart Options="_options" Style="height:360px" />

@code {
    private readonly ChartOptions _options = new()
    {
        XAxis = new XAxisCategoryOption { Data = ["Mon", "Tue", "Wed"] },
        YAxis = new YAxisValueOption(),
        Series = new LineSeriesOption { Data = [12, 18, 9] },
    };
}
```

The chart draws only in an interactive render mode. `@rendermode InteractiveServer` suits an app
with per-page interactivity, such as the default `dotnet new blazor` template; leave it out when
the whole app is interactive. With static server rendering the page shows only the empty container.

A new `Options` reference is applied automatically and, as in ECharts, merged into the chart:
a series or component without a counterpart in the new options stays. Set
`UpdateOptions="new() { NotMerge = true }"` when each `Options` describes the whole chart. Call
`UpdateAsync` after mutating the same object, or `SetOptionAsync` on the chart instance for
partial updates.

## What is included

- Typed models for the documented ECharts 6.1.0 options, events, actions and methods.
- Module and opt-in inline JavaScript functions for formatters and callbacks.
- Stable PNG, JPEG and SVG exports and `AwaitStableAsync`.
- Opt-in `module` (for example a CDN) and `custom` runtime providers.

Tooltip formatter functions return HTML: encode data in them, and read the
[security notes](https://github.com/Qyperion/BlazorECharts/blob/v1.1.0/docs/security.md) for links,
colors from data, SVG export, inline functions and the Content Security Policy.

The [documentation](https://github.com/Qyperion/BlazorECharts/tree/v1.1.0/docs) covers getting started, options, updates,
events, functions, exports, extensions, render modes, errors and security.

Licensed under MIT. Apache ECharts, ZRender and tslib keep their own licenses; see
`THIRD-PARTY-NOTICES.md` in the package.
