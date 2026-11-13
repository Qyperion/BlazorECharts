# Changelog

Changes of the `Qyperion.BlazorECharts` and `Qyperion.BlazorECharts.WordCloud` packages. Both
are released together with the same version; the release notes of each package link to this
file at the release tag.

## Unreleased

- The implicit conversions of union values, of `OneOrMany<T>` and of component variants accept
  `null` for a reference type, so a conditional expression with a null branch, such as
  `Legend = show ? new ScrollableLegendOption() : null` or `BorderColor = dense ? null : "#fff"`,
  compiles without a nullable warning. The null is written as a JSON `null`, like an assigned
  `null`.
- `BarDataItemOption`, `HeatmapDataItemOption`, `GaugeDataItemOption`, `ParallelSeriesDataItemOption`
  and `ChordEdgeItemOption` have a `Tooltip`: the tooltip of one data item or one chord edge, which
  replaces the tooltip of the series for it. ECharts reads it for every series, although its
  documentation lists it only for some.

## 2.0.0

- Breaking change: `ChartBrushCursorOption.BrushType` and `BrushMode`, the brush option of
  `TakeGlobalCursorAction` and `GlobalCursorTakenEvent`, have the types of `BrushOption.BrushType`
  and `BrushOption.BrushMode`: `BrushTypeUncertain?` and `BrushMode?` instead of
  `EventActionValue?` and `string?`. The values of a `BrushOption` pass to the cursor as they are,
  and a misspelled mode, such as `"singel"`, throws `ArgumentException` at the assignment.
  Assigning a string or `false` compiles as before; code that read the value with
  `TryGetString` uses `TryGet`.
- `EChart.Height` and `EChart.Width` size the chart container with a CSS length, such as `360px`,
  `50vh` or `100%`; a number without a unit is pixels. They follow `Style` in the `style`
  attribute and win over a height or width there. A value with `;` throws
  `InvalidOperationException`.
- The `ArgumentException` of an event or action payload field names the model and property, such
  as `ChartBrushSelectArea.BrushMode: expected single|multiple; received "singel".`
  `ChartFinder.Select`, `ChartFinder.And`, `ChartResizeOptions` and `ChartLoadingOptions` name their
  parameter or property the same way.
- `GraphEdgeLineStyleOption.Color` explains that `"source"` and `"target"` take the node color from
  the series or the node's category, not from the node's own `itemStyle.color`, and that a
  category per node colors the edges per node.

## 1.2.0

- The `ArgumentException` of a literal union names the union, the rejected value, the accepted
  literals and the other alternatives, such as `ZRFontWeight: "600" is not one of "lighter",
  "bolder", "normal" or "bold". The union also accepts a number. Pass 600 as a number, not a
  string.` The literal properties of `Qyperion.BlazorECharts.WordCloud` name their model and
  member the same way.
- Serializing a built-in model with a context that has none, such as
  `new EChartsSerializationContext()`, names `OptionMetadata.CreateContext()` in the error; a
  model of another assembly names the registration of its extension. The new
  [Test options without a browser](docs/options.md#test-options-without-a-browser) section shows
  how a unit test serializes options with the built-in, WordCloud and custom data metadata.
- `ChartBrushCursorOption.BrushType`, the brush option of `TakeGlobalCursorAction`, accepts only
  the brush types of ECharts: `"rect"`, `"polygon"`, `"lineX"`, `"lineY"`, `"auto"` and `false`.
  A misspelled type used to pass and failed in the browser when the user started a brush; it now
  throws `ArgumentException` at the assignment. The error of an event or action payload field
  shows the rejected value, such as `received "linex"`, instead of its JSON kind.
- `ZrEvents` subscribes to the pointer events of the chart's ZRender surface: `Click`,
  `DoubleClick`, `MouseDown`, `MouseUp`, `MouseMove`, `MouseWheel` and `ContextMenu`, with the
  `ZrEvent` payload (position, button, modifier keys, wheel delta). They arrive also where ECharts
  raises no component event, such as on a brush selection, and move to the new chart when
  `InitOptions` recreate it, like other subscriptions. See
  [ZRender events](docs/events.md#zrender-events). The brush period picker example selects a month
  with a click.
- The interop protocol of `runtime-loader.js` is 4: a page that kept the scripts of an earlier
  version reports `RuntimeVersionMismatch` and asks for a reload.

## 1.1.0

- `Qyperion.BlazorECharts.WordCloud` uses [`@qyperion/echarts-wordcloud`](https://github.com/Qyperion/echarts-wordcloud)
  3.0.0, a fork of echarts-wordcloud for ECharts 6 that carries the lifecycle fixes of the 1.0.0
  build. The package no longer ships a locally patched echarts-wordcloud 2.1.0, and
  `WordCloudExtension.Version` is `3.0.0`.
- `WordCloudSeriesOption.RandomSeed` repeats the layout for the same seed and container size.
- `WordCloudSeriesOption.Z` and `Zlevel` apply to the words; 1.0.0 left them out because
  echarts-wordcloud 2.1.0 ignored them. A `visualMap` with an `opacity` channel sets the opacity
  of the words.

## 1.0.0

First release.

- Typed C# models for the documented Apache ECharts 6.1.0 options, events, actions and chart
  methods, with unions and arrays that keep the JSON shape ECharts expects.
- The `EChart` component for Interactive Server, Interactive WebAssembly, Interactive Auto and
  standalone WebAssembly, including trimmed and AOT-compiled WebAssembly.
- The pinned ECharts 6.1.0 module as a static web asset: no npm, CDN or `<script>` tag.
- JavaScript callbacks from your own ES modules or, as an opt-in, inline functions.
- PNG, JPEG and SVG exports that wait until the chart is stable.
- `Qyperion.BlazorECharts.WordCloud`: the echarts-wordcloud 2.1.0 series adapted to ECharts 6.1.0
  with a local lifecycle patch.
