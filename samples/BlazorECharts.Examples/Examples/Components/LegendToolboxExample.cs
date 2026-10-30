using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class LegendToolboxExample
{
    public static ChartOptions Create()
    {
        var random = SyntheticData.Random(41);
        return new()
        {
            Title = new TitleOption { Text = "Messages per member", Left = 10 },
            Tooltip = new TooltipOption { Trigger = "axis" },
            // Twelve members do not fit into the legend row: it pages through them, and the selector buttons select all or invert.
            Legend = new ScrollableLegendOption { Top = 34, Left = 10, Width = "55%", Selector = true },
            Toolbox = new ToolboxComponentOption
            {
                Right = 10,
                Feature = new()
                {
                    MagicType = new() { Type = ["line", "bar", "stack"] },
                    DataZoom = new() { YAxisIndex = "none" },
                    Restore = new(),
                },
            },
            Grid = new GridOption { Left = 50, Right = 20, Top = 90, Bottom = 30 },
            XAxis = new XAxisCategoryOption { Data = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
            YAxis = new YAxisValueOption(),
            Series = [.. SyntheticData.People.Select(person => (SeriesOption)new LineSeriesOption
            {
                Name = person,
                Data = [.. SyntheticData.Months.Select(_ => (LineSeriesOptionDataItem?)Math.Round(random.Between(10, 90)))],
            })],
        };
    }
}
