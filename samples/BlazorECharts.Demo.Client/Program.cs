using BlazorECharts.Examples;
using BlazorECharts.Examples.Catalog;
using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);

// The inline-function example needs the explicit opt-in; module functions work without it.
builder.Services.AddECharts(options => options.AllowInlineJavaScript = true).AddExampleCatalog();
builder.Services.AddSingleton(DemoHostInfo.WebApp);
await builder.Build().RunAsync();
