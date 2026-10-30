using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class PictorialBarExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Stickers sent, one mark per ten", Left = "center" },
        Grid = new GridOption { Left = 90, Right = 40, Top = 60, Bottom = 30 },
        XAxis = new XAxisValueOption { Max = 120d, SplitLine = new() { Show = false } },
        YAxis = new YAxisCategoryOption { Data = ["Avery", "Blake", "Casey", "Devon"] },
        Series = new PictorialBarSeriesOption
        {
            Name = "Stickers",
            Symbol = "roundRect",
            SymbolRepeat = "fixed",
            SymbolSize = [12, 12],
            SymbolMargin = "30%",
            SymbolClip = true,
            Data = [40, 90, 65, 110],
        },
    };
}
