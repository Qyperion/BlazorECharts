using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class PolarExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Messages around the week", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Legend = new LegendOption { Bottom = 0 },
        Polar = new PolarOption { Center = ["50%", "52%"], Radius = new NumberOrString?[] { "10%", "72%" } },
        AngleAxis = new AngleAxisCategoryOption { Data = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], StartAngle = 90 },
        RadiusAxis = new RadiusAxisValueOption { Name = "Messages" },
        Series =
        [
            new BarSeriesOption { Name = "Sent", CoordinateSystem = "polar", Stack = "messages", Data = [12, 19, 15, 22, 30, 41, 28] },
            new BarSeriesOption { Name = "Received", CoordinateSystem = "polar", Stack = "messages", Data = [18, 21, 17, 25, 35, 52, 33] },
            new LineSeriesOption { Name = "Replies", CoordinateSystem = "polar", Smooth = true, Data = [20, 26, 22, 31, 44, 63, 40] },
        ],
    };
}
