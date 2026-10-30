using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class PieExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Message types", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Legend = new LegendOption { Orient = "vertical", Left = "left", Top = "middle" },
        Series = new PieSeriesOption
        {
            Name = "Type",
            Radius = ["40%", "70%"],
            Center = ["60%", "55%"],
            ItemStyle = new() { BorderColor = "#fff", BorderWidth = 2, BorderRadius = 6 },
            Data = [Slice("Text", 1048), Slice("Photo", 735), Slice("Sticker", 580), Slice("Voice", 484), Slice("Video", 300)],
        },
    };

    private static PieDataItemOption Slice(string name, double value) =>
        new() { Name = name, Value = value };
}
