using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Testing;

public static class GraphicGeometryFixtures
{
    public static ChartOptions Create(string? module = null)
    {
        var arc = new GraphicArcOption
        {
            Id = "arc",
            Name = "arc",
            X = 80,
            Y = 80,
            Shape = new GraphicArcShape { Cx = 0, Cy = 0, R = 30, StartAngle = 0, EndAngle = 4, Clockwise = false },
            Style = new() { Fill = "none", Stroke = "#2460aa", LineWidth = 3 },
        };
        if (module is not null)
        {
            arc.During = JsFunction.Module<GraphicArcOptionDuringSignature>(module, "during");
            arc.EnterAnimation = new() { Duration = 120 };
            arc.EnterFrom = new() { Shape = new() { R = 0 } };
        }

        return new ChartOptions
        {
            Animation = module is not null,
            Graphic = OneOrMany<GraphicOption?>.Many(
            [
                arc,
                new GraphicCircleOption
                {
                    Id = "circle",
                    X = 220,
                    Y = 80,
                    Shape = new() { Cx = 0, Cy = 0, R = 25 },
                    Style = new() { Fill = "#2480cc" },
                },
                new GraphicRectOption
                {
                    Id = "rect",
                    X = 360,
                    Y = 60,
                    Shape = new() { X = 0, Y = 0, Width = 45, Height = 35, R = OneOrMany<double?>.One(4) },
                    Style = new() { Fill = "#2480cc" },
                },
                new GraphicRingOption
                {
                    Id = "ring",
                    X = 520,
                    Y = 80,
                    Shape = new() { Cx = 0, Cy = 0, R = 30, R0 = 15 },
                    Style = new() { Fill = "#2480cc" },
                },
                new GraphicSectorOption
                {
                    Id = "sector",
                    X = 680,
                    Y = 80,
                    Shape = new() { Cx = 0, Cy = 0, R = 30, R0 = 8, StartAngle = 0, EndAngle = 4, Clockwise = true },
                    Style = new() { Fill = "#2480cc" },
                },
                new GraphicPolygonOption
                {
                    Id = "polygon",
                    X = 60,
                    Y = 220,
                    Shape = new() { Points = [[0, 0], [40, 20], [10, 45]] },
                    Style = new() { Fill = "#2480cc" },
                },
                new GraphicPolylineOption
                {
                    Id = "polyline",
                    X = 200,
                    Y = 220,
                    Shape = new() { Points = [[0, 0], [40, 20], [10, 45]] },
                    Style = new() { Fill = "none", Stroke = "#2460aa", LineWidth = 3 },
                },
                new GraphicLineOption
                {
                    Id = "line",
                    X = 340,
                    Y = 220,
                    Shape = new() { X1 = 0, Y1 = 0, X2 = 45, Y2 = 35 },
                    Style = new() { Stroke = "#2460aa", LineWidth = 3 },
                },
                new GraphicBezierCurveOption
                {
                    Id = "bezierCurve",
                    X = 500,
                    Y = 220,
                    Shape = new() { X1 = 0, Y1 = 0, X2 = 50, Y2 = 40, Cpx1 = 35, Cpy1 = 0, Cpx2 = 15, Cpy2 = 40 },
                    Style = new() { Fill = "none", Stroke = "#2460aa", LineWidth = 3 },
                },
                new GraphicEllipseOption
                {
                    Id = "ellipse",
                    X = 680,
                    Y = 240,
                    Shape = new() { Cx = 0, Cy = 0, Rx = 30, Ry = 20 },
                    Style = new() { Fill = "#2480cc" },
                },
            ]),
        };
    }
}
