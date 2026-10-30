using System.Globalization;
using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class CustomDataRegistrationTests
{
    private static readonly FixtureData Data = new("sample", 1234.5m, new DateTimeOffset(2026, 10, 16, 12, 30, 0, TimeSpan.Zero));

    [Fact]
    public void CustomData_UsesRegisteredJsonTypeInfo()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureData);
        var options = new FixtureOptions { Data = [EChartsValue.From(Data)] };

        // Act & Assert
        Assert.Equal("{\"data\":[{\"label\":\"sample\",\"value\":1234.5,\"at\":\"2026-10-16T12:30:00\\u002B00:00\"}]}",
            OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void CustomData_MissingMetadata_ThrowsWithoutReflectionFallback()
    {
        // Arrange
        var options = new FixtureOptions { Nested = new FixtureNestedOptions { Data = EChartsValue.Array(EChartsValue.From(Data)) } };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$.nested.data[0]", error.Path);
        Assert.Equal(typeof(FixtureData), error.ClrType);
        Assert.Contains(typeof(FixtureData).FullName!, error.Message);
        Assert.Contains("JsonTypeInfo", error.Message);
        Assert.Contains(error.Path, error.Message);
    }

    [Fact]
    public void CustomData_ErrorPathEscapesUnknownPropertyNames()
    {
        // Arrange
        var options = new FixtureOptions();
        options.AdditionalProperties["a.b\"c"] = EChartsValue.From(Data);

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$[\"a.b\\u0022c\"]", error.Path);
    }

    [Fact]
    public void OptionRegistry_DispatchesConcreteExtensionThroughBaseProperty()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(new OptionTypeRegistration<FixtureExtensionOptions>((writer, value, ctx, path) =>
        {
            ctx.WriteProperty(writer, value, "show", value.Show, path);
            ctx.WriteProperty(writer, value, "extension", value.Extension, path);
        }));
        var options = new FixtureOptions { Nested = new FixtureExtensionOptions { Show = false, Extension = "consumer" } };

        // Act & Assert
        Assert.Equal("{\"nested\":{\"show\":false,\"extension\":\"consumer\"}}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void OptionRegistry_UnregisteredDerivedTypeDoesNotLoseFieldsUsingBaseWriter()
    {
        // Arrange
        var options = new FixtureOptions { Nested = new FixtureExtensionOptions { Extension = "consumer" } };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$.nested", error.Path);
        Assert.Equal(typeof(FixtureExtensionOptions), error.ClrType);
        Assert.Contains("OptionTypeRegistration", error.Message);
    }

    [Fact]
    public void CustomData_RegistrationIsLocalToContext()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureData);
        var options = new FixtureOptions { Value = EChartsValue.From(Data) };

        // Act & Assert
        Assert.Equal("sample", OptionSerializer.Serialize(options, context).Json.GetProperty("value").GetProperty("label").GetString());

        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));
    }

    [Fact]
    public void CustomData_ArrayRegistrationIncludesItsElementContracts()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureDataArray);
        var options = new FixtureOptions { Value = EChartsValue.From(new[] { Data }) };

        // Act & Assert
        Assert.Equal("{\"value\":[{\"label\":\"sample\",\"value\":1234.5,\"at\":\"2026-10-16T12:30:00\\u002B00:00\"}]}",
            OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void CustomData_RegisteredArrayConverterIsHonored()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        var metadata = new FixtureJsonContext(new JsonSerializerOptions { Converters = { new FixtureDataArrayConverter() } });
        context.Register(metadata.FixtureDataArray);
        var options = new FixtureOptions { Value = EChartsValue.From(new[] { Data }) };

        // Act & Assert
        Assert.Equal("{\"value\":[\"sample\"]}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void CustomData_NestedEChartsValueWithoutConverterFailsInsteadOfLosingData()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureWrappedValue);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureWrappedValue(EChartsValue.From(0))) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, context));

        // Assert
        Assert.Equal("$.value", error.Path);
        Assert.Equal(typeof(EChartsValue), error.ClrType);
        Assert.Contains("converter", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void CustomData_NestedOneOrManyWithoutConverterFailsInsteadOfLosingShape(bool initialized)
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureWrappedItems);
        var items = initialized ? OneOrMany<int>.Many(1) : default;
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureWrappedItems(items)) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, context));

        // Assert
        Assert.Equal("$.value", error.Path);
        Assert.Equal(typeof(OneOrMany<int>), error.ClrType);
    }

    [Fact]
    public void CustomData_NestedOptionWithoutConverterFailsInsteadOfLosingPresence()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureWrappedOptions);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureWrappedOptions(new FixtureNestedOptions { Show = false })) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, context));

        // Assert
        Assert.Equal("$.value", error.Path);
        Assert.Equal(typeof(FixtureNestedOptions), error.ClrType);
    }

    [Fact]
    public void CustomData_ExplicitNestedValueConverterIsHonored()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureConvertedValue);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureConvertedValue(EChartsValue.From(0))) };

        // Act & Assert
        Assert.Equal("{\"value\":{\"value\":0}}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void CustomData_MetadataModeKeepsClrPathInInnerException()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureMetadataOnlyContext.Default.FixtureWrappedValue);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureWrappedValue(EChartsValue.From(0))) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, context));

        // Assert
        Assert.Equal("$.value", error.Path);
        Assert.Equal(typeof(EChartsValue), error.ClrType);
        Assert.Equal("$.Value", Assert.IsAssignableFrom<JsonException>(error.InnerException).Path);
    }

    [Fact]
    public void Serialize_UkrainianAndInvariantCultures_ProduceIdenticalNumbers()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureData);
        var options = new FixtureOptions { Z = 1234.5m, Data = [EChartsValue.From(Data), EChartsValue.From(0.125d), EChartsValue.From("12,5")] };
        var original = CultureInfo.CurrentCulture;
        try
        {
            // Act
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("uk-UA");
            var ukrainian = OptionSerializer.Serialize(options, context).Json.GetRawText();
            CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
            var invariant = OptionSerializer.Serialize(options, context).Json.GetRawText();

            // Assert
            Assert.Equal(invariant, ukrainian);
            Assert.Equal(
                "{\"z\":1234.5,\"data\":[{\"label\":\"sample\",\"value\":1234.5,\"at\":\"2026-10-16T12:30:00\\u002B00:00\"},0.125,\"12,5\"]}",
                invariant);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
