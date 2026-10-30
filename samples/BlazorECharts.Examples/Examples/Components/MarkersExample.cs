using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class MarkersExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Busiest month, average and summer break", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "axis" },
        Legend = new LegendOption { Bottom = 0 },
        XAxis = new XAxisCategoryOption { Data = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
        YAxis = new YAxisValueOption(),
        Series =
        [
            new BarSeriesOption
            {
                Name = "Sent",
                Data = [320, 280, 450, 390, 510, 470, 260, 240, 430, 560, 480, 350],
                MarkPoint = new MarkPointOption
                {
                    Data =
                    [
                        new MarkPointDataItemOption { Type = "max", Name = "Busiest" },
                        new MarkPointDataItemOption { Type = "min", Name = "Quietest" },
                    ],
                },
                MarkArea = new MarkAreaOption
                {
                    ItemStyle = new() { Color = "rgba(250, 200, 88, 0.2)" },
                    Data = [MarkAreaOptionDataItemAlternative.Create(
                        new MarkArea2DDataItemDimOption { Name = "Summer break", XAxis = "Jul" }, new MarkArea2DDataItemDimOption { XAxis = "Aug" })],
                },
            },
            new LineSeriesOption
            {
                Name = "Received",
                Data = [410, 350, 470, 420, 530, 440, 300, 280, 460, 590, 500, 380],
                MarkLine = new MarkLineOption
                {
                    Data =
                    [
                        new MarkLine1DDataItemOption { Type = "average", Name = "Average" },
                        new MarkLine1DDataItemOption { YAxis = 500, Name = "Goal" },
                    ],
                },
            },
        ],
    };
}
