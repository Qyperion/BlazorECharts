using System.Text.Json.Serialization;

namespace BlazorECharts.Runtime;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(RuntimeConfiguration))]
internal partial class RuntimeInteropJsonContext : JsonSerializerContext;
