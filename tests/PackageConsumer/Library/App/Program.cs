using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using PackageConsumer.Library.Components;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddECharts(options => options.MaximumServerResultSize = 4 * 1024 * 1024).AddWordCloud();
builder.Services.AddRazorComponents()
    // PNG exports travel back through SignalR and exceed the 32 KiB default.
    .AddInteractiveServerComponents().AddHubOptions(options => options.MaximumReceiveMessageSize = 4 * 1024 * 1024);

var app = builder.Build();
app.UseAntiforgery();
app.MapStaticAssets();
app.MapGet("/health", () => Results.Ok("PackageConsumer.Library"));
app.MapRazorComponents<App>().AddInteractiveServerRenderMode();
app.Run();
