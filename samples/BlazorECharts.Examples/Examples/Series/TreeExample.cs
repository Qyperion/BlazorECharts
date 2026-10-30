using BlazorECharts.Options;

namespace BlazorECharts.Examples.Series;

public static class TreeExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Replies to one announcement", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Series = new TreeSeriesOption
        {
            Name = "Thread",
            Top = 50,
            Bottom = 20,
            Left = 110,
            Right = 130,
            Orient = "LR",
            SymbolSize = 10,
            InitialTreeDepth = -1,
            ExpandAndCollapse = true,
            Label = new() { Position = "left", FontSize = 12 },
            Leaves = new() { Label = new() { Position = "right" } },
            Data =
            [
                Node("Release notes",
                    Node("Questions", Node("Install"), Node("Upgrade"), Node("Licensing")),
                    Node("Feedback", Node("Charts"), Node("Exports")),
                    Node("Thanks")),
            ],
        },
    };

    private static TreeSeriesNodeItemOption Node(string name, params TreeSeriesNodeItemOption[] replies) =>
        replies.Length == 0 ? new() { Name = name } : new() { Name = name, Children = [.. replies] };
}
