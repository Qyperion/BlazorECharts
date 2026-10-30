namespace BlazorECharts.Runtime;

/// <summary>A structured runtime failure suitable for component error notifications.</summary>
public sealed record EChartsError(string Code, string Message, Exception? Exception = null)
{
    /// <summary>Gets the affected native handle, when allocated.</summary>
    public string? ChartId { get; init; }

    /// <summary>Gets the failed operation.</summary>
    public string? Operation { get; init; }

    /// <summary>Gets the pinned runtime version.</summary>
    public string UpstreamVersion { get; init; } = "6.1.0";

    /// <summary>Gets the code of the underlying browser or library failure, the <c>[Code]</c> that starts its message;
    /// null when it has none.</summary>
    public string? DetailCode { get; init; }

    internal static string? CodeOf(Exception? exception)
    {
        for (var e = exception; e is not null; e = e is AggregateException { InnerExceptions.Count: > 0 } aggregate
            ? aggregate.InnerExceptions[0]
            : e.InnerException)
        {
            var message = e.Message;
            var end = message.IndexOf("] ", StringComparison.Ordinal);
            if (message.StartsWith('[') && end > 1 && Letters(message.AsSpan(1, end - 1)))
                return message[1..end];
        }

        return null;

        static bool Letters(ReadOnlySpan<char> code)
        {
            foreach (var c in code)
                if (!char.IsAsciiLetter(c))
                    return false;

            return true;
        }
    }
}
