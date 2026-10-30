using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class HeatmapExample
{
    public static ChartOptions Create()
    {
        var random = SyntheticData.Random(11);
        HeatmapSeriesOptionDataItem?[] cells = [.. Enumerable.Range(0, 7 * 24).Select(index =>
            (HeatmapSeriesOptionDataItem?)new OptionDataValue?[] { index % 24, index / 24, Math.Round(random.Between(0, 10)) })];
        return new()
        {
            Title = new TitleOption { Text = "Activity by weekday and hour", Left = "center" },
            Tooltip = new TooltipOption { Position = "top" },
            Grid = new GridOption { Top = 50, Bottom = 80, Left = 50, Right = 20 },
            XAxis = new XAxisCategoryOption
            {
                Data = [.. Enumerable.Range(0, 24).Select(hour => (CategoryAxisDataItemOption?)$"{hour:00}")],
                SplitArea = new() { Show = true },
            },
            YAxis = new YAxisCategoryOption
            {
                Data = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                SplitArea = new() { Show = true },
            },
            VisualMap = new ContinuousVisualMapOption
            {
                Min = 0,
                Max = 10,
                Calculable = true,
                Orient = "horizontal",
                Left = "center",
                Bottom = 10,
            },
            Series = new HeatmapSeriesOption { Name = "Messages", Data = cells },
        };
    }
}
