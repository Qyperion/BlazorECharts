using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class BoxplotExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Reply time distribution, minutes", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        XAxis = new XAxisCategoryOption { Data = ["Avery", "Blake", "Casey", "Devon"] },
        YAxis = new YAxisValueOption { Name = "Minutes" },
        Series = new BoxplotSeriesOption
        {
            Name = "Reply time",
            // Each box is minimum, lower quartile, median, upper quartile and maximum.
            Data = [Box(1, 4, 9, 18, 42), Box(2, 6, 12, 25, 60), Box(1, 3, 5, 9, 21), Box(3, 9, 15, 31, 75)],
        },
    };

    private static BoxplotSeriesOptionDataItem Box(params double[] values) =>
        values.Select(value => (OptionDataValueNumeric?)value).ToArray();
}
