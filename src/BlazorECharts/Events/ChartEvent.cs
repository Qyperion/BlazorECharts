using System.Text.Json;

namespace BlazorECharts.Events;

/// <summary>An explicit event name and reflection-free payload reader. Custom events can supply their own reader.</summary>
public sealed class ChartEvent<TEvent>(string name, Func<JsonElement, TEvent> read)
{
    /// <summary>Gets the exact lower-case ECharts subscription name.</summary>
    public string Name { get; } = !string.IsNullOrWhiteSpace(name)
        ? name.ToLowerInvariant()
        : throw new ArgumentException("An event name is required.", nameof(name));

    internal TEvent Read(JsonElement json) => read(json);
}
