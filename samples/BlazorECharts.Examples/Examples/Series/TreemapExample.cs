using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class TreemapExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Shared files by type, in megabytes", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Series = new TreemapSeriesOption
        {
            Name = "Files",
            Top = 50,
            Bottom = 40,
            Roam = false,
            Label = new() { Show = true },
            Levels =
            [
                new TreemapSeriesLevelOption { ItemStyle = new() { BorderColor = "#ffffff", BorderWidth = 3, GapWidth = 3 } },
                new TreemapSeriesLevelOption { ItemStyle = new() { BorderColor = "#e6e9ef", BorderWidth = 1, GapWidth = 1 } },
            ],
            Data =
            [
                Group("Photos", Leaf("JPEG", 420), Leaf("PNG", 160), Leaf("HEIC", 90)),
                Group("Videos", Leaf("MP4", 610), Leaf("MOV", 230)),
                Group("Documents", Leaf("PDF", 120), Leaf("Spreadsheets", 45), Leaf("Text", 12)),
                Group("Voice notes", Leaf("OGG", 75)),
            ],
        },
    };

    private static TreemapSeriesNodeItemOption Group(string name, params TreemapSeriesNodeItemOption[] children) =>
        new() { Name = name, Children = [.. children] };

    private static TreemapSeriesNodeItemOption Leaf(string name, double megabytes) =>
        new() { Name = name, Value = megabytes };
}
