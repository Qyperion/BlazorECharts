using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class CoordinateUsageFixtures
{
    [Fact]
    public void Coordinates_PreserveTimeLogAndMultipleAxes()
    {
        // Arrange
        var options = ComponentOptionFixtures.Coordinates();
        options.AdditionalProperties["customData"] = BlazorECharts.Values.EChartsValue.FromJson(
            ComponentOptionFixtures.Parse("""{"future":[null,false,0,[]]}"""));

        // Act
        var json = OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("time", json.GetProperty("xAxis")[0].GetProperty("type").GetString());
        Assert.Equal("2026-10-17T00:00:00.000Z", json.GetProperty("xAxis")[0].GetProperty("min").GetString());
        Assert.Equal("log", json.GetProperty("yAxis")[0].GetProperty("type").GetString());
        Assert.Equal("right", json.GetProperty("xAxis")[1].GetProperty("gridId").GetString());
        Assert.Equal("time", json.GetProperty("series")[0].GetProperty("xAxisId").GetString());
        Assert.Equal("when", json.GetProperty("series")[0].GetProperty("encode").GetProperty("x").GetString());
        Assert.True(
            System.Text.Json.JsonElement.DeepEquals(
                json,
                OptionSerializer.Serialize(GeneratedOptionMetadata.ReadChartOptions(json), GeneratedOptionMetadata.CreateContext()).Json));
    }

    [Theory]
    [InlineData("polar")]
    [InlineData("calendar")]
    [InlineData("single")]
    [InlineData("parallel")]
    [InlineData("radar")]
    [InlineData("matrix")]
    [InlineData("geo")]
    public void CoordinateCatalog_RoundTripsThroughGeneratedContracts(string coordinate)
    {
        // Arrange
        var options = ComponentOptionFixtures.CoordinateCatalog(coordinate);

        // Act
        var json = OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.True(json.TryGetProperty(coordinate == "single" ? "singleAxis" : coordinate, out _));
        Assert.True(
            System.Text.Json.JsonElement.DeepEquals(
                json,
                OptionSerializer.Serialize(GeneratedOptionMetadata.ReadChartOptions(json), GeneratedOptionMetadata.CreateContext()).Json));
    }
}
