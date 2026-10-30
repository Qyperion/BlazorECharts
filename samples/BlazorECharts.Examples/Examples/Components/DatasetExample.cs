using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class DatasetExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Monthly messages from one dataset", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Legend = new LegendOption { Bottom = 0, Data = ["Sent", "Received"] },
        Aria = new AriaOption
        {
            Enabled = true,
            Description = "Bars and a line show the messages sent and received each month; a pie shows the months with at least 400 sent messages, busiest first.",
        },
        Dataset =
        [
            new DatasetOption
            {
                Id = "months",
                SourceHeader = true,
                Source = new OptionDataValue?[][]
                {
                    ["month", "sent", "received"],
                    ["Jan", 320, 410], ["Feb", 280, 350], ["Mar", 450, 470], ["Apr", 390, 420], ["May", 510, 530], ["Jun", 470, 440],
                    ["Jul", 260, 300], ["Aug", 240, 280], ["Sep", 430, 460], ["Oct", 560, 590], ["Nov", 480, 500], ["Dec", 350, 380],
                },
            },
            // A derived dataset: the transform keeps the busy months and sorts them, without copying the source rows.
            new DatasetOption
            {
                Id = "busiest",
                FromDatasetId = "months",
                Transform =
                [
                    new FilterTransformOption { Config = new RelationalExpressionOption { Dimension = "sent", Gte = 400 } },
                    new SortTransformOption { Config = new SortTransformOptionConfigItem { Dimension = "sent", Order = "desc" } },
                ],
            },
        ],
        Grid = new GridOption { Left = 50, Right = "42%", Top = 60, Bottom = 60 },
        XAxis = new XAxisCategoryOption(),
        YAxis = new YAxisValueOption(),
        Series =
        [
            new BarSeriesOption { Name = "Sent", DatasetIndex = 0, Encode = Encode(("x", "month"), ("y", "sent")) },
            new LineSeriesOption { Name = "Received", DatasetIndex = 0, Encode = Encode(("x", "month"), ("y", "received")) },
            new PieSeriesOption
            {
                Name = "Busiest months",
                DatasetIndex = 1,
                Center = new NumberOrString?[] { "79%", "52%" },
                Radius = new NumberOrString?[] { "18%", "40%" },
                Encode = Encode(("itemName", "month"), ("value", "sent")),
            },
        ],
    };

    private static OptionEncode Encode(params (string Channel, string Dimension)[] channels)
    {
        var encode = new OptionEncode();
        foreach (var (channel, dimension) in channels)
            encode.Entries[channel] = dimension;

        return encode;
    }
}
