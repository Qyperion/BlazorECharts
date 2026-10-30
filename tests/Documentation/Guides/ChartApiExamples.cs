using System.Text.Json;
using BlazorECharts.Runtime;
using BlazorECharts.Values;
using Microsoft.AspNetCore.Components;

namespace DocumentationExamples.Guides;

internal static class ChartApiExamples
{
    internal static async Task Methods(EChartInstance chart)
    {
        // snippet: Guides.ChartApi.Methods
        await chart.ResizeAsync(new ChartResizeOptions { Width = 640, Height = 360, Silent = true });
        double width = await chart.GetWidthAsync();

        await chart.ShowLoadingAsync(new ChartLoadingOptions { Text = "Loading…" });
        await chart.HideLoadingAsync();

        // Data coordinates of the first series to pixels and back.
        var series = ChartFinder.Select("series", index: 0);
        ChartPixelValue pixel = await chart.ConvertToPixelAsync(series, CoordinateValue.Array("Tue", 18));
        ChartPixelValue data = await chart.ConvertFromPixelAsync(series, pixel.Numbers!);
        bool inside = await chart.ContainPixelAsync(ChartFinder.Select("grid", index: 0), [120, 80]);
        // endsnippet
        _ = width;
        _ = data;
        _ = inside;
    }

    internal static async Task Append(EChartInstance chart)
    {
        // snippet: Guides.ChartApi.Append
        // Incremental rendering for scatter and lines series with explicit data.
        await chart.AppendDataAsync(0, EChartsValue.Array(
            EChartsValue.Array(EChartsValue.From(1.5), EChartsValue.From(3.2)),
            EChartsValue.Array(EChartsValue.From(2.1), EChartsValue.From(4.8))));
        // endsnippet
    }

    internal static async Task Runtime(EChartsRuntime runtime, ElementReference element, JsonElement theme)
    {
        // snippet: Guides.ChartApi.Runtime
        await runtime.InitializeAsync();   // loads ECharts; also retries a failed load
        await using var chart = await runtime.CreateInstanceAsync(element, new() { Renderer = "canvas" }, theme: "dark");
        await chart.SetOptionAsync(new BlazorECharts.Options.ChartOptions());
        // Disposing the handle disposes the native chart; the page runtime stays loaded.
        // endsnippet
        _ = theme;
    }
}
