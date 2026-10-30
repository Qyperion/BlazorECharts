using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.Services.AddECharts();
await builder.Build().RunAsync();
