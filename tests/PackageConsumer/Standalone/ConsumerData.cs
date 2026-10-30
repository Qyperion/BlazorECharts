using System.Text.Json.Serialization;

namespace PackageConsumer.Standalone;

// Consumer-owned chart data. Its JSON contract comes only from the source-generated metadata below.
public sealed record CustomPoint(double X, double Y, [property: JsonPropertyName("tag")] string Label);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CustomPoint[]))]
public partial class ConsumerJsonContext : JsonSerializerContext;
