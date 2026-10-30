using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;

namespace BlazorECharts.Tests.Api;

public class FunctionBindingCoverageTests
{
    private static JsFunction<T> Restore<T>(JsBinding? binding) where T : IJsFunctionSignature
        => JsFunction.FromBinding<T>(binding!);

    private static PreparedOption Prepare(JsFunction function, bool allowInline = false)
    {
        var options = new ChartOptions();
        options.AdditionalProperties["callback"] = EChartsValue.From(function);
        var context = new EChartsSerializationContext { AllowInlineJavaScript = allowInline };
        GeneratedOptionMetadata.Register(context);
        return OptionSerializer.Serialize(options, context);
    }

    [Fact]
    public void ExplicitModuleBinding_RestoresTheSameTypedDescriptor()
    {
        // Arrange
        var original = JsFunction.Module<CustomRenderItemSignature>("./callbacks.js", "render");

        // Act
        var binding = Assert.Single(Prepare(original).Bindings);
        var restored = Restore<CustomRenderItemSignature>(binding);

        // Assert
        Assert.Equal(original.Kind, restored.Kind);
        Assert.Equal(original.Signature, restored.Signature);
        Assert.Equal(original.ModuleUrl, restored.ModuleUrl);
        Assert.Equal(original.ExportName, restored.ExportName);
        Assert.Equal(binding.Path, Assert.Single(Prepare(restored).Bindings).Path);
    }

    [Fact]
    public void RestoredInlineBinding_StillRequiresSerializationOptIn()
    {
        // Arrange
        var original = JsFunction.Inline<CustomRenderItemSignature>("value => value + 1");

        // Act
        var restored = Restore<CustomRenderItemSignature>(Assert.Single(Prepare(original, true).Bindings));

        // Assert
        Assert.Equal(original.Source, restored.Source);
        Assert.Throws<OptionSerializationException>(() => Prepare(restored));
        Assert.Single(Prepare(restored, true).Bindings);
    }

    [Fact]
    public void BindingReader_RejectsWrongNominalSignatureAndNull()
    {
        // Arrange
        var binding = Assert.Single(Prepare(JsFunction.Module<CustomRenderItemSignature>("./callbacks.js", "render")).Bindings);

        // Act & Assert
        Assert.Throws<ArgumentException>(() => Restore<TooltipFormatterSignature>(binding));
        Assert.Throws<ArgumentNullException>(() => Restore<CustomRenderItemSignature>(null));
    }

    [Fact]
    public async Task ObjectBinding_IsRejectedWithoutRetainingOrDisposingItsReference()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "test");
        await using var reference = registry.Register(new Resource());
        var options = new ChartOptions();
        options.AdditionalProperties["native"] = EChartsValue.From(reference);
        var context = new EChartsSerializationContext { ReferenceRuntimeId = "page" };
        GeneratedOptionMetadata.Register(context);
        var binding = Assert.Single(OptionSerializer.Serialize(options, context).Bindings);

        // Act & Assert
        Assert.Throws<ArgumentException>(() => Restore<CustomRenderItemSignature>(binding));
        Assert.False(reference.IsDisposed);
        Assert.Equal(1, registry.LeaseCount);
    }

    private sealed class Resource : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
