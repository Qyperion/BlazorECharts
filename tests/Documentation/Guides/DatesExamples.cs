using System.Globalization;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace DocumentationExamples.Guides;

internal static class DatesExamples
{
    internal static ChartOptions Dates(DateTime fromDatabase)
    {
        // snippet: Guides.Options.Dates
        var options = new ChartOptions
        {
            // Axis labels and tooltips in UTC instead of the browser's time zone.
            UseUTC = true,
            XAxis = new XAxisTimeOption(),
            YAxis = new YAxisValueOption(),
            Series = new LineSeriesOption
            {
                Data =
                [
                    // Instants: written in UTC, the same moment on every machine.
                    new OptionDataValue?[] { new DateTimeOffset(2026, 10, 19, 8, 30, 0, TimeSpan.FromHours(2)), 12 },
                    new OptionDataValue?[] { DateTime.SpecifyKind(fromDatabase, DateTimeKind.Utc), 15 },
                ],
            },
        };
        // endsnippet
        return options;
    }

    internal static async Task<DateTimeOffset> ReadBack(EChartInstance chart)
    {
        // snippet: Guides.Options.ReadDates
        // A time axis converts pixels to epoch milliseconds.
        ChartPixelValue value = await chart.ConvertFromPixelAsync(ChartFinder.Select("grid", index: 0), [120, 80]);
        DateTimeOffset at = DateTimeOffset.FromUnixTimeMilliseconds((long)value.Numbers![0]);
        // endsnippet
        return at;
    }

    internal static ChartOptions MissingValues(float reading, long messageId)
    {
        // snippet: Guides.Options.MissingValues
        var options = new ChartOptions
        {
            XAxis = new XAxisCategoryOption { Data = ["Mon", "Tue", "Wed", "Thu", "Fri"] },
            YAxis = new YAxisValueOption(),
            Series = new LineSeriesOption
            {
                // JavaScript numbers are doubles: an identifier above 2^53 keeps its digits only as a string.
                Id = messageId.ToString(CultureInfo.InvariantCulture),
                // null and "-" are missing values; the line breaks there unless ConnectNulls is true.
                // A float widens to 36.599998474121094 for 36.6f: round it or store the data as double.
                Data = [12, null, 18, "-", Math.Round((double)reading, 1)],
                ConnectNulls = false,
            },
        };
        // endsnippet
        return options;
    }
}
