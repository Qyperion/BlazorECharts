using BlazorECharts.Runtime;

namespace DocumentationExamples.Guides;

internal static class ExportExamples
{
    internal static async Task<string> Png(EChartInstance chart, CancellationToken cancellationToken)
    {
        // snippet: Guides.Export.Png
        string png = await chart.GetDataUrlAsync(
            new ChartDataUrlOptions { Type = ChartImageFormat.Png, PixelRatio = 2, BackgroundColor = "#ffffff" },
            new ChartStabilityOptions { Timeout = TimeSpan.FromSeconds(10) },
            cancellationToken);
        // png is "data:image/png;base64,..."
        // endsnippet
        return png;
    }

    internal static async Task<string> Svg(EChartInstance svgChart)
    {
        // snippet: Guides.Export.Svg
        // Requires InitOptions.Renderer = "svg".
        string markup = await svgChart.RenderToSvgStringAsync(new ChartSvgExportOptions { UseViewBox = true });
        string dataUrl = await svgChart.GetSvgDataUrlAsync();
        // endsnippet
        return markup + dataUrl;
    }

    internal static async Task<string> Connected(EChartsRuntime runtime, EChartInstance first, EChartInstance second)
    {
        // snippet: Guides.Export.Connected
        await runtime.ConnectAsync([first, second]);
        string both = await first.GetConnectedDataUrlAsync(
            new ChartConnectedDataUrlOptions { Type = ChartImageFormat.Png, ConnectedBackgroundColor = "#ffffff" });
        // endsnippet
        return both;
    }

    internal static async Task Stable(EChartInstance chart)
    {
        // snippet: Guides.Export.Stable
        await chart.AwaitStableAsync(new ChartStabilityOptions { Timeout = TimeSpan.FromSeconds(5) });

        await using var canvas = await chart.RenderToCanvasAsync();   // a browser canvas, not pixels in .NET
        // endsnippet
    }
}
