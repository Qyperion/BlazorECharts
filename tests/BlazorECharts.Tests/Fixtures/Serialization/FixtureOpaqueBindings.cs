using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace BlazorECharts.Tests.Fixtures.Serialization;

internal sealed class FixtureOpaqueBindings
{
    public JsFunction<FixtureFormatter>? Function { get; init; }
    public EChartsObjectReference? Reference { get; init; }
}
