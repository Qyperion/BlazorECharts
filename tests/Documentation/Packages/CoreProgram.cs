// snippet: Package.Core.Program
// Program.cs
using BlazorECharts.Runtime;
// endsnippet

namespace DocumentationExamples.Packages;

internal static class CoreProgram
{
    internal static void Configure(WebApplicationBuilder builder)
    {
        // snippet: Package.Core.Program
        builder.Services.AddECharts();
        // endsnippet
    }
}
