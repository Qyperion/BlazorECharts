using System.Text.Json.Serialization;

namespace BlazorECharts.Tests.Fixtures.Serialization;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(FixtureData))]
[JsonSerializable(typeof(FixtureData[]))]
[JsonSerializable(typeof(FixtureWrappedValue))]
[JsonSerializable(typeof(FixtureWrappedItems))]
[JsonSerializable(typeof(FixtureWrappedOptions))]
[JsonSerializable(typeof(FixtureConvertedValue))]
[JsonSerializable(typeof(FixtureHeader))]
[JsonSerializable(typeof(FixtureRange))]
[JsonSerializable(typeof(BlazorECharts.Serialization.PreparedOption))]
[JsonSerializable(typeof(FixtureOpaqueBindings))]
internal partial class FixtureJsonContext : JsonSerializerContext;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, GenerationMode = JsonSourceGenerationMode.Metadata)]
[JsonSerializable(typeof(FixtureWrappedValue))]
internal partial class FixtureMetadataOnlyContext : JsonSerializerContext;
