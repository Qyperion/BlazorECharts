namespace BlazorECharts.Runtime;

/// <summary>Limits the whole readiness operation, including queueing, revisions and membership changes.</summary>
public sealed class ChartStabilityOptions
{
    private TimeSpan _timeout = TimeSpan.FromSeconds(30);

    /// <summary>Gets or sets a timeout greater than zero and at most 2147483647 milliseconds. The default is 30
    /// seconds.</summary>
    /// <exception cref="ArgumentOutOfRangeException">The value is zero, negative or over 2147483647 milliseconds.</exception>
    public TimeSpan Timeout
    {
        get => _timeout;
        set
        {
            if (value <= TimeSpan.Zero || value.TotalMilliseconds > int.MaxValue)
                throw new ArgumentOutOfRangeException(
                    nameof(value),
                    value,
                    "The stability timeout must be greater than zero and at most 2147483647 milliseconds.");

            _timeout = value;
        }
    }
}
