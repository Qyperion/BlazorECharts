using System.Text.Json.Serialization;
namespace BrowserHost.Client.Shared;

public sealed record ConsumerHelperData(string Label, int Value, bool Flag, int[] Empty);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(ConsumerHelperData))]
public partial class ConsumerHelperJsonContext : JsonSerializerContext;
