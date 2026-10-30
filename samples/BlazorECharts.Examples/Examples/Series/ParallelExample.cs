using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class ParallelExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Participants across four measures", Left = "center" },
        Parallel = new ParallelCoordinateSystemOption { Left = 60, Right = 80, Top = 70, Bottom = 40 },
        ParallelAxis =
        [
            new ParallelAxisDefaultValueOption { Dim = 0, Name = "Messages" },
            new ParallelAxisDefaultValueOption { Dim = 1, Name = "Words" },
            new ParallelAxisDefaultValueOption { Dim = 2, Name = "Replies" },
            new ParallelAxisDefaultCategoryOption { Dim = 3, Name = "Role", Data = ["Member", "Moderator", "Owner"] },
        ],
        Series = new ParallelSeriesOption
        {
            Name = "Participants",
            LineStyle = new() { Width = 2, Opacity = 0.6 },
            Data =
            [
                new OptionDataValue?[] { 320, 4100, 120, "Member" },
                new OptionDataValue?[] { 540, 7800, 260, "Moderator" },
                new OptionDataValue?[] { 150, 1900, 40, "Member" },
                new OptionDataValue?[] { 860, 12400, 410, "Owner" },
            ],
        },
    };
}
