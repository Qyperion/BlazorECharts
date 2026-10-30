using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class GaugeExample
{
    public static ChartOptions Create() => new()
    {
        Series = new GaugeSeriesOption
        {
            Name = "Response rate",
            Min = 0,
            Max = 100,
            Progress = new() { Show = true, Width = 14 },
            Detail = new() { ValueAnimation = true, Formatter = "{value}%" },
            Data = [new GaugeDataItemOption { Name = "Replied", Value = 72 }],
        },
    };
}
