using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class NonFiniteNumberTests
{
    [Theory]
    [InlineData(double.NaN, "NaN")]
    [InlineData(double.PositiveInfinity, "Infinity")]
    [InlineData(double.NegativeInfinity, "-Infinity")]
    public void NonFiniteData_NamesThePathAndTheMissingValueForm(double value, string name)
    {
        // Arrange
        var options = new ChartOptions { Series = new LineSeriesOption { Data = [1d, value] } };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, OptionMetadata.CreateContext()));

        // Assert
        Assert.Equal("$.series.data[1]", error.Path);
        Assert.Contains(name, error.Message, StringComparison.Ordinal);
        Assert.Contains("use null or \"-\" for a missing value", error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("JsonNumberHandling", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void NonFiniteSingle_NamesThePath()
    {
        // Arrange
        var options = new ChartOptions();
        options.AdditionalProperties["ratio"] = EChartsValue.From(float.NaN);

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, OptionMetadata.CreateContext()));

        // Assert
        Assert.Equal("$.ratio", error.Path);
        Assert.Contains("use null or \"-\" for a missing value", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void EventActionValue_NonFinite_NamesTheArgument()
    {
        // Act & Assert
        var single = Assert.Throws<ArgumentOutOfRangeException>(() => EventActionValue.From(double.NaN));
        Assert.Equal("value", single.ParamName);
        Assert.Contains("use null or \"-\" for a missing value", single.Message, StringComparison.Ordinal);
        var array = Assert.Throws<ArgumentOutOfRangeException>(() => EventActionValue.From([1d, double.PositiveInfinity]));
        Assert.Contains("values[1]", array.Message, StringComparison.Ordinal);
        var matrix = Assert.Throws<ArgumentOutOfRangeException>(() => EventActionValue.From([[1d], [2d, double.NegativeInfinity]]));
        Assert.Contains("values[1][1]", matrix.Message, StringComparison.Ordinal);
    }

    public static TheoryData<object, string> MethodOptions => new()
    {
        { new ChartLoadingOptions { FontSize = double.NaN }, "fontSize" },
        { new ChartLoadingOptions { SpinnerRadius = double.PositiveInfinity }, "spinnerRadius" },
        { new ChartLoadingOptions { LineWidth = double.NegativeInfinity }, "lineWidth" },
        { new ChartLoadingOptions { Zlevel = double.NaN }, "zlevel" },
        { new ChartCanvasExportOptions { PixelRatio = double.NaN }, "pixelRatio" },
        { new ChartDataUrlOptions { PixelRatio = double.PositiveInfinity }, "pixelRatio" },
        { new ChartConnectedDataUrlOptions { PixelRatio = double.NaN }, "pixelRatio" },
    };

    [Theory]
    [MemberData(nameof(MethodOptions))]
    public void NonFiniteMethodOption_NamesTheMemberPath(object options, string member)
    {
        // Act
        var error = Assert.Throws<OptionSerializationException>(
            () => MethodJson.Create(w => OptionMetadata.CreateContext().WriteValue(w, options, "$.args[0]")));

        // Assert
        Assert.Equal("$.args[0]." + member, error.Path);
        Assert.Contains("use null to omit the option", error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("AllowNamedFloatingPointLiterals", error.Message, StringComparison.Ordinal);
    }
}
