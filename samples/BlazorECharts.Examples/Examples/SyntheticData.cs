namespace BlazorECharts.Examples;

/// <summary>Deterministic synthetic data. Every example renders the same picture on every load.</summary>
public static class SyntheticData
{
    /// <summary>Short month names, independent of the current culture.</summary>
    public static readonly string[] Months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /// <summary>Weekday names starting on Monday.</summary>
    public static readonly string[] Weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    /// <summary>Fictional participant names.</summary>
    public static readonly string[] People = ["Avery", "Blake", "Casey", "Devon", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Logan", "Morgan", "Parker"];

    /// <summary>Creates a seeded generator; the same seed always yields the same sequence.</summary>
    public static Random Random(int seed) => new(seed);

    /// <summary>Gets a rounded value between <paramref name="min"/> and <paramref name="max"/>.</summary>
    public static double Between(this Random random, double min, double max) => Math.Round(min + random.NextDouble() * (max - min), 1);
}
