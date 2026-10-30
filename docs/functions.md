# JavaScript functions

Formatters, color callbacks, `renderItem` and other ECharts callbacks run synchronously in the
browser, so they are JavaScript functions, not .NET delegates. An option property that accepts a
callback accepts a `JsFunction<TSignature>`: a reference to a function in an ES module, or
explicitly allowed inline source.

## Module functions

Export the functions from an ES module of your app:

```javascript
// wwwroot/js/chart-callbacks.js
export function messages(value) {
  return `${Number(value).toLocaleString('en-US')} messages`;
}

export function weekendColor(params) {
  return params.dataIndex >= 5 ? '#e8590c' : '#2f5fd0';
}
```

Reference them with `JsFunction.Module<TSignature>(moduleUrl, exportName)`:

<!-- snippet: Guides.Functions.Module -->
```csharp
using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

const string callbacks = "js/chart-callbacks.js";

var options = new ChartOptions
{
    Tooltip = new TooltipOption
    {
        Trigger = "axis",
        ValueFormatter = JsFunction.Module<TooltipValueFormatterSignature>(callbacks, "messages"),
    },
    Series = new BarSeriesOption
    {
        Data = [820, 932, 901, 934, 1290, 1630, 1520],
        ItemStyle = new() { Color = JsFunction.Module<ItemColorCallbackSignature>(callbacks, "weekendColor") },
    },
};
```

- The module URL is resolved against the application base URI. Modules load once per page and
  are shared by all charts.
- The signature type names the ECharts callback contract. IntelliSense on the property's union
  type lists the accepted signatures. A signature is a marker for the browser contract; the
  library does not check the function body.
- The function receives the native ECharts arguments and its return value goes straight to
  ECharts, including HTML elements for tooltips and graphic elements for `renderItem`. ECharts
  inserts a string returned by a tooltip formatter as HTML: encode the data in it with
  `getECharts().format.encodeHTML` (see [security](security.md#html-in-tooltips-and-data-views)).
- Module functions need no `unsafe-eval` or `unsafe-inline` in the Content Security Policy;
  `script-src 'self'` is enough (see [Content Security Policy](security.md#content-security-policy)).
- An import that fails, or a missing export, rejects the update with the module URL and export
  name. A later update imports the module again.

A module can use the same ECharts instance as the charts, for example for `echarts.graphic`:

```javascript
import { getECharts } from '../_content/BlazorECharts/js/blazor-echarts.js';

export function gradientColor() {
  const echarts = getECharts();
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: '#83bff6' },
    { offset: 1, color: '#188df0' },
  ]);
}
```

## Inline functions

Inline source is compiled in the browser with `Function`, which needs a Content Security
Policy with `unsafe-eval`. It is off by default; enable it in the host:

<!-- snippet: Guides.Functions.InlineOptIn -->
```csharp
builder.Services.AddECharts(options => options.AllowInlineJavaScript = true);
```

<!-- snippet: Guides.Functions.Inline -->
```csharp
var tooltip = new TooltipOption
{
    Trigger = "axis",
    ValueFormatter = JsFunction.Inline<TooltipValueFormatterSignature>("value => `${value} messages`"),
};
```

Without the opt-in, an inline function fails before anything is sent, with the option path in
the error. Ordinary strings are never executed in either mode: only `JsFunction` values become
functions. An inline source is code: write it yourself and never build it from data or user input.

## Custom series

A custom series draws each data item with `renderItem`:

<!-- snippet: Guides.Functions.RenderItem -->
```csharp
var series = new CustomSeriesOption
{
    RenderItem = JsFunction.Module<CustomRenderItemSignature>("js/chart-callbacks.js", "rangeBar"),
    Encode = new OptionEncode
    {
        Entries =
        {
            ["x"] = [1, 2],
            ["y"] = 0,
        },
    },
    // Category index, start and end of each range.
    Data = [new OptionDataValue?[] { 0, 8, 17 }, new OptionDataValue?[] { 1, 10, 22 }],
};
```

```javascript
export function rangeBar(params, api) {
  const category = api.value(0);
  const start = api.coord([api.value(1), category]);
  const end = api.coord([api.value(2), category]);
  const height = api.size([0, 1])[1] * 0.5;
  return {
    type: 'rect',
    shape: { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height },
    style: { fill: api.visual('color') },
  };
}
```

The `api` object follows the coordinate system: `coord` and `size` are available on a cartesian
grid, while other coordinate systems provide their own helpers. To reuse a renderer under a name,
register it once per page and set `RenderItem` to that name:

<!-- snippet: Guides.Functions.RegisterCustomSeries -->
```csharp
await runtime.RegisterCustomSeriesAsync("progressRing",
    JsFunction.Module<CustomRenderItemSignature>("js/chart-callbacks.js", "progressRing"));

var series = new CustomSeriesOption { RenderItem = "progressRing", Data = [new OptionDataValue?[] { 1, 1, 0.82 }] };
```

## Functions in snapshots

`GetOptionAsync` returns callbacks as browser references, not as `JsFunction` values; reapply a
snapshot with `SetOptionAsync(snapshot)` to keep them (see [updates](updates.md#read-the-current-options)).
`JsFunction.FromBinding<TSignature>` rebuilds a module or inline descriptor from a binding
produced by `OptionSerializer.Serialize`.
