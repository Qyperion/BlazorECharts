using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class PiecewiseVisualMapExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Daily messages by activity level", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "axis" },
        Grid = new GridOption { Left = 50, Right = 130, Top = 60, Bottom = 40 },
        XAxis = new XAxisCategoryOption
        {
            BoundaryGap = false,
            Data = [.. Enumerable.Range(1, 30).Select(day => (CategoryAxisDataItemOption?)$"Oct {day}")],
        },
        YAxis = new YAxisValueOption(),
        // Each piece colors the line segments whose values fall into it; values above the last piece are out of range.
        VisualMap = new PiecewiseVisualMapOption
        {
            Top = 60,
            Right = 10,
            Pieces =
            [
                new VisualPiece { Lte = 20, Color = "#4caf50", Label = "Quiet (up to 20)" },
                new VisualPiece { Gt = 20, Lte = 50, Color = "#fbc02d", Label = "Normal (21 to 50)" },
                new VisualPiece { Gt = 50, Lte = 80, Color = "#fb8c00", Label = "Busy (51 to 80)" },
                new VisualPiece { Gt = 80, Lte = 120, Color = "#e53935", Label = "Peak (81 to 120)" },
            ],
            OutOfRange = new VisualMapChannelsOption { Color = "#9e9e9e" },
        },
        Series = new LineSeriesOption
        {
            Name = "Messages",
            Data = [12, 18, 25, 31, 44, 52, 61, 58, 47, 39, 28, 22, 35, 49, 66, 74, 83, 97, 112, 135, 104, 88, 71, 57, 42, 33, 26, 19, 15, 24],
        },
    };
}
