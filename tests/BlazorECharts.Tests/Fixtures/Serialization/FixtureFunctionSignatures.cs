using BlazorECharts.Values;

namespace BlazorECharts.Tests.Fixtures.Serialization;

// Test markers only. Production signature markers are generated.
internal sealed class FixtureFormatter : IJsFunctionSignature
{
    public static string Id => "fixture:formatter";
}

internal sealed class FixtureRenderItem : IJsFunctionSignature
{
    public static string Id => "fixture:renderItem";
}
