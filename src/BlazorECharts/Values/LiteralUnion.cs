using System.Globalization;

namespace BlazorECharts.Values;

// The error of a generated union whose alternative accepts only literals.
internal static class LiteralUnion
{
    internal static ArgumentException Rejected(string union, string? value, string accepted, string? others, bool acceptsNumber)
    {
        var message = Message(union, value is null ? "null" : "\"" + value + "\"", accepted, others);
        if (acceptsNumber
            && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            && double.IsFinite(number))
        {
            message += $" Pass {number.ToString(CultureInfo.InvariantCulture)} as a number, not a string.";
        }

        return new ArgumentException(message, "value");
    }

    internal static ArgumentException Rejected(string union, bool value, string accepted, string? others) =>
        new(Message(union, value ? "true" : "false", accepted, others), "value");

    private static string Message(string union, string value, string accepted, string? others) =>
        others is null
            ? $"{union}: {value} is not {accepted}."
            : $"{union}: {value} is not {accepted}. The union also accepts {others}.";
}
