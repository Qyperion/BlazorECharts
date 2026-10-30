using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class FunnelExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "From visit to reply", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Series = new FunnelSeriesOption
        {
            Name = "Conversion",
            Top = 60,
            Sort = "descending",
            Gap = 2,
            Label = new() { Show = true, Position = "inside" },
            Data = [Stage("Opened", 100), Stage("Read", 80), Stage("Reacted", 60), Stage("Replied", 40), Stage("Forwarded", 20)],
        },
    };

    private static FunnelDataItemOption Stage(string name, double value) =>
        new() { Name = name, Value = value };
}
