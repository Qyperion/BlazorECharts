# Graphic and browser references

Some ECharts values live only in the browser: images, canvases, DOM elements, ZRender objects
and other native objects. .NET holds them as `EChartsObjectReference` handles. This page covers
those references and the graphic component, which uses them most.

## The graphic component

`ChartOptions.Graphic` draws shapes, images and text on top of the chart. The ten ECharts path
shapes (`arc`, `bezierCurve`, `circle`, `ellipse`, `line`, `polygon`, `polyline`, `rect`, `ring`,
`sector`) have typed `Graphic<Shape>Option` models with typed geometry; groups, images and text
use `GraphicGroupOption`, `GraphicImageOption` and `GraphicTextOption`.

<!-- snippet: Guides.Graphic.Shapes -->
```csharp
var options = new ChartOptions
{
    Graphic = new GraphicGroupOption
    {
        // Every graphic element writes its own type.
        Right = 30,
        Top = 12,
        Children =
        [
            new GraphicRectOption
            {
                Shape = new() { X = 0, Y = 0, Width = 210, Height = 48, R = 8 },
                Style = new() { Fill = "#e8eefc", Stroke = "#2f5fd0", LineWidth = 1 },
            },
            new GraphicImageOption { Style = new() { Image = badge, X = 8, Y = 8, Width = 32, Height = 32 } },
            new GraphicTextOption
            {
                X = 50, Y = 15,
                Style = new() { Text = "Best week: 61 replies", Fill = "#1d2330", FontSize = 13 },
            },
        ],
    },
};
```

- Every graphic element writes its own `type`; you do not set `Type`.
- `GraphicElementItem.From(element)` wraps an element where a nested element is
  expected.
- Event callbacks and geometry `During` callbacks are [module functions](functions.md); they run
  in the browser.
- `GraphicComponentZRPathOption` covers shapes that you register yourself with
  `graphic.registerShape`.
- ECharts 6.1.0 reserves the `path` and `compoundPath` element types without an implementation;
  they do not render.

## Images and canvases

`CreateImageAsync` loads and decodes an image in the browser and returns a reference to it.
HTTP, decode and CORS failures reject the call. `CreateCanvasAsync(width, height)` creates an
empty canvas. Properties that accept browser objects, such as `Image`, a WordCloud
`MaskImage` or `OptionArrayLike<T>`, take the reference directly.

<!-- snippet: Guides.Graphic.Image -->
```csharp
// Decoded in the browser first: HTTP, decode and CORS failures reject here.
EChartsObjectReference badge = await runtime.CreateImageAsync("images/badge.svg");
var options = Shapes(badge);   // Image accepts a URL string or a browser reference
```

## Native objects from modules

`ImportObjectAsync(moduleUrl, exportName, arguments)` calls a function exported by your module
(it may be `async`) and returns its result as a reference: a DOM element, a canvas, a pattern or
any other object.

<!-- snippet: Guides.Graphic.Factory -->
```csharp
// js/patterns.js exports stripes(size), which draws and returns an HTMLCanvasElement.
await using var stripes = await runtime.ImportObjectAsync("js/patterns.js", "stripes", [EChartsValue.From(8)]);
var image = new GraphicImageOption
{
    Style = new() { Image = stripes, X = 0, Y = 0, Width = 64, Height = 64 },
};
```

Pass a reference into open values with `EChartsValue.From(reference)`. A reference belongs to
the page that created it; another page or circuit rejects it.

## Lifetime

Every reference is a lease. Disposing your handle releases only your lease:

- A chart that uses a reference keeps its own lease until the option is replaced or the chart is
  disposed, so you may dispose your handle right after `SetOptionAsync`.
- [Snapshots](updates.md#read-the-current-options), connected exports and event deliveries hold
  their own leases.
- `AcquireLeaseAsync` on a reference and `RetainAsync` on a lease create further independent
  leases.
- Objects that you created (`CreateImageAsync`, `CreateCanvasAsync`) are released with their last
  lease. Objects that a module returned are borrowed: the library never calls their `dispose`.

## Native helpers and constructors

Documented global functions that need browser values have named methods on `EChartsRuntime`,
such as `GraphicExtendShapeNativeAsync`, `GraphicRegisterShapeNativeAsync` or
`SetPlatformAPINativeAsync`. Undocumented helpers of ECharts (`number.*`, `format.*`, `color.*`,
`time.*`, `util.*`, `zrUtil.*`, `vector.*`, `matrix.*`), undocumented registrations such as
`registerTransform` and the ZRender constructors under `graphic.*` have no typed member. Call them
by their public path with `InvokeNativeAsync`:

<!-- snippet: Guides.Graphic.Native -->
```csharp
// Undocumented helpers have no typed member; call them by their public path.
await using var rounded = await runtime.InvokeNativeAsync("number.round", [EChartsValue.From(1.2345), EChartsValue.From(2)]);
double value = rounded.Json.GetDouble();   // 1.23

// Constructors run with construct: true and return a browser object.
await using var gradient = await runtime.InvokeNativeAsync("graphic.LinearGradient",
    [EChartsValue.From(0), EChartsValue.From(0), EChartsValue.From(0), EChartsValue.From(1),
     EChartsValue.Array(
        EChartsValue.Object(
            new Dictionary<string, EChartsValue> { ["offset"] = EChartsValue.From(0), ["color"] = EChartsValue.From("#83bff6") }),
        EChartsValue.Object(
            new Dictionary<string, EChartsValue> { ["offset"] = EChartsValue.From(1), ["color"] = EChartsValue.From("#188df0") }))],
    construct: true);
EChartsObjectReference native = gradient.Reference;
```

Arguments follow the ECharts order and accept references and registered custom data. The result
has `Json` for serializable values and `Reference`/`References` for browser objects; dispose it to
release them. Only public ECharts paths are accepted.

## The chart's own browser objects

<!-- snippet: Guides.Graphic.Zr -->
```csharp
await using var zr = await chart.GetZrAsync();     // the chart's ZRender instance
await using var dom = await chart.GetDomAsync();   // the container element
// Pass them to a browser module with ImportObjectAsync or EChartsValue.From(reference).
```

`GetVisualAsync(finder, visualType)` reads a visual, such as `color`, as text, numbers, JSON or
references.
