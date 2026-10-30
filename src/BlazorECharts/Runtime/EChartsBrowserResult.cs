using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

/// <summary>A native browser result. Ordinary data is copied; objects with native identity and functions have explicit
/// retained handles.</summary>
public sealed class EChartsBrowserResult : IAsyncDisposable
{
    private readonly EChartsOptionSnapshot _owner;

    internal EChartsBrowserResult(JsonElement json, EChartsOptionSnapshot owner)
    {
        Json = json.Clone();
        _owner = owner;
    }

    /// <summary>Gets serializable data with null placeholders for native bindings.</summary>
    public JsonElement Json { get; }

    /// <summary>Gets native bindings at structured paths.</summary>
    public IReadOnlyList<JsBinding> Bindings => _owner.Bindings;

    /// <summary>Gets independently retained browser values.</summary>
    public IReadOnlyList<EChartsObjectReference> References => _owner.References;

    /// <summary>Gets the root native result. Throws when this result is ordinary data or a nested union.</summary>
    public EChartsObjectReference Reference =>
        Bindings.Count == 1 && Bindings[0].Path.Count == 0
            ? References.Single()
            : throw new InvalidOperationException("Result is not a single root browser reference.");

    /// <summary>Releases this result's handles, preserving independent chart and snapshot leases.</summary>
    public ValueTask DisposeAsync() => _owner.DisposeAsync();
}
