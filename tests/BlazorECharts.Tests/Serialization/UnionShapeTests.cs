using BlazorECharts.Serialization;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class UnionShapeTests
{
    [Fact]
    public void OneOrMany_SingleElementArray_RemainsArray()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        var options = new FixtureOptions { Components = OneOrMany<FixtureNestedOptions>.Many(new FixtureNestedOptions { Show = true }) };

        // Act & Assert
        Assert.Equal("{\"components\":[{\"show\":true}]}", OptionSerializer.Serialize(options, context).Json.GetRawText());

        // Act
        options.Components = OneOrMany<FixtureNestedOptions>.One(new FixtureNestedOptions { Show = true });

        // Assert
        Assert.Equal("{\"components\":{\"show\":true}}", OptionSerializer.Serialize(options, context).Json.GetRawText());

        // Act
        options.Components = OneOrMany<FixtureNestedOptions>.Many();

        // Assert
        Assert.Equal("{\"components\":[]}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void OneOrMany_NullScalarAndNullArrayElementAreDistinct()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        var options = new FixtureOptions { Value = EChartsValue.From(OneOrMany<string?>.One(null)) };

        // Act & Assert
        Assert.Equal("{\"value\":null}", OptionSerializer.Serialize(options, context).Json.GetRawText());

        // Act
        options.Value = EChartsValue.From(OneOrMany<string?>.Many((string?)null));

        // Assert
        Assert.Equal("{\"value\":[null]}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void OneOrMany_UninitializedAssignedValue_ThrowsInsteadOfInventingZero()
    {
        // Arrange
        var options = new FixtureOptions { Value = EChartsValue.From(default(OneOrMany<int>)) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$.value", error.Path);
    }

    [Fact]
    public void Tuple_PreservesOrderAndArity()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureRange);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureRange(12.5m, -3m)) };

        // Act & Assert
        Assert.Equal("{\"value\":[12.5,-3]}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Theory]
    [InlineData(false, "false")]
    [InlineData(0, "0")]
    [InlineData("auto", "\"auto\"")]
    public void Union_PreservesAllLiteralAlternatives(object value, string expected)
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureHeader);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureHeader(value)) };

        // Act & Assert
        Assert.Equal("{\"value\":" + expected + "}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData(null)]
    public void Union_InvalidAlternative_IsRejectedWithPath(object? value)
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        context.Register(FixtureJsonContext.Default.FixtureHeader);
        var options = new FixtureOptions { Value = EChartsValue.From(new FixtureHeader(value)) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, context));

        // Assert
        Assert.Equal("$.value", error.Path);
        Assert.IsType<System.Text.Json.JsonException>(error.InnerException);
    }

    [Fact]
    public void DynamicData_PreservesNestedArraysObjectsAndNull()
    {
        // Arrange
        var options = new FixtureOptions
        {
            Value = EChartsValue.Object(new Dictionary<string, EChartsValue>
            {
                ["row"] = EChartsValue.Array(EChartsValue.From("name"), EChartsValue.From(0), default),
                ["flag"] = EChartsValue.From(false),
            }),
        };

        // Act & Assert
        Assert.Equal("{\"value\":{\"flag\":false,\"row\":[\"name\",0,null]}}",
            OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void DynamicData_NonFiniteNumbersAreRejected(double value)
    {
        // Arrange
        var options = new FixtureOptions { Value = EChartsValue.From(value) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$.value", error.Path);
    }

    [Fact]
    public void DynamicData_IntegerAndDecimalPrecisionIsNotReducedToDouble()
    {
        // Arrange
        var options = new FixtureOptions
        {
            Data = [EChartsValue.From(long.MinValue), EChartsValue.From(ulong.MaxValue), EChartsValue.From(12345678901234567890.12345678m)],
        };

        // Act & Assert
        Assert.Equal("{\"data\":[-9223372036854775808,18446744073709551615,12345678901234567890.12345678]}",
            OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());
    }

    [Fact]
    public void Single_WidensOnlyInTypedDoubleMembers()
    {
        // Arrange
        var options = new FixtureOptions { Data = [EChartsValue.From(36.6f)] };

        // Act & Assert
        Assert.Equal("{\"data\":[36.6]}", OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());

        // Arrange
        var chart = new BlazorECharts.Options.ChartOptions { Series = new BlazorECharts.Options.LineSeriesOption { Data = [36.6f] } };

        // Act & Assert
        Assert.Equal("{\"series\":{\"type\":\"line\",\"data\":[36.599998474121094]}}",
            OptionSerializer.Serialize(chart, OptionMetadata.CreateContext()).Json.GetRawText());
    }

    [Fact]
    public void DynamicData_CyclicArrayFailsWithAnActionablePath()
    {
        // Arrange
        var cycle = new object[1];
        cycle[0] = cycle;
        var options = new FixtureOptions { Value = EChartsValue.From(cycle) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.StartsWith("$.value[0]", error.Path);
        Assert.Contains("depth", error.Message, StringComparison.OrdinalIgnoreCase);
    }
}
