using BlazorECharts.Options;
using BlazorECharts.Values;

namespace BlazorECharts.Examples.Components;

public static class MatrixExample
{
    // Messages of each member (rows) on each day of the week (columns).
    private static readonly double[][] Messages =
    [
        [12, 30, 18, 22, 26, 4, 9],
        [8, 26, 22, 19, 31, 2, 5],
        [20, 34, 15, 28, 24, 7, 12],
        [16, 21, 28, 33, 17, 10, 6],
    ];

    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Messages by member and weekday", Left = "center" },
        Tooltip = new TooltipOption { Trigger = "item" },
        Matrix = new MatrixOption
        {
            Top = 50,
            Bottom = 85,
            Left = 20,
            Right = 20,
            // Header values identify cells, so they are unique across a dimension.
            X = new MatrixDimensionOption { Data = [Header("Weekdays", "Mon", "Tue", "Wed", "Thu", "Fri"), Header("Weekend", "Sat", "Sun")] },
            Y = new MatrixDimensionOption { Data = [Header("Design", "Avery", "Blake"), Header("Support", "Casey", "Devon")] },
        },
        VisualMap = new ContinuousVisualMapOption { Min = 0, Max = 35, Calculable = true, Orient = "horizontal", Left = "center", Bottom = 10 },
        // The cells are addressed by the index of the leaf header on each dimension; a header value would do as well.
        Series = new HeatmapSeriesOption
        {
            Name = "Messages",
            CoordinateSystem = "matrix",
            Label = new() { Show = true },
            Data = [.. Messages.SelectMany(
                (row, y) => row.Select((messages, x) => (HeatmapSeriesOptionDataItem?)new OptionDataValue?[] { x, y, messages }))],
        },
    };

    private static MatrixDimensionCellOption Header(string value, params string[] children) =>
        new() { Value = value, Children = [.. children.Select(child => (MatrixDimensionCellOption?)new MatrixDimensionCellOption { Value = child })] };
}
