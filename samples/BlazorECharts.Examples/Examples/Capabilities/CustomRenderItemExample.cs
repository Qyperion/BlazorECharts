using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Examples.Capabilities;

/// <summary>A custom series whose renderItem is a browser module function receiving the native params and api.</summary>
public static class CustomRenderItemExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Online hours per participant", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Grid = new GridOption { Left = 80, Right = 30, Top = 50, Bottom = 40 },
        XAxis = new XAxisValueOption { Min = 0d, Max = 24d, Interval = 3, Name = "Hour" },
        YAxis = new YAxisCategoryOption { Data = ["Avery", "Blake", "Casey", "Devon"] },
        Series = new CustomSeriesOption
        {
            Name = "Online",
            RenderItem = JsFunction.Module<CustomRenderItemSignature>(ExampleModules.Functions, "rangeBar"),
            Encode = new OptionEncode
            {
                Entries =
                {
                    ["x"] = [1, 2],
                    ["y"] = 0,
                },
            },
            // Each item is participant index, first hour and last hour.
            Data = [Range(0, 8, 17), Range(1, 10, 22), Range(2, 6, 12), Range(3, 14, 23.5)],
        },
    };

    private static CustomSeriesOptionDataItem Range(double participant, double from, double to) =>
        new OptionDataValue?[] { participant, from, to };
}
