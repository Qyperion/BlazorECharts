using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using PackageConsumer.Server.Components;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddECharts(options =>
{
    options.MaximumServerResultSize = 4 * 1024 * 1024;

    // Packaged local assets by default; the module (CDN) and custom providers are opt-in.
    var provider = builder.Configuration["ECharts:Provider"];
    if (string.IsNullOrEmpty(provider))
        return;

    options.Provider = Enum.Parse<EChartsRuntimeProvider>(provider, ignoreCase: true);
    options.ModuleUrl = builder.Configuration["ECharts:ModuleUrl"];
    options.ExportName = builder.Configuration["ECharts:ExportName"];
}).AddWordCloud();
builder.Services.AddRazorComponents()
    // PNG exports travel back through SignalR and exceed the 32 KiB default.
    .AddInteractiveServerComponents().AddHubOptions(options => options.MaximumReceiveMessageSize = 4 * 1024 * 1024);

var app = builder.Build();
var pathBase = builder.Configuration["PathBase"];
if (!string.IsNullOrEmpty(pathBase))
    app.UsePathBase(pathBase);

app.UseAntiforgery();
app.MapStaticAssets();
app.MapGet("/health", () => Results.Ok("PackageConsumer.Server"));
app.MapRazorComponents<App>().AddInteractiveServerRenderMode();
app.Run();
