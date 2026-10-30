using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class AxisVariantsExample
{
    public static ChartOptions Create()
    {
        var random = SyntheticData.Random(31);

        // Reply times in minutes: most replies come within an hour, a few take half a day.
        ScatterSeriesOptionDataItem?[] replies = [.. Enumerable.Range(0, 49).Select(index => (ScatterSeriesOptionDataItem?)new OptionDataValue?[]
        {
            SyntheticData.Weekdays[index % 7], index % 11 == 5 ? random.Between(620, 720) : random.Between(2, 55),
        })];
        return new()
        {
            Title = new TitleOption { Text = "Log scale, two value axes, an axis break and jitter", Left = "center" },
            Tooltip = new TooltipOption { Trigger = "item" },
            Legend = new LegendOption { Bottom = 0 },
            Grid =
            [
                new GridOption { Left = 70, Right = 70, Top = 60, Height = "30%" },
                new GridOption { Left = 70, Right = 70, Top = "60%", Bottom = 50 },
            ],
            XAxis =
            [
                new XAxisCategoryOption { GridIndex = 0, Data = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
                // Jitter spreads the points of one category sideways so that equal reply times stay visible.
                new XAxisCategoryOption { GridIndex = 1, Data = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], Jitter = 30 },
            ],
            YAxis =
            [
                new YAxisLogOption { GridIndex = 0, Name = "Messages (log)", LogBase = 10 },
                new YAxisValueOption { GridIndex = 0, Name = "Members", Position = "right", SplitLine = new() { Show = false } },
                // The break collapses the empty range between quick and very slow replies.
                new YAxisValueOption { GridIndex = 1, Name = "Reply minutes", Breaks = [new AxisBreakOption { Start = 80, End = 600, Gap = "6%" }] },
            ],
            Series =
            [
                new LineSeriesOption
                {
                    Name = "Messages",
                    XAxisIndex = 0,
                    YAxisIndex = 0,
                    Data = [6, 14, 40, 95, 230, 610, 1400, 2900, 4800, 7600, 9900, 12500],
                },
                new BarSeriesOption
                {
                    Name = "Members",
                    XAxisIndex = 0,
                    YAxisIndex = 1,
                    BarWidth = "40%",
                    Data = [3, 4, 6, 8, 11, 15, 19, 24, 28, 33, 37, 42],
                },
                new ScatterSeriesOption { Name = "Replies", XAxisIndex = 1, YAxisIndex = 2, SymbolSize = 8, Data = replies },
            ],
        };
    }
}
