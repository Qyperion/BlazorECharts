using System.Reflection;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Tests.GeneratedContracts;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Api;

public class PublicApiCoverageTests
{
    private static JsonDocument Manifest() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "ManifestSymbols.g.json")));

    [Fact]
    public void EventActionRuntimeNamesMatchCompiledDescriptorsAndSerializedActions()
    {
        // Arrange
        using var manifest = Manifest();
        var types = typeof(ChartOptions).Assembly.GetTypes().ToLookup(t => t.Name);
        var entries = manifest.RootElement.GetProperty("eventActions").EnumerateArray().ToArray();

        // Act & Assert
        Assert.Equal(96, entries.Length);
        foreach (var entry in entries)
        {
            var runtimeName = entry.GetProperty("runtimeName").GetString();
            var symbol = entry.GetProperty("symbol").GetString()!;
            if (symbol.StartsWith("ChartEvents.", StringComparison.Ordinal))
            {
                var property = Assert.Single(types["ChartEvents"]).GetProperty(symbol["ChartEvents.".Length..])!;
                var descriptor = property.GetValue(null)!;
                Assert.Equal(runtimeName, descriptor.GetType().GetProperty("Name")!.GetValue(descriptor));
            }
            else
            {
                var action = Assert.IsAssignableFrom<ChartAction>(Activator.CreateInstance(Assert.Single(types[symbol])));
                Assert.Equal(runtimeName, action.Type);
                Assert.Equal(
                    runtimeName,
                    OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json.GetProperty("type").GetString());
            }
        }
    }

    [Fact]
    public void ManualManagedMappingsResolveToCompiledMembers()
    {
        // Arrange
        using var overrides = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "coverage-overrides.json")));
        var types = typeof(EChartsRuntime).Assembly.GetTypes().ToLookup(t => t.Name);

        // Act & Assert
        foreach (var family in new[] { "instanceMethods", "globalMethods" })
            foreach (var mapping in overrides.RootElement.GetProperty(family).EnumerateArray())
            {
                if (family == "globalMethods" && mapping.GetProperty("owner").GetString() != "managed")
                    continue;

                var owner = family == "instanceMethods" ? "EChartInstance" : "EChartsRuntime";
                foreach (var symbol in mapping.GetProperty("symbol").GetString()!.Split('/'))
                {
                    var parts = symbol.Contains('.') ? symbol.Split('.', 2) : [owner, symbol];
                    Assert.True(
                        types[parts[0]].Any(t => t.GetMember(parts[1], BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static).Length > 0),
                        $"{mapping.GetProperty("recordId")}: missing compiled manual mapping {symbol}");
                }
            }
    }

    [Fact]
    public void AllGeneratedRecordsHaveCompiledMappings()
    {
        // Arrange
        using var manifest = Manifest();
        var types = typeof(ChartOptions).Assembly.GetTypes().ToLookup(t => t.Name);
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;
        var symbols = manifest.RootElement.GetProperty("symbols").EnumerateArray().Select(s => s.GetString()!).ToArray();

        // Act & Assert
        Assert.True(symbols.Length > 1000);
        foreach (var symbol in symbols)
        {
            var separator = symbol.IndexOf('.');
            var name = separator < 0 ? symbol : symbol[..separator];
            var candidates = types[name].ToArray();
            Assert.True(candidates.Length > 0, $"missing CLR type {name} for {symbol}");
            if (separator >= 0)
            {
                var member = symbol[(separator + 1)..];
                Assert.True(
                    candidates.Any(t => t.GetMembers(flags).Any(m => m.Name == member || m.Name.EndsWith('.' + member, StringComparison.Ordinal))),
                    $"missing compiled member {symbol}");
            }
        }

        foreach (var signature in manifest.RootElement.GetProperty("signatures").EnumerateArray())
        {
            var marker = Assert.Single(types[signature.GetProperty("symbol").GetString()!]);
            Assert.Contains(typeof(IJsFunctionSignature), marker.GetInterfaces());
            Assert.Equal(signature.GetProperty("typeId").GetString(), marker.GetProperty("Id", flags)!.GetValue(null));
        }
    }

    [Fact]
    public void GeneratedPropertiesHaveSerializationAndReaderFixtures()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var cases = PublicContractCases.Properties().ToArray();

        // Act & Assert
        Assert.True(cases.Length > 6000);
        foreach (var test in cases)
        {
            var prepared = OptionSerializer.Serialize(test.Value, context);
            using var expected = JsonDocument.Parse(test.Json);
            Assert.True(JsonElement.DeepEquals(expected.RootElement, prepared.Json.GetProperty(test.Key)), test.Id);
            Assert.Equal(test.Bindings, prepared.Bindings.Count);
            var read = test.Read(prepared.Json);
            Assert.True(read.IsAssigned(test.Key), test.Id);
            Assert.True(JsonElement.DeepEquals(prepared.Json, OptionSerializer.Serialize(read, context).Json), test.Id);
        }
    }

    [Fact]
    public void UnionAlternativesHaveSerializationFixtures()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var cases = PublicContractCases.Values().ToArray();

        // Act & Assert
        Assert.True(cases.Length > 650);
        foreach (var test in cases)
        {
            var options = new ChartOptions();
            options.AdditionalProperties["value"] = test.Value;
            var prepared = OptionSerializer.Serialize(options, context);
            using var expected = JsonDocument.Parse(test.Json);
            Assert.True(JsonElement.DeepEquals(expected.RootElement, prepared.Json.GetProperty("value")), test.Id);
            Assert.Equal(test.Bindings, prepared.Bindings.Count);
        }
    }
}
