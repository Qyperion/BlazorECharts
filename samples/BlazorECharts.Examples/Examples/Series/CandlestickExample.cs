using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class CandlestickExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Daily members: open, close, low, high", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "axis" },
        XAxis = new XAxisCategoryOption { Data = ["Mon", "Tue", "Wed", "Thu", "Fri"] },
        YAxis = new YAxisValueOption { Scale = true },
        Series = new CandlestickSeriesOption
        {
            Name = "Members",
            ItemStyle = new() { Color = "#2f9e44", Color0 = "#e03131", BorderColor = "#2f9e44", BorderColor0 = "#e03131" },
            Data = [Day(120, 132, 115, 140), Day(132, 128, 120, 138), Day(128, 145, 126, 150), Day(145, 141, 136, 149), Day(141, 160, 139, 162)],
        },
    };

    private static CandlestickSeriesOptionDataItem Day(double open, double close, double low, double high) =>
        new OptionDataValue?[] { open, close, low, high };
}
