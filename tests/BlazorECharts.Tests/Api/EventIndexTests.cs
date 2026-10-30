using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Options;
using Xunit;

namespace BlazorECharts.Tests.Api;

/// <summary>Indices in event payloads are integers; generated models are sealed.</summary>
public sealed class EventIndexTests
{
    [Fact]
    public void EventIndices_AreIntegers()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"click","componentIndex":0,"seriesIndex":1,"dataIndex":2}""");

        // Act
        var click = new ClickEvent(json.RootElement);
        int? series = click.SeriesIndex;
        int? data = click.DataIndex;

        // Assert
        Assert.Equal(1, series);
        Assert.Equal(2, data);
        Assert.Equal(0, click.ComponentIndex);
    }

    [Fact]
    public void NestedEventIndices_AreIntegers()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"brushselected","batch":[{"brushIndex":0,"selected":[{"seriesIndex":1,"dataIndex":[2,3]}]}]}""");

        // Act
        var item = new BrushSelectedEvent(json.RootElement).Batch![0];

        // Assert
        int? brush = item.BrushIndex;
        Assert.Equal(0, brush);
        int[] data = item.Selected![0].DataIndex!;
        Assert.Equal([2, 3], data);
    }

    [Fact]
    public void GeneratedModels_AreSealed()
    {
        // Act & Assert
        Assert.True(typeof(XAxisCategoryOption).IsSealed);
        Assert.True(typeof(TitleOption).IsSealed);
        Assert.True(typeof(BarSeriesOption).IsSealed);
        Assert.False(typeof(SeriesOption).IsSealed);
    }
}
