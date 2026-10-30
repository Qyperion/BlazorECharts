using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using PackageConsumer.Standalone;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.Services.AddECharts().AddWordCloud();
await builder.Build().RunAsync();
