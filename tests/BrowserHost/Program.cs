using BlazorECharts.Runtime;
using BrowserHost.Client.Pages;
using BrowserHost.Client.Shared;
using BrowserHost.Components;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddECharts(options => options.MaximumServerResultSize = 4 * 1024 * 1024);
builder.Services.AddRazorComponents()
    // WordCloud PNG/SVG exports travel back through JS interop and exceed the 32 KiB default.
    .AddInteractiveServerComponents().AddHubOptions(options => options.MaximumReceiveMessageSize = 4 * 1024 * 1024)
    .AddInteractiveWebAssemblyComponents();

var app = builder.Build();

// Test-only, dynamically built compatibility fixture; never part of the RCL.
var compatibilityPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "../../artifacts/compatibility"));
if (Directory.Exists(compatibilityPath))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new PhysicalFileProvider(compatibilityPath),
        RequestPath = "/compatibility",
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(compatibilityPath),
        RequestPath = "/compatibility",
        OnPrepareResponse = context => context.Context.Response.Headers.ContentSecurityPolicy =
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'",
    });
}

// The package ships the minified ECharts build. The harness serves the development build of the same locked
// release at the same URL, so the specs that fail on console warnings also see the warnings of ECharts.
// Performance runs measure the shipped build: its development checks would add to both the wrapper and the baseline.
var developmentEngine = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "../../artifacts/upstream/echarts/dist/echarts.esm.mjs"));
var performance = Environment.GetEnvironmentVariable("BLAZOR_ECHARTS_PERFORMANCE") == "1";
if (File.Exists(developmentEngine) && !performance)
{
    app.Use(async (context, next) =>
    {
        if (context.Request.Path != "/_content/BlazorECharts/js/echarts-6.1.0.js")
        {
            await next(context);
            return;
        }

        context.Response.ContentType = "text/javascript";
        await context.Response.SendFileAsync(developmentEngine);
    });
}

// Blazor pages under a strict Content Security Policy; ?style=self also drops 'unsafe-inline' styles.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/harness/csp", out var mode))
    {
        var wasm = mode.StartsWithSegments("/wasm") ? " 'wasm-unsafe-eval'" : "";
        var styles = context.Request.Query["style"] == "self" ? "'self'" : "'self' 'unsafe-inline'";
        context.Response.Headers.ContentSecurityPolicy =
            $"default-src 'self'; script-src 'self'{wasm}; style-src {styles}; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; object-src 'none'";
    }

    await next(context);
});
app.UseAntiforgery();
app.MapStaticAssets();
app.MapGet("/health", () => Results.Ok("BrowserHost"));
app.MapGet("/harness/functions-csp", (HttpContext context) =>
{
    context.Response.Headers.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'";
    var prefix = context.Request.PathBase;
    return Results.Content(
        $"<!doctype html><html><head><base href='{prefix}/'></head><body><p data-testid='status'>waiting</p><div id='chart' style='width:640px;height:360px'></div><script type='module' src='harness/functions-csp.js'></script></body></html>",
        "text/html");
});

// The native ECharts baseline of the performance workloads: the same engine and the same prepared JSON, without Blazor.
app.MapGet("/harness/performance/workload", (string name) =>
{
    var workload = SyntheticWorkloads.Find(name);
    return Results.Json(new { workload.Name, workload.Kind, workload.Size, workload.Charts, SyntheticWorkloads.StreamUpdates });
});
app.MapGet("/harness/performance/payload", (string workload, int seed, int chart, string stage) =>
    Results.Bytes(SyntheticWorkloads.Payload(workload, seed, chart, stage), "application/json"));
app.MapGet("/harness/performance/native", (HttpContext context) => Results.Content(
    $$"""
    <!doctype html>
    <html lang="en">
    <head><meta charset="utf-8"><base href="{{context.Request.PathBase}}/"><title>Native chart performance</title></head>
    <body>
    <h1>Native ECharts performance workload</h1>
    <p data-testid="renderer-info">Native</p>
    <p data-testid="phase">loading</p>
    <pre data-testid="metrics">{}</pre>
    <div class="perf-buttons"></div>
    <div class="perf-grid"></div>
    <script type="module" src="harness/performance-native.js"></script>
    </body>
    </html>
    """,
    "text/html"));
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(WasmProbe).Assembly);
app.Run();
