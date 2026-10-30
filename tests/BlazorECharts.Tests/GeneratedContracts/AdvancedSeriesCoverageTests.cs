using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class AdvancedSeriesCoverageTests
{
    internal static JsonElement Json(OptionObject options) =>
        OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json;

    [Fact]
    public void CustomRenderItem_AcceptsARegisteredSeriesNameOrAFunction()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act
        var named = OptionSerializer.Serialize(new CustomSeriesOption { RenderItem = "registered-bars" }, context);

        // Assert
        Assert.Equal("registered-bars", named.Json.GetProperty("renderItem").GetString());
        Assert.Empty(named.Bindings);

        // Act
        var read = GeneratedOptionMetadata.ReadCustomSeriesOption(named.Json);

        // Assert
        Assert.True(JsonElement.DeepEquals(named.Json, OptionSerializer.Serialize(read, context).Json));

        // Act
        var function = OptionSerializer.Serialize(
            new CustomSeriesOption { RenderItem = JsFunction.Module<CustomRenderItemSignature>("./render.js", "render") },
            context);

        // Assert
        Assert.Equal(JsonValueKind.Null, function.Json.GetProperty("renderItem").ValueKind);
        Assert.Equal("renderItem", Assert.Single(function.Bindings).Path[0].ToString());
    }
}
