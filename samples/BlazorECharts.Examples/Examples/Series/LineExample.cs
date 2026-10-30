using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class LineExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Monthly active members", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "axis" },
        Legend = new LegendOption { Bottom = 0 },
        XAxis = new XAxisCategoryOption
        {
            BoundaryGap = false,
            Data = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        },
        YAxis = new YAxisValueOption(),
        Series =
        [
            new LineSeriesOption
            {
                Name = "Members",
                Smooth = true,
                AreaStyle = new() { Opacity = 0.2 },
                Data = [18, 22, 25, 31, 29, 35, 41, 39, 44, 47, 52, 58],
            },
            new LineSeriesOption
            {
                Name = "Target",
                Step = "middle",
                LineStyle = new() { Type = "dashed" },
                Data = [20, 20, 25, 25, 30, 30, 40, 40, 45, 45, 50, 50],
            },
        ],
    };
}
