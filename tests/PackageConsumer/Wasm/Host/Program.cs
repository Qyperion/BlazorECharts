using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using PackageConsumer.Wasm.Components;

var builder = WebApplication.CreateBuilder(args);

// Prerendering runs the client components on the server, so the host registers the same services.
builder.Services.AddECharts().AddWordCloud();
builder.Services.AddRazorComponents().AddInteractiveWebAssemblyComponents();

var app = builder.Build();
var pathBase = builder.Configuration["PathBase"];
if (!string.IsNullOrEmpty(pathBase))
    app.UsePathBase(pathBase);

app.UseAntiforgery();
app.MapStaticAssets();
app.MapGet("/health", () => Results.Ok("PackageConsumer.Wasm"));
app.MapRazorComponents<App>()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(PackageConsumer.Wasm.Client._Imports).Assembly);
app.Run();
