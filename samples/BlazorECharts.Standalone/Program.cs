using BlazorECharts.Examples;
using BlazorECharts.Examples.Catalog;
using BlazorECharts.Runtime;
using BlazorECharts.Standalone;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

// The inline-function example needs the explicit opt-in; module functions work without it.
builder.Services.AddECharts(options => options.AllowInlineJavaScript = true).AddExampleCatalog();
builder.Services.AddSingleton(DemoHostInfo.Standalone);
await builder.Build().RunAsync();
