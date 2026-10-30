using System.Globalization;
using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Examples.Scenarios;

/// <summary>A contributions-style activity calendar with one calendar coordinate system per year.</summary>
public static class CalendarHeatmapScenario
{
    public const int YearHeight = 170;
    private const int TopMargin = 20;
    private const int BottomMargin = 70;

    /// <summary>The synthetic history ends here, so the last calendar stops before the end of its year.</summary>
    public static readonly DateOnly LastDay = new(2026, 10, 15);

    public static int ChartHeight(int years) => TopMargin + years * YearHeight + BottomMargin;

    public static ChartOptions Create()
    {
        var counts = Activity(new DateOnly(2024, 3, 4), LastDay);
        int[] years = [.. counts.Keys.Select(day => day.Year).Distinct().Order()];
        var options = new ChartOptions
        {
            Tooltip = new TooltipOption
            {
                Trigger = "item",
                Formatter = JsFunction.Module<TooltipFormatterSignature>(ExampleModules.Functions, "calendarTooltip"),
            },
            VisualMap = new ContinuousVisualMapOption
            {
                Min = 1,
                Max = counts.Values.Max(),
                Calculable = true,
                Orient = "horizontal",
                Left = "center",
                Bottom = 15,
                Text = ["more", "less"],
                InRange = new() { Color = new string?[] { "#dfe7fb", "#8aa6e8", "#2f5fd0" } },
            },
            Title = [.. years.Select((year, index) => new TitleOption
            {
                Text = year.ToString(CultureInfo.InvariantCulture),
                Left = 8,
                Top = TopMargin + index * YearHeight,
                TextStyle = new() { FontSize = 14, FontWeight = 600 },
            })],
            Calendar = [.. years.Select((year, index) => Calendar(year, index))],
            Series = [.. years.Select((year, index) => new HeatmapSeriesOption
            {
                Name = year.ToString(CultureInfo.InvariantCulture),
                CoordinateSystem = "calendar",
                CalendarIndex = index,
                Data = [.. counts.Where(day => day.Key.Year == year)
                    .Select(day => (HeatmapSeriesOptionDataItem?)new OptionDataValue?[] { Format(day.Key), day.Value })],
            })],
        };
        return options;
    }

    private static CalendarOption Calendar(int year, int index) => new()
    {
        Top = TopMargin + index * YearHeight + 25,
        Left = 60,
        Right = 30,
        CellSize = ["auto", 14],
        // The range of the current year stops at the last day, so no future cells are drawn.
        Range = [Format(new DateOnly(year, 1, 1)), Format(Min(new DateOnly(year, 12, 31), LastDay))],
        ItemStyle = new() { BorderWidth = 0.5, BorderColor = "#ffffff" },
        SplitLine = new() { Show = true, LineStyle = new() { Color = "#d9dee7", Width = 1 } },
        YearLabel = new() { Show = false },
        DayLabel = new() { FirstDay = 1, Color = "#8a93a5" },
        MonthLabel = new() { Color = "#5b6475" },
    };

    // Busier weekdays, quiet weekends and some silent days. Silent days are omitted so they stay empty.
    private static SortedDictionary<DateOnly, int> Activity(DateOnly first, DateOnly last)
    {
        var random = SyntheticData.Random(2024);
        var counts = new SortedDictionary<DateOnly, int>();
        for (var day = first; day <= last; day = day.AddDays(1))
        {
            var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            var count = (int)random.Between(weekend ? -6 : -2, weekend ? 8 : 24);
            if (count > 0)
                counts[day] = count;
        }

        return counts;
    }

    private static DateOnly Min(DateOnly a, DateOnly b) => a < b ? a : b;

    private static string Format(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
