# BlazorECharts.WordCloud

The word cloud series of [@qyperion/echarts-wordcloud](https://github.com/Qyperion/echarts-wordcloud)
3.0.0, a fork of echarts-wordcloud for ECharts 6, for BlazorECharts on Apache ECharts 6.1.0. The
module is included as a static web asset; ECharts itself comes from the `Qyperion.BlazorECharts`
package, which this package requires in exactly the same version.

<!-- snippet: Package.WordCloud.Program -->
```csharp
// Program.cs
using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;

builder.Services.AddECharts().AddWordCloud();
```

<!-- snippet: Package.WordCloud.Options -->
```csharp
using BlazorECharts.Options;
using BlazorECharts.WordCloud;

var options = new ChartOptions
{
    Series = new WordCloudSeriesOption
    {
        Data = [new WordCloudDataItem { Name = "Blazor", Value = 40 }, new WordCloudDataItem { Name = "ECharts", Value = 32 }],
    },
};
```

Render the chart in an interactive component, as in the BlazorECharts quick start.
`AwaitStableAsync` and exports wait until the word cloud layout has finished. The
[live demo](https://qyperion.github.io/BlazorECharts/examples/wordcloud) shows a word cloud with its
C# source.

The [documentation](https://github.com/Qyperion/BlazorECharts/tree/v1.1.0/docs) covers getting started, options, updates,
events, functions, exports, extensions, render modes and errors; the word cloud series is in
[extensions](https://github.com/Qyperion/BlazorECharts/blob/v1.1.0/docs/extensions.md). The
[security notes](https://github.com/Qyperion/BlazorECharts/blob/v1.1.0/docs/security.md#wordcloud) describe the global
`setImmediate` polyfill that the first registration installs.

Licensed under MIT. @qyperion/echarts-wordcloud (ISC) and the bundled wordcloud2.js layout (MIT)
keep their own licenses; see `THIRD-PARTY-NOTICES.md` in the package.
