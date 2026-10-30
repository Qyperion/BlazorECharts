using System.Text.Json;
using BlazorECharts.Runtime;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class ErrorCodeTests
{
    [Fact]
    public void LibraryFailures_UseTheBrowserCodeFormat()
    {
        // Arrange
        using var text = JsonDocument.Parse("\"none\"");

        // Act
        var conversion = Assert.Throws<InvalidOperationException>(() => new ChartPixelValue(text.RootElement));
        var layout = Assert.Throws<InvalidOperationException>(() => new ChartCoordinateLayout(text.RootElement));
        var action = Assert.Throws<InvalidOperationException>(() => new ChartActionResult(text.RootElement));
        using var empty = JsonDocument.Parse("null");
        var visual = Assert.Throws<InvalidOperationException>(() => new ChartVisual(empty.RootElement));

        // Assert
        Assert.StartsWith("[CoordinateConversionUnavailable] ", conversion.Message);
        Assert.StartsWith("[CoordinateConversionUnavailable] ", layout.Message);
        Assert.StartsWith("[ActionMappingUnavailable] ", action.Message);
        Assert.StartsWith("[VisualUnavailable] ", visual.Message);
    }

    [Fact]
    public void DetailCode_IsTheCodeOfTheFirstCodedException()
    {
        // Act & Assert
        Assert.Equal("ChartElementInUse", EChartsError.CodeOf(new JSException("[ChartElementInUse] The element hosts another chart.\nat stack")));
        Assert.Equal(
            "RuntimeLoadFailed",
            EChartsError.CodeOf(new AggregateException(new JSException("[RuntimeLoadFailed] offline"), new InvalidOperationException("cleanup"))));
        Assert.Equal(
            "VisualUnavailable",
            EChartsError.CodeOf(new InvalidOperationException("wrapper", new InvalidOperationException("[VisualUnavailable] none"))));
        Assert.Null(EChartsError.CodeOf(new JSException("offline")));
        Assert.Null(EChartsError.CodeOf(new JSException("[not a code] text")));
        Assert.Null(EChartsError.CodeOf(null));
    }
}
