using BlazorECharts.Options;
using BlazorECharts.Serialization;
using Xunit;

namespace BlazorECharts.Tests.Api;

/// <summary>Selector and index fields of actions take a value or an array of values.</summary>
public sealed class EventActionValueArrayTests
{
    [Fact]
    public void Arrays_ConvertToSelectorsAndIndices()
    {
        // Act
        var action = new HighlightAction { SeriesId = new[] { "a", "b" }, DataIndex = new double[] { 1, 2 } };
        var json = OptionSerializer.Serialize(action, OptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("""["a","b"]""", json.GetProperty("seriesId").GetRawText());
        Assert.Equal("[1,2]", json.GetProperty("dataIndex").GetRawText());
        Assert.True(action.SeriesId!.Value.TryGetStrings(out var ids));
        Assert.Equal(["a", "b"], ids);
        Assert.False(action.DataIndex!.Value.TryGetStrings(out _));
    }
}
