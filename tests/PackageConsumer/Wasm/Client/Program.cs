using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.Services.AddECharts().AddWordCloud();
await builder.Build().RunAsync();
