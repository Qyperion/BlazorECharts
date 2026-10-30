// snippet: Compatibility.WasmAot.ConsumerJson
using System.Text.Json.Serialization;
// endsnippet
using BlazorECharts.Runtime;

namespace DocumentationExamples.Compatibility;

// snippet: Compatibility.WasmAot.ConsumerJson
public sealed record CustomPoint(double X, double Y, [property: JsonPropertyName("tag")] string Label);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CustomPoint[]))]
public partial class ConsumerJsonContext : JsonSerializerContext;

// endsnippet

internal static class ConsumerJsonRegistration
{
    internal static void Register(EChartsRuntime runtime)
    {
        // snippet: Compatibility.WasmAot.ConsumerJson
        // Once per runtime facade, before the data is used, for example in the root component:
        runtime.Serialization.Register(ConsumerJsonContext.Default.CustomPointArray);
        // endsnippet
    }
}
