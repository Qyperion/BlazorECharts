using BlazorECharts.Runtime;
using PackageConsumer.CoreOnly.Components;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddECharts(options => options.MaximumServerResultSize = 4 * 1024 * 1024);
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents().AddHubOptions(options => options.MaximumReceiveMessageSize = 4 * 1024 * 1024);

var app = builder.Build();
app.UseAntiforgery();
app.MapStaticAssets();
app.MapGet("/health", () => Results.Ok("PackageConsumer.CoreOnly"));
app.MapRazorComponents<App>().AddInteractiveServerRenderMode();
app.Run();
