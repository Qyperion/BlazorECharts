using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;

namespace BlazorECharts.Tests.Api;

public class GraphicOptionCoverageTests
{
    [Fact]
    public void GeometryFactories_CompileAndRoundTripExactShapes()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act
        var json = OptionSerializer.Serialize(GraphicGeometryFixtures.Create(), context).Json;

        // Assert
        var elements = json.GetProperty("graphic").EnumerateArray().ToArray();
        Assert.Equal(10, elements.Length);
        Assert.Equal(10, elements.Select(e => e.GetProperty("type").GetString()).Distinct().Count());
        var arc = elements.Single(e => e.GetProperty("type").GetString() == "arc");
        Assert.False(arc.GetProperty("shape").GetProperty("clockwise").GetBoolean());
        Assert.Equal(30, arc.GetProperty("shape").GetProperty("r").GetDouble());

        // Act
        var read = GeneratedOptionMetadata.ReadGraphicArcOption(arc);

        // Assert
        Assert.Equal(30, read.Shape!.R);
        Assert.True(JsonElement.DeepEquals(arc, OptionSerializer.Serialize(read, context).Json));
        Assert.True(JsonElement.DeepEquals(json, OptionSerializer.Serialize(GeneratedOptionMetadata.ReadChartOptions(json), context).Json));
    }

    [Fact]
    public void GraphicArc_PreservesPresenceAndRejectsOtherDiscriminator()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var option = new GraphicArcOption { Shape = new() { Cx = 0, Clockwise = false, R = null } };

        // Act
        var json = OptionSerializer.Serialize(option, context).Json;

        // Assert
        Assert.Equal("arc", json.GetProperty("type").GetString());
        var shape = json.GetProperty("shape");
        Assert.Equal(0, shape.GetProperty("cx").GetDouble());
        Assert.False(shape.GetProperty("clockwise").GetBoolean());
        Assert.Equal(JsonValueKind.Null, shape.GetProperty("r").ValueKind);
        Assert.False(shape.TryGetProperty("cy", out _));

        // Arrange
        using var wrong = JsonDocument.Parse("{\"type\":\"rect\"}");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadGraphicArcOption(wrong.RootElement));
    }

    [Fact]
    public void GraphicArc_ReaderPreservesAbsentDiscriminatorForPatches()
    {
        // Arrange
        using var source = JsonDocument.Parse("{\"id\":\"existing\",\"shape\":{\"r\":20}}");

        // Act
        var read = GeneratedOptionMetadata.ReadGraphicArcOption(source.RootElement);

        // Assert
        Assert.False(read.IsAssigned("type"));
        Assert.True(JsonElement.DeepEquals(source.RootElement, OptionSerializer.Serialize(read, GeneratedOptionMetadata.CreateContext()).Json));
    }

    [Fact]
    public void GraphicElements_SerializeHandlersDuringAndTextLayout()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var text = new GraphicTextOption
        {
            OnMouseOver = JsFunction.Module<GraphicOnClickSignature>("./graphic.js", "over"),
            During = JsFunction.Module<GraphicElementDuringSignature>("./graphic.js", "during"),
            TextConfig = new ElementTextConfig { Position = "inside", Distance = 4 },
        };

        // Act
        var prepared = OptionSerializer.Serialize(text, context);

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("onmouseover").ValueKind);
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("during").ValueKind);
        Assert.Equal("inside", prepared.Json.GetProperty("textConfig").GetProperty("position").GetString());
        Assert.Equal(["during", "onmouseover"], prepared.Bindings.Select(b => b.Path[0].ToString()).Order(StringComparer.Ordinal));

        // Act
        var read = GeneratedOptionMetadata.ReadGraphicTextOption(prepared.Json);

        // Assert
        Assert.Equal(4, read.TextConfig!.Distance);

        // Act
        var group = OptionSerializer.Serialize(new GraphicGroupOption
        {
            Children = [],
            During = JsFunction.Module<GraphicGroupDuringSignature>("./graphic.js", "groupDuring"),
            OnMouseOver = JsFunction.Module<GraphicOnClickSignature>("./graphic.js", "over"),
        }, context);

        // Assert
        Assert.Equal(2, group.Bindings.Count);

        // Act
        var image = OptionSerializer.Serialize(
            new GraphicImageOption { During = JsFunction.Module<GraphicElementDuringSignature>("./graphic.js", "during") },
            context);

        // Assert
        Assert.Equal("during", Assert.Single(image.Bindings).Path[0].ToString());

        // Act
        var arc = OptionSerializer.Serialize(
            new GraphicArcOption { OnMouseOver = JsFunction.Module<GraphicOnClickSignature>("./graphic.js", "over") },
            context);

        // Assert
        Assert.Equal("onmouseover", Assert.Single(arc.Bindings).Path[0].ToString());
    }
}
