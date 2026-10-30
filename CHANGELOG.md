# Changelog

Changes of the `Qyperion.BlazorECharts` and `Qyperion.BlazorECharts.WordCloud` packages. Both
are released together with the same version; the release notes of each package link to this
file at the release tag.

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
