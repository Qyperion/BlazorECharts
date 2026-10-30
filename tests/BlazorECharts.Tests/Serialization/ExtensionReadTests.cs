using System.Reflection;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class ExtensionReadTests
{
    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    [Fact]
    public void Read_CoreModel_UsesTheRegisteredReader()
    {
        // Act
        var tooltip = OptionMetadata.CreateContext().Read<SeriesTooltipOption>(Json("""{"confine":true,"vendorFlag":1}"""));

        // Assert
        Assert.True(tooltip.Confine);
        Assert.True(tooltip.AdditionalProperties["vendorFlag"].TryGetJson(out var flag));
        Assert.Equal(1, flag.GetDouble());
    }

    [Fact]
    public void Read_ExtensionModel_ReadsNestedCoreModelsAndUnionsThroughPublicContracts()
    {
        // Arrange
        var context = OptionMetadata.CreateContext();
        context.Register(new OptionTypeRegistration<ConsumerBadge>(
            (writer, value, ctx, path) =>
            {
                ctx.WriteProperty(writer, value, "tooltip", value.Tooltip, path);
                ctx.WriteProperty(writer, value, "id", value.Id, path);
            },
            (json, ctx) => new ConsumerBadge
            {
                Tooltip = ctx.Read<SeriesTooltipOption>(json.GetProperty("tooltip")),
                Id = ReadValue<NumberOrString>(json.GetProperty("id")),
            }));

        // Act
        var badge = context.Read<ConsumerBadge>(Json("""{"tooltip":{"confine":true},"id":7}"""));

        // Assert
        Assert.True(badge.Tooltip!.Confine);
        Assert.True(badge.Id!.Value.TryGet(out double id));
        Assert.Equal(7, id);
        Assert.Equal("""{"tooltip":{"confine":true},"id":7}""", OptionSerializer.Serialize(badge, context).Json.GetRawText());
    }

    [Fact]
    public void Read_TypeWithoutReader_IsAConfigurationError()
    {
        // Arrange
        var context = OptionMetadata.CreateContext();
        context.Register(new OptionTypeRegistration<ConsumerBadge>((_, _, _, _) => { }));

        // Act & Assert
        var writeOnly = Assert.Throws<InvalidOperationException>(() => context.Read<ConsumerBadge>(Json("{}")));
        Assert.Contains(typeof(ConsumerBadge).FullName!, writeOnly.Message, StringComparison.Ordinal);
        var unregistered = Assert.Throws<InvalidOperationException>(() => new EChartsSerializationContext().Read<SeriesTooltipOption>(Json("{}")));
        Assert.Contains(nameof(SeriesTooltipOption), unregistered.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void GeneratedReaders_AreNotPublicApi()
    {
        // Act
        var metadata = typeof(OptionMetadata).Assembly.GetType("BlazorECharts.Serialization.Generated.GeneratedOptionMetadata", throwOnError: true)!;

        // Assert
        Assert.False(metadata.IsPublic);
        Assert.DoesNotContain(typeof(OptionMetadata).Assembly.GetExportedTypes(), type => type.Namespace == "BlazorECharts.Serialization.Generated");
        Assert.Null(typeof(IReadableOptionValue<>).GetCustomAttribute<System.ComponentModel.EditorBrowsableAttribute>());
    }

    private static T ReadValue<T>(JsonElement json) where T : struct, IReadableOptionValue<T> => T.Read(json);

    private sealed class ConsumerBadge : OptionObject
    {
        private SeriesTooltipOption? _tooltip;
        private NumberOrString? _id;

        public SeriesTooltipOption? Tooltip { get => _tooltip; set => SetProperty(ref _tooltip, value, "tooltip"); }
        public NumberOrString? Id { get => _id; set => SetProperty(ref _id, value, "id"); }
    }
}
