using System.Globalization;

namespace BlazorECharts.Serialization;

// ECharts parseDate reads only three fraction digits and only the hours of an offset.
internal static class EChartsDate
{
    internal static string Format(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    internal static string Format(DateTime value) => value.Kind == DateTimeKind.Unspecified
        ? value.ToString("yyyy-MM-dd'T'HH:mm:ss.fff", CultureInfo.InvariantCulture)
        : Format(new DateTimeOffset(value));

    internal static string Format(DateOnly value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
