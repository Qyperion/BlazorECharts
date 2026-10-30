// snippet: Package.WordCloud.Options
using BlazorECharts.Options;
using BlazorECharts.WordCloud;
// endsnippet

namespace DocumentationExamples.Packages;

internal static class WordCloudOptions
{
    internal static ChartOptions Create()
    {
        // snippet: Package.WordCloud.Options
        var options = new ChartOptions
        {
            Series = new WordCloudSeriesOption
            {
                Data = [new WordCloudDataItem { Name = "Blazor", Value = 40 }, new WordCloudDataItem { Name = "ECharts", Value = 32 }],
            },
        };
        // endsnippet
        return options;
    }
}
