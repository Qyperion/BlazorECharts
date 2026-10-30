using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class LinesExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Message routes between rooms", Left = "center" },
        XAxis = new XAxisValueOption { Min = 0d, Max = 10d },
        YAxis = new YAxisValueOption { Min = 0d, Max = 10d },
        Series = new LinesSeriesOption
        {
            Name = "Routes",
            CoordinateSystem = "cartesian2d",
            // A trail (trailLength above 0) is canvas-only; plain moving symbols work with both renderers.
            Effect = new() { Show = true, Period = 4, TrailLength = 0, Symbol = "circle", SymbolSize = 7 },
            LineStyle = new() { Width = 2, Curveness = 0.3, Opacity = 0.7 },
            Data = new LinesDataItemOption?[]
            {
                Route("Lobby to Design", (1, 1), (8, 6)),
                Route("Design to Support", (8, 6), (3, 9)),
                Route("Support to Lobby", (3, 9), (1, 1)),
            },
        },
    };

    private static LinesDataItemOption Route(string name, (double X, double Y) from, (double X, double Y) to) =>
        new() { Name = name, Coords = [[from.X, from.Y], [to.X, to.Y]] };
}
