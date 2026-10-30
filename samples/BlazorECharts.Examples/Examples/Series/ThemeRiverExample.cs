using System.Globalization;
using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class ThemeRiverExample
{
    public static ChartOptions Create()
    {
        string[] topics = ["Travel", "Music", "Work"];
        var random = SyntheticData.Random(3);
        var firstWeek = new DateOnly(2026, 1, 5);
        ThemeRiverSeriesOptionDataItem?[] data = [.. Enumerable.Range(0, 12).SelectMany(week => topics.Select(topic =>
            (ThemeRiverSeriesOptionDataItem?)ThemeRiverSeriesOptionDataItem.Create(
                firstWeek.AddDays(7 * week).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Math.Round(random.Between(5, 40)),
                topic)))];
        return new()
        {
            Title = new TitleOption { Text = "Topics over twelve weeks", Left = "center" },
            Tooltip = new TooltipOption { Trigger = "axis" },
            Legend = new LegendOption { Bottom = 0 },
            SingleAxis = new SingleAxisTimeOption { Top = 50, Bottom = 50 },
            Series = new ThemeRiverSeriesOption { Name = "Topics", Data = data },
        };
    }
}
