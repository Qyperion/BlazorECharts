using BlazorECharts.Options;
using BlazorECharts.Runtime;

namespace BlazorECharts.Examples;

/// <summary>Describes one runnable catalog example.</summary>
public sealed class ExampleDescriptor
{
    /// <summary>Gets the stable URL identity, in lowercase kebab case.</summary>
    public required string Slug { get; init; }

    /// <summary>Gets the display title.</summary>
    public required string Title { get; init; }

    /// <summary>Gets a plain-text description of what the chart shows, also used as its accessible description.</summary>
    public required string Summary { get; init; }

    /// <summary>Gets lowercase search tags.</summary>
    public required IReadOnlyList<string> Tags { get; init; }

    /// <summary>Creates a new typed option graph for the example's primary chart.</summary>
    public required Func<ChartOptions> CreateOptions { get; init; }

    /// <summary>Gets the path of the C# or Razor source file, relative to the examples project.</summary>
    public required string SourcePath { get; init; }

    /// <summary>Gets an interactive component deriving from <see cref="ExampleBase"/>; null renders
    /// <see cref="CreateOptions"/> as one chart.</summary>
    public Type? Component { get; init; }

    /// <summary>Gets the page registrations that <see cref="CreateOptions"/> needs, such as a map or a custom series, or
    /// null when the options need none. The catalog thumbnail runs it; an interactive component registers on its own.</summary>
    public Func<EChartsRuntime, ValueTask>? Prepare { get; init; }

    /// <summary>Gets the browser modules that the example's functions are imported from.</summary>
    public IReadOnlyList<string> Modules { get; init; } = [];

    /// <summary>Gets the identities of the page extensions the example requires.</summary>
    public IReadOnlyList<string> Extensions { get; init; } = [];

    /// <summary>
    /// Gets whether the chart animates continuously, as ripple and trail effects do. Such a chart never reaches a stable
    /// layout, so it is reported ready after its options are applied.
    /// </summary>
    public bool ContinuousAnimation { get; init; }

    /// <summary>Gets the chart height in CSS pixels, or null for the default height.</summary>
    public int? Height { get; init; }

    /// <summary>Gets the inline style that applies <see cref="Height"/>.</summary>
    public string? ChartStyle => Height is { } height ? $"height:{height}px" : null;

    /// <summary>Gets whether the descriptor matches every whitespace-separated term of a query by title or tag.</summary>
    public bool Matches(string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
            return true;

        return query.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).All(term =>
            Title.Contains(term, StringComparison.OrdinalIgnoreCase)
            || Tags.Any(tag => tag.Contains(term, StringComparison.OrdinalIgnoreCase)));
    }
}
