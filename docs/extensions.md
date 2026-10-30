# Extensions

The page runtime holds everything that ECharts registers globally: themes, locales, maps, custom
series renderers and extension modules. Registrations belong to the page and survive the
disposal of the component or service scope that made them.

## WordCloud

The `Qyperion.BlazorECharts.WordCloud` package adds the `wordCloud` series of
[`@qyperion/echarts-wordcloud`](https://github.com/Qyperion/echarts-wordcloud) 3.0.0, a fork of
echarts-wordcloud for ECharts 6, tested with ECharts 6.1.0. It uses the core package's ECharts
and does not ship another copy. Register it next to `AddECharts`, in every interactive host:

<!-- snippet: Package.WordCloud.Program -->
```csharp
// Program.cs
using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;

builder.Services.AddECharts().AddWordCloud();
```

<!-- snippet: Guides.Extensions.WordCloud -->
```csharp
var options = new ChartOptions
{
    Tooltip = new TooltipOption { Show = true },
    Series = new WordCloudSeriesOption
    {
        Shape = "circle",
        SizeRange = [12, 48],
        RotationRange = [-90, 90],
        RotationStep = 45,
        GridSize = 6,
        TextStyle = new WordCloudTextStyle { FontFamily = "sans-serif", Color = "#2f5fd0" },
        Data =
        [
            new WordCloudDataItem { Name = "Blazor", Value = 40 },
            new WordCloudDataItem { Name = "ECharts", Value = 32 },
            new WordCloudDataItem { Name = "WebAssembly", Value = 18 },
        ],
    },
};
```

- `Shape` is a keyword (`circle`, `cardioid`, `diamond`, `square`, `triangle-forward`, `triangle`,
  `triangle-upright`, `pentagon`, `star`) or a `JsFunction<WordCloudShapeSignature>`. Unknown
  keywords fall back to `circle`, as in echarts-wordcloud.
- The series `TextStyle.Color` is a color or a `JsFunction<WordCloudColorSignature>` callback.
  echarts-wordcloud evaluates the callback only there: data items, `Emphasis`, `Blur` and rich
  tokens take `WordCloudItemTextStyle`, whose `Color` is a string.
- Fields that every series has use the core types: `Id`, `Name`, the box `Left`, `Top`, `Right`,
  `Bottom`, `Width`, `Height` and the text `FontSize`, `FontWeight` and `Width` are
  `NumberOrString`; the palette `Color` is `ZRColorOneOrMany` and `ColorLayer` is `ZRColor?[]?[]`
  (both with gradients and patterns); `StateAnimation`, `SelectedMode` and `SelectedMap` are the
  core `AnimationOption`, `SeriesSelectedMode` and `SelectedMap`.
- `RandomSeed`, a number or a string, repeats the layout for the same seed and container size;
  without it every layout differs. The words take the series `Z` and `Zlevel`, and the opacity of
  a `visualMap` with an `opacity` channel.
- The models leave out the series fields that the package never applies to its words: the select
  state, entry and update animations (`AnimationDuration`, `AnimationEasing`, ... and
  `AnimationThreshold`), progressive rendering, `SeriesLayoutBy`, label lines
  and label layout, universal transition with `DataGroupId`, `GroupId` and `ChildGroupId`,
  coordinate systems and `Emphasis.Disabled`. Such fields in JSON, for example from `getOption`,
  are kept in `AdditionalProperties`. `Cursor` and `BlendMode` stay for parity with the plugin's
  declarations and have no effect either. Selection works: `SelectedMode` selects words and
  raises the selection events, without a select style.
- `Tooltip` on the series or an item needs a global `Tooltip` component.
- A mask image comes from the browser:

<!-- snippet: Guides.Extensions.WordCloudMask -->
```csharp
await using var mask = await runtime.CreateImageAsync("images/cloud-mask.png");
await chart.SetOptionAsync(new ChartOptions
{
    Series = new WordCloudSeriesOption
    {
        MaskImage = mask,
        KeepAspect = true,
        Data = [new WordCloudDataItem { Name = "Blazor", Value = 40 }],
    },
});
// The chart holds its own lease; disposing this handle afterwards is safe.
```

`AwaitStableAsync` and every [export](export.md) wait for the current layout, including font
loading and mask decoding. `OnReady`, `SetOptionAsync` and the ECharts `finished` event can happen
before the last word is drawn. A large word list can exceed the available space; the export
shows the words that the layout placed.

- Without `LayoutAnimation`, the layout places every word in one browser task, and the page does
  not respond until it ends; thousands of words can take seconds. For large lists set
  `LayoutAnimation = true`: the words appear one by one and the page stays responsive, but the
  layout takes longer in total, one browser task and one redraw per word. In the test host,
  10,000 words of which about 5,700 fit took 17–27 s without animation and 83–94 s with it, on
  Canvas and SVG. `AwaitStableAsync` and exports wait at most `ChartStabilityOptions.Timeout`,
  30 s by default: raise it for such lists.
- A web font that fails to load or does not load within 3 seconds (network, CSP, a blocked or slow
  CDN) does not leave the chart empty: the layout draws with the browser's fallback font,
  `AwaitStableAsync` and exports fail with `LayoutFailed`, and the container raises a
  [`blazorecharts:error`](errors.md#browser-error-event) event. A font family that is not a CSS
  identifier needs quotes, `FontFamily = "'M PLUS 1p'"`; without them the font is invalid and
  is reported the same way. A mask that cannot be decoded stops the layout with the same error.
- A chart created directly with `getECharts().init(...)`, outside the library, gets none of these
  waits. Its layout is the package's: without `LayoutAnimation` every word is placed in one task,
  and a mask that cannot be read throws from `setOption`, so the other series of that chart are
  not drawn either (the original echarts-wordcloud logged the error and placed no word).
- The first registration installs `window.setImmediate` and `window.clearImmediate`, which
  browsers do not have, from wordcloud2.js: each call posts a `zero-timeout-message` window
  message, one per word in the animated layout (see [security](security.md#wordcloud)).

Standalone serialization of WordCloud options, outside a registered runtime, needs
`WordCloudTypeRegistration.Register(context)` on the serialization context.

## Themes and locales

<!-- snippet: Guides.Extensions.Themes -->
```csharp
await runtime.RegisterThemeAsync("dusk", new ChartOptions
{
    BackgroundColor = "#1f2433",
    Color = ["#f59f00", "#4dabf7", "#da77f2"],
    TextStyle = new() { Color = "#e6edf7" },
});
await runtime.RegisterLocaleAsync("EN-SHORT", new ChartLocaleOption
{
    Legend = new() { Selector = new() { All = "All", Inverse = "Invert" } },
    Toolbox = new() { SaveAsImage = new() { Title = "Download" } },
});
```

Register a theme or locale before a chart uses it, then set the chart's `Theme` parameter or
`InitOptions.Locale`. A typed theme or locale writes only the assigned fields; ECharts supplies the
rest. Both registrations also accept JSON. A locale can also be passed directly as
`InitOptions.Locale = new ChartLocaleOption { ... }`.

### Locales

The ECharts module of the package contains only the `EN` and `ZH` locales. Any other name, such as
`InitOptions.Locale = "DE"`, falls back to English without an error until that locale is
registered. ECharts 6.1.0 ships the other translations as `i18n/lang<NAME>-obj.js` in its npm
package; save the object of that file as JSON and register it before the chart initializes:

<!-- snippet: Guides.Extensions.Locale -->
```csharp
// langDeJson: the object of echarts/i18n/langDE-obj.js (ECharts 6.1.0) saved as JSON.
using var locale = JsonDocument.Parse(langDeJson);
await runtime.RegisterLocaleAsync("DE", locale.RootElement);
// Then: InitOptions = new ChartInitOptions { Locale = "DE" }
```

## Maps

`series-map` and `geo` draw registered maps:

<!-- snippet: Guides.Extensions.Maps -->
```csharp
await runtime.RegisterMapAsync("office", officeGeoJson, new Dictionary<string, GeoSpecialArea>
{
    // Draw the large "Rooftop" region as a small inset at this map position.
    ["Rooftop"] = new(Left: 104, Top: 0, Width: 20, Height: null),
});
await runtime.RegisterSvgMapAsync("floor", floorSvg);

EChartsMapResult? office = await runtime.GetMapAsync("office");
var areas = office?.GetSpecialAreas();
```

`RegisterMapAsync` accepts GeoJSON text or JSON. Special areas move a region into the given
rectangle of map coordinates; when `Width` or `Height` is `null`, ECharts derives it from the
region's aspect ratio. `GetMapAsync` returns `null` for an unknown map and `IsGeoJson == false`
for an SVG map.

## Custom series types

A new series type needs three parts: a browser module that installs it with the ECharts
extension API, a typed model, and a serializer registration. The library and its generated
models need no changes.

<!-- snippet: Guides.Extensions.Consumer -->
```csharp
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;

public sealed class ProgressSeriesExtension : IChartExtension
{
    public string Id => "product-progress-series";
    public string Version => "1.0.0";
    public IReadOnlyList<string> Dependencies => [];
    public string ModuleUrl => "js/progress-series.js";

    public void ConfigureSerialization(EChartsSerializationContext context) =>
        context.RegisterSeries("progress", new OptionTypeRegistration<ProgressSeriesOption>(
            (writer, series, metadata, path) =>
            {
                writer.WriteString("type", series.Type);
                metadata.WriteProperty(writer, series, "trackColor", series.TrackColor, path);
                metadata.WriteProperty(writer, series, "data", series.Data, path);
            },
            (json, metadata) => new ProgressSeriesOption
            {
                TrackColor = json.TryGetProperty("trackColor", out var color) ? color.GetString() : null,
                Data = json.TryGetProperty("data", out var data) ? [.. data.EnumerateArray().Select(v => v.GetDouble())] : null,
            }));
}

public sealed class ProgressSeriesOption() : SeriesOption("progress")
{
    private string? _trackColor;
    private double[]? _data;

    public string? TrackColor { get => _trackColor; set => SetProperty(ref _trackColor, value, "trackColor"); }
    public double[]? Data { get => _data; set => SetProperty(ref _data, value, "data"); }
}
```

```javascript
// wwwroot/js/progress-series.js: use the runtime it receives; never import or bundle ECharts.
export function register(runtime) {
  runtime.extendSeriesModel({ type: 'series.progress', /* ... */ });
  runtime.extendChartView({ type: 'progress', render(seriesModel, ecModel, api) { /* ... */ } });
}
```

Register the extension once, next to `AddECharts`:

<!-- snippet: Guides.Extensions.Register -->
```csharp
builder.Services.AddECharts().AddExtension(new ProgressSeriesExtension());
```

- The model derives from `SeriesOption("progress")` and sets every property through
  `SetProperty`, so unset properties are omitted.
- The writer writes `type` and then each typed property once, in a fixed order and including
  inherited ones, with `WriteProperty`; it does not write the object braces or
  `AdditionalProperties`, which the serializer adds. The reader builds the model from JSON, for
  example for `GetOptionAsync`. Nested option objects need their own
  `context.Register(new OptionTypeRegistration<T>(...))`.
- An unregistered option type fails instead of losing fields; nothing is discovered by reflection.
  Actions of an extension work the same way with a `ChartAction` subclass.
- `Id`, `Version`, `Dependencies` and `ModuleUrl` identify the extension. It registers once per
  page, after its dependencies. Missing dependencies, cycles and conflicting descriptors with the
  same `Id` fail before anything is installed.
- A failed import or `register` stays failed until `EChartsRuntime.InitializeAsync()` retries it.
  Make `register` safe to repeat after a partial failure.

The `progress` series of the demo (`samples/BlazorECharts.Examples`) is a complete example.

### Reading nested core types

A reader receives the serialization context that reads the whole snapshot. `context.Read<T>(json)`
reads a nested core model, or a model of another extension, with the reader registered for exactly
that type. It keeps unknown fields in `AdditionalProperties`, and an unregistered type, or one
registered without a reader, throws `InvalidOperationException`. A series of any registered type is
read with `context.ReadSeries(json)`.

Generated unions and tuples, such as `NumberOrString` or `ZRColor`, implement
`IReadableOptionValue<T>`: `T.Matches(json)` tests the JSON shape and `T.Read(json)` reads it. The
members are explicit, so call them through a generic constraint:

<!-- snippet: Guides.Extensions.NestedRead -->
```csharp
public sealed class BadgeSeriesOption() : SeriesOption("badge")
{
    private SeriesTooltipOption? _tooltip;
    private NumberOrString? _group;

    public SeriesTooltipOption? Tooltip { get => _tooltip; set => SetProperty(ref _tooltip, value, "tooltip"); }
    public NumberOrString? Group { get => _group; set => SetProperty(ref _group, value, "group"); }

    public static OptionTypeRegistration<BadgeSeriesOption> Registration { get; } = new(
        (writer, series, metadata, path) =>
        {
            writer.WriteString("type", series.Type);
            metadata.WriteProperty(writer, series, "tooltip", series.Tooltip, path);
            metadata.WriteProperty(writer, series, "group", series.Group, path);
        },
        (json, metadata) => new BadgeSeriesOption
        {
            // A core model nested in the extension model, with its unknown fields.
            Tooltip = json.TryGetProperty("tooltip", out var tooltip) ? metadata.Read<SeriesTooltipOption>(tooltip) : null,
            Group = json.TryGetProperty("group", out var group) ? ReadValue<NumberOrString>(group) : (NumberOrString?)null,
        });

    // Generated unions and tuples implement IReadableOptionValue<T> explicitly.
    private static T ReadValue<T>(JsonElement json) where T : struct, IReadableOptionValue<T> => T.Read(json);
}
```

Register the model with `context.RegisterSeries("badge", BadgeSeriesOption.Registration)`. These
are the public contracts for reading: the generated readers of the core models are internal, and
`OptionMetadata.CreateContext()` creates a context with all of them registered.

## Runtime providers

By default (`EChartsRuntimeProvider.Local`) the runtime loads the ECharts module of the package. To
load ECharts from elsewhere, for example a CDN, select the `Module` provider:

<!-- snippet: Guides.Extensions.Provider -->
```csharp
builder.Services.AddECharts(options =>
{
    options.Provider = EChartsRuntimeProvider.Module;
    options.ModuleUrl = "https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.esm.min.mjs";
});
```

- `Module` imports `ModuleUrl` and uses its namespace, or the export `ExportName`, as ECharts.
- `Custom` imports `ModuleUrl` and calls its `load()` export (or `ExportName`), which returns
  ECharts asynchronously. It may return an instance your page already loaded.
- The module must provide exactly `Version` (6.1.0 by default) and the native API the library
  uses; a mismatch fails with `RuntimeVersionMismatch` or `RuntimeCapabilityMissing`. A custom
  build must include the renderers and series your charts use. `Version` is an escape hatch for
  another build: the typed API still describes ECharts 6.1.0.
- Invalid values fail when set: an unknown provider, or an empty `Version`, `ModuleUrl` or
  `ExportName`. Combinations (a `ModuleUrl` with `Local`, none with `Module`) fail at first use.

The configuration is fixed when the first chart initializes and must match across the page.
The package's own module is the tested configuration; availability of an external CDN is up to
that CDN. A module from another origin runs with the rights of your page and is imported without
an integrity check; see [modules from other origins](security.md#modules-from-other-origins) and
the [Content Security Policy](security.md#content-security-policy) it needs.

When the import of a provider module, an extension or a module function fails, the next attempt
(`EChartsRuntime.InitializeAsync()` or a later update) imports it again:

- A module from your own origin is imported with the query parameter `__blazorecharts_retry=<n>`,
  because browsers keep a failed module for its URL. A signed URL or a server that rejects
  unknown query parameters fails the retry; serve such modules from a URL that accepts the
  parameter.
- A module from another origin is imported from the same URL, so an `integrity` entry of an
  import map still applies to it. A browser that keeps the failed module fails the retry too
  until the page reloads.
