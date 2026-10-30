using System.Text.Json;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class BindingDescriptorTests
{
    [Fact]
    public void Binding_JavaScriptLookingString_DoesNotCreateDescriptor()
    {
        // Arrange
        var options = new FixtureOptions { Text = "function () { throw 'never'; }" };
        options.AdditionalProperties["__jsFunction"] = EChartsValue.From("eval('never')");

        // Act
        var prepared = OptionSerializer.Serialize(options, FixtureOptions.CreateContext());

        // Assert
        Assert.Empty(prepared.Bindings);
        Assert.Equal(options.Text, prepared.Json.GetProperty("text").GetString());

        // Arrange
        using var raw = JsonDocument.Parse("{\"kind\":\"inline\",\"source\":\"throw 'never'\"}");

        // Act & Assert
        Assert.Empty(OptionSerializer.Serialize(raw.RootElement, FixtureOptions.CreateContext()).Bindings);
    }

    [Fact]
    public void Binding_ArrayAndEscapedPropertyPath_IsExact()
    {
        // Arrange
        var options = new FixtureOptions
        {
            Data =
            [
                EChartsValue.Object(new Dictionary<string, EChartsValue>
                {
                    ["a.b\"\\"] = EChartsValue.From(JsFunction.Module<FixtureFormatter>("./format.js", "format")),
                    ["0"] = EChartsValue.From(JsFunction.Module<FixtureFormatter>("./format.js", "other")),
                }),
            ],
        };

        // Act
        var prepared = OptionSerializer.Serialize(options, FixtureOptions.CreateContext());
        using var wire = JsonDocument.Parse(JsonSerializer.Serialize(prepared, FixtureJsonContext.Default.PreparedOption));
        var paths = wire.RootElement.GetProperty("bindings").EnumerateArray().Select(x => x.GetProperty("path").GetRawText()).ToArray();

        // Assert
        Assert.Equal(["[\"data\",0,\"0\"]", "[\"data\",0,\"a.b\\u0022\\\\\"]"], paths);
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("data")[0].GetProperty("a.b\"\\").ValueKind);
        Assert.Equal("./format.js", prepared.Bindings[1].ModuleUrl);
    }

    [Fact]
    public void Binding_ModuleAndInline_KeepSignatureAndDescriptorKind()
    {
        // Arrange
        var context = CreateContext(allowInline: true);

        // Act
        var prepared = OptionSerializer.Serialize(new FixtureOptions
        {
            Data =
            [
                EChartsValue.From(JsFunction.Module<FixtureFormatter>("./format.js", "default")),
                EChartsValue.From(JsFunction.Inline<FixtureRenderItem>("() => { throw 'not executed'; }")),
            ],
        }, context);

        // Assert
        Assert.Collection(prepared.Bindings,
            module =>
            {
                Assert.Equal(JsBindingKind.Module, module.Kind);
                Assert.Equal("fixture:formatter", module.Signature);
                Assert.Equal("default", module.ExportName);
                Assert.Null(module.Source);
            },
            inline =>
            {
                Assert.Equal(JsBindingKind.Inline, inline.Kind);
                Assert.Equal("fixture:renderItem", inline.Signature);
                Assert.Contains("not executed", inline.Source);
                Assert.Null(inline.ModuleUrl);
            });
        Assert.NotEqual(prepared.Bindings[0].Token, prepared.Bindings[1].Token);
        Assert.Equal("{\"data\":[null,null]}", prepared.Json.GetRawText());
        Assert.Throws<NotSupportedException>(() => ((IList<JsBinding>)prepared.Bindings).Clear());
        Assert.Empty(OptionSerializer.Serialize(new FixtureOptions(), context).Bindings);
    }

    [Fact]
    public void Inline_DisabledByDefault_RejectsExplicitDescriptorWithPath()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        var options = new FixtureOptions { Data = [EChartsValue.From(JsFunction.Inline<FixtureFormatter>("() => 1"))] };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, context));

        // Assert
        Assert.Equal("$.data[0]", error.Path);
        Assert.Contains("AllowInlineJavaScript", error.Message);
        Assert.Contains("Module", error.Message);
        Assert.Empty(OptionSerializer.Serialize(new FixtureOptions(), context).Bindings);
    }

    [Fact]
    public async Task Reference_RuntimeMismatchAndDisposedToken_Reject()
    {
        // Arrange
        var registry = new ReferenceRegistry("page-a", "owner-a");
        var reference = registry.Register(new FixtureReferenceOwner(), ReferenceOwnership.Borrowed);
        var options = new FixtureOptions { Value = EChartsValue.From(reference) };

        // Act & Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));
        var mismatch = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, CreateContext(runtimeId: "page-b")));
        Assert.Equal("$.value", mismatch.Path);

        // Act
        var prepared = OptionSerializer.Serialize(options, CreateContext(runtimeId: "page-a"));

        // Assert
        var binding = Assert.Single(prepared.Bindings);
        Assert.Equal(JsBindingKind.Object, binding.Kind);
        Assert.Equal(reference.Token, binding.Token);
        Assert.Equal("page-a", binding.RuntimeId);
        Assert.Equal("owner-a", binding.OwnerId);
        Assert.Null(binding.Signature);
        Assert.Equal("{\"value\":null}", prepared.Json.GetRawText());

        // Act
        await reference.DisposeAsync();

        // Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, CreateContext(runtimeId: "page-a")));
    }

    [Fact]
    public void PreparedOption_OrdinaryJsonMatchesStep05()
    {
        // Act
        var prepared = OptionSerializer.Serialize(
            new FixtureOptions { Text = null, Animation = false, Z = 0, Data = [], Nested = new FixtureNestedOptions() },
            FixtureOptions.CreateContext());

        // Assert
        Assert.Equal("{\"text\":null,\"animation\":false,\"z\":0,\"data\":[],\"nested\":{}}", prepared.Json.GetRawText());
        Assert.Empty(prepared.Bindings);
    }

    [Fact]
    public async Task Binding_WireSchemaMatchesSharedJavaScriptFixture_WithoutAcquiringLeases()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "consumer");
        await using var reference = registry.Register("object:42", new FixtureReferenceOwner());
        var options = new FixtureOptions
        {
            Data =
            [
                EChartsValue.From(JsFunction.Module<FixtureFormatter>("./format.js", "format")),
                EChartsValue.From(JsFunction.Inline<FixtureRenderItem>("() => 42")),
                EChartsValue.From(reference),
            ],
        };

        // Act
        var prepared = OptionSerializer.Serialize(options, CreateContext(true, "page"));
        var actual = JsonSerializer.SerializeToElement(prepared, FixtureJsonContext.Default.PreparedOption);
        using var expected = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Fixtures/prepared-option.json")));

        // Assert
        Assert.True(JsonElement.DeepEquals(expected.RootElement, actual), actual.GetRawText());
        Assert.Equal(1, registry.LeaseCount);
    }

    [Fact]
    public void Binding_OneOrManyAndTypedSetter_PreserveStructuredPath()
    {
        // Arrange
        var nested = new FixtureNestedOptions();
        nested.AdditionalProperties["formatter"] = EChartsValue.From(JsFunction.Module<FixtureFormatter>("./f.js", "format"));
        var options = new FixtureOptions { Components = OneOrMany<FixtureNestedOptions>.Many(nested) };

        // Act
        var binding = Assert.Single(OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Bindings);

        // Assert
        Assert.Equal(new object[] { "components", 0, "formatter" }, binding.Path);
    }

    [Fact]
    public void Binding_ConfiguredContext_CanPrepareConcurrentIndependentPayloads()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();

        // Act & Assert
        Parallel.For(0, 32, index =>
        {
            var options = new FixtureOptions { Data = [EChartsValue.From(JsFunction.Module<FixtureFormatter>("./f.js", "f" + index))] };
            var binding = Assert.Single(OptionSerializer.Serialize(options, context).Bindings);
            Assert.Equal("f" + index, binding.ExportName);
            Assert.Equal(new object[] { "data", 0 }, binding.Path);
        });
    }

    [Fact]
    public async Task Binding_OpaqueCustomMetadata_CannotSilentlySerializeNativeDescriptors()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureOpaqueBindings);
        var registry = new ReferenceRegistry("page", "owner");
        await using var reference = registry.Register(new FixtureReferenceOwner());

        // Act & Assert
        foreach (var opaque in new[]
        {
            new FixtureOpaqueBindings { Function = JsFunction.Module<FixtureFormatter>("./f.js", "f") },
            new FixtureOpaqueBindings { Reference = reference },
        })
        {
            var error = Assert.Throws<OptionSerializationException>(
                () => OptionSerializer.Serialize(new FixtureOptions { Value = EChartsValue.From(opaque) }, context));
            Assert.Equal("$.value", error.Path);
            Assert.NotNull(error.InnerException);
        }
    }

    [Theory]
    [InlineData("", "export")]
    [InlineData("module.js", "")]
    public void Module_MissingIdentity_Rejects(string module, string export) =>
        Assert.Throws<ArgumentException>(() => JsFunction.Module<FixtureFormatter>(module, export));

    private static EChartsSerializationContext CreateContext(bool allowInline = false, string? runtimeId = null)
    {
        var context = new EChartsSerializationContext { AllowInlineJavaScript = allowInline, ReferenceRuntimeId = runtimeId };
        context.Register(new OptionTypeRegistration<FixtureOptions>((w, v, c, p) =>
        {
            c.WriteProperty(w, v, "data", v.Data, p);
            c.WriteProperty(w, v, "value", v.Value, p);
        }));
        return context;
    }
}
