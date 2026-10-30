using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class BarExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Messages per weekday", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "axis" },
        Legend = new LegendOption { Bottom = 0 },
        Grid = new GridOption { Left = 48, Right = 24, Top = 56, Bottom = 56 },
        XAxis = new XAxisCategoryOption
        {
            Data = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        },
        YAxis = new YAxisValueOption(),
        Series =
        [
            new BarSeriesOption { Name = "Sent", Stack = "total", Data = [120, 132, 101, 134, 90, 230, 210] },
            new BarSeriesOption
            {
                Name = "Received",
                Stack = "total",
                Data = [220, 182, 191, 234, 290, 330, 310],
                ItemStyle = new() { BorderRadius = [4, 4, 0, 0] },
            },
        ],
    };
}
