// snippet: Guides.RenderModes.WebApp
// Program.cs of a Blazor Web App (server project)
using BlazorECharts.Runtime;
// endsnippet

namespace DocumentationExamples.Guides;

internal static class RenderModesProgram
{
    internal static void Configure(WebApplicationBuilder builder)
    {
        // snippet: Guides.RenderModes.WebApp
        builder.Services.AddECharts();
        builder.Services.AddRazorComponents()
            .AddInteractiveServerComponents()
            .AddInteractiveWebAssemblyComponents();
        // endsnippet
    }

    internal static void RaiseLimit(WebApplicationBuilder builder)
    {
        // snippet: Guides.RenderModes.ResultLimit
        // Only for results or events larger than 32 KiB: a larger limit costs server memory per message.
        const long limit = 512 * 1024;
        builder.Services.AddECharts(options => options.MaximumServerResultSize = limit);
        builder.Services.AddRazorComponents()
            .AddInteractiveServerComponents()
            .AddHubOptions(options => options.MaximumReceiveMessageSize = limit);
        // endsnippet
    }
}
