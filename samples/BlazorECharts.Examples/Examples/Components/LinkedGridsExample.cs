using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class LinkedGridsExample
{
    public static ChartOptions Create()
    {
        var random = SyntheticData.Random(25);
        CategoryAxisDataItemOption?[] days = [.. Enumerable.Range(1, 31).Select(day => (CategoryAxisDataItemOption?)$"Oct {day}")];
        LineSeriesOptionDataItem?[] messages = [.. days.Select(_ => (LineSeriesOptionDataItem?)Math.Round(random.Between(40, 160)))];
        BarSeriesOptionDataItem?[] members = [.. days.Select(_ => (BarSeriesOptionDataItem?)Math.Round(random.Between(8, 30)))];
        return new()
        {
            Title = new TitleOption { Text = "Messages and active members with one shared pointer", Left = "center" },
            Tooltip = new TooltipOption { Trigger = "axis" },
            // Linked axes show the pointer at the same category, whichever grid the cursor is in.
            AxisPointer = new AxisPointerOption { Link = [new AxisPointerLink { XAxisIndex = "all" }] },
            Grid =
            [
                new GridOption { Left = 60, Right = 30, Top = 50, Height = "30%" },
                new GridOption { Left = 60, Right = 30, Top = "55%", Height = "25%" },
            ],
            XAxis =
            [
                new XAxisCategoryOption { GridIndex = 0, Data = days, AxisLabel = new() { Show = false } },
                new XAxisCategoryOption { GridIndex = 1, Data = days },
            ],
            YAxis = [new YAxisValueOption { GridIndex = 0, Name = "Messages" }, new YAxisValueOption { GridIndex = 1, Name = "Members" }],
            DataZoom = new SliderDataZoomOption { XAxisIndex = new double?[] { 0, 1 }, Bottom = 10 },
            Series =
            [
                new LineSeriesOption { Name = "Messages", XAxisIndex = 0, YAxisIndex = 0, Data = messages },
                new BarSeriesOption { Name = "Active members", XAxisIndex = 1, YAxisIndex = 1, Data = members },
            ],
        };
    }
}
