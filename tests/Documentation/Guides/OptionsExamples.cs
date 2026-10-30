// snippet: Guides.Options.Build
using BlazorECharts.Options;
using BlazorECharts.Values;
// endsnippet
using System.Text.Json;
// snippet: Guides.Options.CustomData
using System.Text.Json.Serialization;
// endsnippet
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;

namespace DocumentationExamples.Guides;

internal static class OptionsExamples
{
    internal static ChartOptions Build()
    {
        // snippet: Guides.Options.Build
        var options = new ChartOptions
        {
            Title = new TitleOption { Text = "Revenue and orders", Left = "center" },
            Tooltip = new TooltipOption { Trigger = "axis" },
            Legend = new LegendOption { Bottom = 0 },
            XAxis = new XAxisCategoryOption { Data = ["Q1", "Q2", "Q3", "Q4"] },
            // A collection expression writes a JSON array, also with one element; a single value writes an object.
            YAxis =
            [
                new YAxisValueOption { Name = "Revenue" },
                new YAxisValueOption { Name = "Orders", Position = "right" },
            ],
            Series =
            [
                new BarSeriesOption { Name = "Revenue", Data = [320, 410, 380, 520] },
                new LineSeriesOption { Name = "Orders", YAxisIndex = 1, Smooth = true, Data = [12, 18, 15, 21] },
            ],
        };
        // endsnippet
        return options;
    }

    internal static BarSeriesOption Unions()
    {
        // snippet: Guides.Options.Unions
        var bar = new BarSeriesOption
        {
            Name = "Revenue",
            BarWidth = "40%",
            ItemStyle = new()
            {
                Color = new LinearGradientObject
                {
                    X = 0,
                    Y = 0,
                    X2 = 0,
                    Y2 = 1,
                    ColorStops = [new() { Offset = 0, Color = "#83bff6" }, new() { Offset = 1, Color = "#188df0" }],
                },
                BorderRadius = [4, 4, 0, 0],
            },
            Data = [320, 410, 380, 520],
        };
        // endsnippet
        return bar;
    }

    internal static ChartOptions UnionLists()
    {
        // snippet: Guides.Options.UnionLists
        var options = new ChartOptions
        {
            Color = "#5470c6",
            Series = new PieSeriesOption
            {
                Radius = ["40%", "70%"],
                ItemStyle = new() { BorderRadius = 6 },
                Data = [new PieDataItemOption { Name = "Search", Value = 1048 }, new PieDataItemOption { Name = "Direct", Value = 735 }],
            },
        };
        // endsnippet
        return options;
    }

    internal static string? Read(BarSeriesOption bar)
    {
        // snippet: Guides.Options.Read
        NumberOrString width = bar.BarWidth!.Value;
        if (width.TryGet(out string? percent))
            Console.WriteLine($"Relative width {percent}");
        else if (width.TryGet(out double pixels))
            Console.WriteLine($"Width {pixels}px");

        object? color = bar.ItemStyle!.Color!.Value.Value;   // the assigned LinearGradientObject
        // endsnippet
        return color?.ToString();
    }

    internal static void ReadCollections(ChartOptions options)
    {
        // snippet: Guides.Options.ReadCollections
        foreach (var title in options.Title?.Items ?? [])
            Console.WriteLine(title?.Text);

        foreach (var series in options.Series?.Items ?? [])
        {
            if (series is LineSeriesOption { Name: { } name } && name.TryGet(out string? text))
                Console.WriteLine($"line {text}");
        }
        // endsnippet
    }

    internal static LineSeriesOption Presence()
    {
        // snippet: Guides.Options.Presence
        var line = new LineSeriesOption
        {
            Smooth = false,                 // written as "smooth": false
            Label = new() { Show = null },  // written as "label": { "show": null }
        };
        bool assigned = line.IsAssigned("smooth");   // true; unassigned properties are not written

        // A field without a typed member, written next to the typed fields.
        line.AdditionalProperties["futureOption"] = EChartsValue.From(true);
        // endsnippet
        _ = assigned;
        return line;
    }

    internal static ChartOptions OpenValues()
    {
        // snippet: Guides.Options.OpenValues
        var options = new ChartOptions
        {
            Dataset = new DatasetOption
            {
                Source = new OptionDataValue?[][]
                {
                    ["Product", "2025", "2026"],
                    ["Tea", 43.3, 85.8],
                    ["Coffee", 83.1, 73.4],
                },
            },
            XAxis = new XAxisCategoryOption(),
            YAxis = new YAxisValueOption(),
            Series = [new BarSeriesOption(), new BarSeriesOption()],
        };
        // endsnippet
        return options;
    }

    internal static void CustomData(EChartsRuntime runtime)
    {
        // snippet: Guides.Options.CustomData
        runtime.Serialization.Register(SalesJsonContext.Default.SalesPointArray);

        // Object rows: ECharts takes the dimension names "week" and "amount" from the JSON keys.
        var dataset = new DatasetOption();
        dataset.AdditionalProperties["source"] = EChartsValue.From(new SalesPoint[] { new(1, 120), new(2, 200) });
        // endsnippet
        _ = dataset;
    }
}

// snippet: Guides.Options.CustomData
public sealed record SalesPoint([property: JsonPropertyName("week")] double Week, [property: JsonPropertyName("amount")] double Amount);

[JsonSerializable(typeof(SalesPoint[]))]
public partial class SalesJsonContext : JsonSerializerContext;
// endsnippet
