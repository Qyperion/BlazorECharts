using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class PayloadContractTests
{
    [Theory]
    [InlineData("highlight")]
    [InlineData("downplay")]
    [InlineData("consumerAction")]
    [InlineData("")]
    public void Payload_CompilesAndRoundTripsArbitraryStringTypeAndFullClosure(string actionType)
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        using var input = JsonDocument.Parse("""{"type":"placeholder","escapeConnect":false,"excludeSeriesId":[0,"s"],"animation":{"duration":0,"delay":0,"easing":"cubicInOut"},"batch":[{"animation":{"duration":0,"easing":"linear"},"excludeSeriesId":[],"seriesIndex":0,"dataIndex":0,"future":null}],"notBlur":false,"future":{"zero":0,"flag":false,"empty":[]}}""");

        // Act
        Payload payload = GeneratedOptionMetadata.ReadPayload(input.RootElement);
        payload.Type = actionType;

        // Assert
        HighlightPayloadAnimation animation = payload.Animation!;
        HighlightPayloadBatchItem item = Assert.Single(payload.Batch!)!;
        Assert.False(payload.EscapeConnect);
        Assert.Equal(0, animation.Duration);
        Assert.Equal(0, animation.Delay);
        Assert.True(payload.AdditionalProperties.ContainsKey("notBlur"));
        Assert.Null(typeof(Payload).GetProperty("NotBlur"));

        // Act
        var json = OptionSerializer.Serialize(payload, context).Json;

        // Assert
        Assert.Equal(actionType, json.GetProperty("type").GetString());
        Assert.Equal("cubicInOut", json.GetProperty("animation").GetProperty("easing").GetString());
        Assert.Equal(0, item.Animation!.Duration);
        Assert.Equal(0, json.GetProperty("excludeSeriesId")[0].GetDouble());
        Assert.Equal("s", json.GetProperty("excludeSeriesId")[1].GetString());
        Assert.Empty(json.GetProperty("batch")[0].GetProperty("excludeSeriesId").EnumerateArray());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("batch")[0].GetProperty("future").ValueKind);
        Assert.False(json.GetProperty("future").GetProperty("flag").GetBoolean());
        Assert.Empty(json.GetProperty("future").GetProperty("empty").EnumerateArray());
        Assert.Equal(json.GetRawText(), OptionSerializer.Serialize(GeneratedOptionMetadata.ReadPayload(json), context).Json.GetRawText());
        if (actionType == "highlight")
            Assert.Equal("highlight", GeneratedOptionMetadata.ReadHighlightAction(json).Type);

        if (actionType == "downplay")
            Assert.Equal("downplay", GeneratedOptionMetadata.ReadDownplayAction(json).Type);
    }

    [Fact]
    public void Payload_PreservesUnsetExplicitNullFalseZeroAndEmptyBatch()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act & Assert
        Assert.Equal("{}", OptionSerializer.Serialize(new Payload(), context).Json.GetRawText());

        // Arrange
        using var input = JsonDocument.Parse("""{"type":null,"escapeConnect":false,"animation":null,"batch":[],"excludeSeriesId":0,"unknown":""}""");

        // Act
        var payload = GeneratedOptionMetadata.ReadPayload(input.RootElement);

        // Assert
        Assert.Null(payload.Type);
        Assert.Null(payload.Animation);
        Assert.Empty(payload.Batch!);

        // Act
        var json = OptionSerializer.Serialize(payload, context).Json;

        // Assert
        Assert.Equal(JsonValueKind.Null, json.GetProperty("type").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("animation").ValueKind);
        Assert.False(json.GetProperty("escapeConnect").GetBoolean());
        Assert.Equal(0, json.GetProperty("excludeSeriesId").GetDouble());
        Assert.Equal("", json.GetProperty("unknown").GetString());
    }

    [Fact]
    public void Payload_EasingUsesExactTypedMarkerAndSeparateBindingPaths()
    {
        // Arrange
        var easing = JsFunction.Module<BlazorECharts.Values.Signatures.HighlightPayloadEasingSignature>("./easing.js", "ease");
        var payload = new Payload
        {
            Type = "consumerAction",
            Animation = new HighlightPayloadAnimation { Easing = easing },
            Batch = [new HighlightPayloadBatchItem { Animation = new HighlightPayloadAnimation { Easing = easing } }],
        };

        // Act
        var prepared = OptionSerializer.Serialize(payload, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal(2, prepared.Bindings.Count);
        Assert.Equal(new object[] { "animation", "easing" }, prepared.Bindings[0].Path);
        Assert.Equal(new object[] { "batch", 0, "animation", "easing" }, prepared.Bindings[1].Path);
        Assert.All(prepared.Bindings, b => Assert.Equal("type:0bf10d2c7793ad020bcea929", b.Signature));
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("animation").GetProperty("easing").ValueKind);
    }

    [Theory]
    [InlineData("""{"type":0}""", typeof(JsonException))]
    [InlineData("""{"animation":{"easing":"unknown"}}""", typeof(JsonException))]
    [InlineData("""{"animation":{"duration":"slow"}}""", typeof(JsonException))]
    [InlineData("""{"excludeSeriesId":false}""", typeof(JsonException))]
    [InlineData("""{"excludeSeriesId":[{}]}""", typeof(JsonException))]
    [InlineData("""{"batch":[{"animation":{"easing":false}}]}""", typeof(JsonException))]
    public void Payload_RejectsWrongShapesAndClosedNestedAlternatives(string value, Type exceptionType)
    {
        // Arrange
        using var input = JsonDocument.Parse(value);

        // Act & Assert
        Assert.Throws(exceptionType, () => GeneratedOptionMetadata.ReadPayload(input.RootElement));
    }
}
