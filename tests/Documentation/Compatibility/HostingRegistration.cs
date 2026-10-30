using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;

namespace DocumentationExamples.Compatibility;

internal static class HostingRegistration
{
    internal static void Configure(WebApplicationBuilder builder)
    {
        // snippet: Compatibility.Hosting.Registration
        builder.Services.AddECharts().AddWordCloud();
        // endsnippet
    }
}
