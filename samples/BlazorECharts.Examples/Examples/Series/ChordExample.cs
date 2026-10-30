using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Series;

public static class ChordExample
{
    private static readonly string[] People = ["Avery", "Blake", "Casey", "Devon"];

    // Who replied to whom, and how often.
    private static readonly (int From, int To, double Replies)[] Replies =
        [(0, 1, 42), (1, 0, 35), (0, 2, 18), (2, 0, 21), (1, 3, 12), (3, 1, 9), (2, 3, 14), (3, 0, 7)];

    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Replies between members", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Series = new ChordSeriesOption
        {
            Name = "Replies",
            Radius = ["62%", "70%"],
            PadAngle = 3,
            Label = new() { Show = true },
            LineStyle = new() { Color = "source", Opacity = 0.5 },
            Data = [.. People.Select(person => (ChordSeriesOptionDataItem?)new ChordNodeItemOption { Name = person })],
            Links =
            [
                .. Replies.Select(reply => (ChordEdgeItemOption?)new ChordEdgeItemOption
                {
                    Source = People[reply.From],
                    Target = People[reply.To],
                    Value = reply.Replies,
                }),
            ],
        },
    };
}
