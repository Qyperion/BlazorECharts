using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class EffectScatterExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Busiest hours highlighted", Left = "center" },
        XAxis = new XAxisValueOption { Name = "Hour", Min = 0d, Max = 24d },
        YAxis = new YAxisValueOption { Name = "Messages" },
        Series =
        [
            new ScatterSeriesOption
            {
                Name = "Hours",
                Data = [Point(8, 30), Point(12, 45), Point(16, 38), Point(23, 12)],
            },
            new EffectScatterSeriesOption
            {
                Name = "Peaks",
                SymbolSize = 18,
                ShowEffectOn = "render",
                RippleEffect = new() { BrushType = "stroke", Scale = 3 },
                Data = [new OptionDataValue?[] { 20, 92 }, new OptionDataValue?[] { 21, 88 }],
            },
        ],
    };

    private static ScatterSeriesOptionDataItem Point(double hour, double messages) => new OptionDataValue?[] { hour, messages };
}
