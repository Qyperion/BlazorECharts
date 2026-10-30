using BlazorECharts.Demo.Components;
using BlazorECharts.Examples;
using BlazorECharts.Examples.Catalog;
using BlazorECharts.Runtime;

var builder = WebApplication.CreateBuilder(args);

// The inline-function example needs the explicit opt-in; module functions work without it.
builder.Services.AddECharts(options =>
{
    options.AllowInlineJavaScript = true;
    options.MaximumServerResultSize = 4 * 1024 * 1024;
}).AddExampleCatalog();
builder.Services.AddSingleton(DemoHostInfo.WebApp);
builder.Services.AddRazorComponents()
    // PNG/SVG exports return to .NET through JS interop and exceed the 32 KiB SignalR default.
    .AddInteractiveServerComponents().AddHubOptions(options => options.MaximumReceiveMessageSize = 4 * 1024 * 1024)
    .AddInteractiveWebAssemblyComponents();

var app = builder.Build();
app.UseAntiforgery();
app.MapStaticAssets();
app.MapGet("/health", () => Results.Ok("BlazorECharts.Demo"));
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(BlazorECharts.Demo.Client.Routes).Assembly, typeof(ExampleRegistry).Assembly);
app.Run();
