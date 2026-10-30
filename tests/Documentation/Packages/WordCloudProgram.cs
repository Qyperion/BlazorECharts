// snippet: Package.WordCloud.Program
// Program.cs
using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
// endsnippet

namespace DocumentationExamples.Packages;

internal static class WordCloudProgram
{
    internal static void Configure(WebApplicationBuilder builder)
    {
        // snippet: Package.WordCloud.Program
        builder.Services.AddECharts().AddWordCloud();
        // endsnippet
    }
}
