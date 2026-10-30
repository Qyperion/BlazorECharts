using BlazorECharts.Options;

namespace BlazorECharts.Examples.Scenarios;

/// <summary>Who closes a conversation (left) and who revives it with the next message (right).</summary>
public static class SankeyScenario
{
    private static readonly (string Person, string Color)[] People =
        [("Avery", "#2f5fd0"), ("Blake", "#2f9e44"), ("Casey", "#e8590c"), ("Devon", "#ae3ec9")];

    // Closer index, reviver index and the number of such hand-offs.
    private static readonly (int Closer, int Reviver, double Count)[] Transitions =
    [
        (0, 1, 42), (0, 2, 18), (1, 0, 35), (1, 3, 12), (2, 0, 21), (2, 1, 9), (3, 0, 14), (3, 2, 7),
    ];

    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Who ends a conversation and who restarts it", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item", TriggerOn = "mousemove" },
        Series = new SankeySeriesOption
        {
            Name = "Hand-offs",
            Left = 20,
            Right = 20,
            Top = 50,
            Bottom = 20,
            NodeWidth = 18,
            NodeGap = 16,
            Emphasis = new() { Focus = "adjacency" },
            LineStyle = new() { Color = "gradient", Opacity = 0.45, Curveness = 0.5 },
            Label = new() { Color = "#1d2330", FontSize = 12 },
            // Closers label to the right, revivers to the left, so no name is clipped at the edges.
            Levels =
            [
                new SankeyLevelOption { Depth = 0, Label = new() { Position = "right" } },
                new SankeyLevelOption { Depth = 1, Label = new() { Position = "left" } },
            ],
            Data =
            [
                .. People.Select(person => Node($"Closed: {person.Person}", person.Color)),
                .. People.Select(person => Node($"Revived: {person.Person}", person.Color)),
            ],
            Links =
            [
                .. Transitions.Select(transition => (SankeyEdgeItemOption?)new SankeyEdgeItemOption
                {
                    Source = $"Closed: {People[transition.Closer].Person}",
                    Target = $"Revived: {People[transition.Reviver].Person}",
                    Value = transition.Count,
                }),
            ],
        },
    };

    private static SankeyNodeItemOption Node(string name, string color) => new() { Name = name, ItemStyle = new() { Color = color } };
}
