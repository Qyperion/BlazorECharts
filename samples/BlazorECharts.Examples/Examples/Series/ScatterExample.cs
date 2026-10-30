using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class ScatterExample
{
    public static ChartOptions Create()
    {
        var random = SyntheticData.Random(7);
        return new()
        {
            Title = new TitleOption { Text = "Message length by hour", Left = "center" },
            Tooltip = new TooltipOption { Trigger = "item" },
            XAxis = new XAxisValueOption { Name = "Hour", Min = 0d, Max = 24d },
            YAxis = new YAxisValueOption { Name = "Characters" },
            Series = new ScatterSeriesOption
            {
                Name = "Messages",
                SymbolSize = 10,
                Data = [.. Enumerable.Range(0, 60)
                    .Select(_ => (ScatterSeriesOptionDataItem?)new OptionDataValue?[] { random.Between(0, 24), random.Between(5, 120) })],
            },
        };
    }
}
