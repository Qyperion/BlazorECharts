using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class RadarExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Communication style", Left = "center" },
        Legend = new LegendOption { Bottom = 0 },
        Radar = new RadarOption
        {
            Indicator =
            [
                new RadarIndicatorOption { Name = "Messages", Max = 100 },
                new RadarIndicatorOption { Name = "Questions", Max = 100 },
                new RadarIndicatorOption { Name = "Media", Max = 100 },
                new RadarIndicatorOption { Name = "Replies", Max = 100 },
                new RadarIndicatorOption { Name = "Reactions", Max = 100 },
            ],
        },
        Series = new RadarSeriesOption
        {
            Name = "Style",
            AreaStyle = new() { Opacity = 0.2 },
            Data =
            [
                new RadarSeriesDataItemOption { Name = "Avery", Value = [80, 30, 55, 70, 40] },
                new RadarSeriesDataItemOption { Name = "Blake", Value = [45, 75, 20, 50, 90] },
            ],
        },
    };
}
