using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class ThumbnailExample
{
    public static ChartOptions Create()
    {
        // The first four members form the core team on an inner ring; everyone else sits on an outer ring.
        var people = SyntheticData.People;
        GraphSeriesOptionDataItem?[] nodes = [.. people.Select((person, index) =>
        {
            var (radius, slot, slots) = index < 4 ? (90d, index, 4) : (260d, index - 4, people.Length - 4);
            var angle = 2 * Math.PI * slot / slots;
            return (GraphSeriesOptionDataItem?)new GraphNodeItemOption
            {
                Name = person,
                X = Math.Round(radius * Math.Cos(angle)),
                Y = Math.Round(radius * Math.Sin(angle)),
                SymbolSize = index < 4 ? 30 : 18,
            };
        })];
        GraphEdgeItemOption?[] links =
        [
            .. Enumerable.Range(0, 4).Select(index => new GraphEdgeItemOption { Source = people[index], Target = people[(index + 1) % 4] }),
            .. Enumerable.Range(4, people.Length - 4).Select(index => new GraphEdgeItemOption { Source = people[index], Target = people[index % 4] }),
        ];
        return new()
        {
            Title = new TitleOption { Text = "Reply network: zoom in and follow the thumbnail", Left = "center" },
            Tooltip = new TooltipOption(),
            Thumbnail = new ThumbnailOption { Width = "25%", Height = "25%", Right = 10, Bottom = 10 },
            Series = new GraphSeriesOption
            {
                Name = "Replies",
                Layout = "none",
                Roam = true,
                Zoom = 1.6,
                Label = new() { Show = true, Position = "right" },
                LineStyle = new() { Opacity = 0.6 },
                Data = nodes,
                Links = links,
            },
        };
    }
}
