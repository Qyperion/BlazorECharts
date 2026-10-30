using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace DocumentationExamples.Guides;

internal static class GraphicExamples
{
    internal static ChartOptions Shapes(Image badge)
    {
        // snippet: Guides.Graphic.Shapes
        var options = new ChartOptions
        {
            Graphic = new GraphicGroupOption
            {
                // Every graphic element writes its own type.
                Right = 30,
                Top = 12,
                Children =
                [
                    new GraphicRectOption
                    {
                        Shape = new() { X = 0, Y = 0, Width = 210, Height = 48, R = 8 },
                        Style = new() { Fill = "#e8eefc", Stroke = "#2f5fd0", LineWidth = 1 },
                    },
                    new GraphicImageOption { Style = new() { Image = badge, X = 8, Y = 8, Width = 32, Height = 32 } },
                    new GraphicTextOption
                    {
                        X = 50, Y = 15,
                        Style = new() { Text = "Best week: 61 replies", Fill = "#1d2330", FontSize = 13 },
                    },
                ],
            },
        };
        // endsnippet
        return options;
    }

    internal static async Task<ChartOptions> Image(EChartsRuntime runtime)
    {
        // snippet: Guides.Graphic.Image
        // Decoded in the browser first: HTTP, decode and CORS failures reject here.
        EChartsObjectReference badge = await runtime.CreateImageAsync("images/badge.svg");
        var options = Shapes(badge);   // Image accepts a URL string or a browser reference
        // endsnippet
        return options;
    }

    internal static async Task Factory(EChartsRuntime runtime)
    {
        // snippet: Guides.Graphic.Factory
        // js/patterns.js exports stripes(size), which draws and returns an HTMLCanvasElement.
        await using var stripes = await runtime.ImportObjectAsync("js/patterns.js", "stripes", [EChartsValue.From(8)]);
        var image = new GraphicImageOption
        {
            Style = new() { Image = stripes, X = 0, Y = 0, Width = 64, Height = 64 },
        };
        // endsnippet
        _ = image;
    }

    internal static async Task Native(EChartsRuntime runtime)
    {
        // snippet: Guides.Graphic.Native
        // Undocumented helpers have no typed member; call them by their public path.
        await using var rounded = await runtime.InvokeNativeAsync("number.round", [EChartsValue.From(1.2345), EChartsValue.From(2)]);
        double value = rounded.Json.GetDouble();   // 1.23

        // Constructors run with construct: true and return a browser object.
        await using var gradient = await runtime.InvokeNativeAsync("graphic.LinearGradient",
            [EChartsValue.From(0), EChartsValue.From(0), EChartsValue.From(0), EChartsValue.From(1),
             EChartsValue.Array(
                EChartsValue.Object(
                    new Dictionary<string, EChartsValue> { ["offset"] = EChartsValue.From(0), ["color"] = EChartsValue.From("#83bff6") }),
                EChartsValue.Object(
                    new Dictionary<string, EChartsValue> { ["offset"] = EChartsValue.From(1), ["color"] = EChartsValue.From("#188df0") }))],
            construct: true);
        EChartsObjectReference native = gradient.Reference;
        // endsnippet
        _ = value;
        _ = native;
    }

    internal static async Task Zr(EChartInstance chart)
    {
        // snippet: Guides.Graphic.Zr
        await using var zr = await chart.GetZrAsync();     // the chart's ZRender instance
        await using var dom = await chart.GetDomAsync();   // the container element
        // Pass them to a browser module with ImportObjectAsync or EChartsValue.From(reference).
        // endsnippet
    }
}
