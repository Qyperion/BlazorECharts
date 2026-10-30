using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class RawOptionTests
{
    [Fact]
    public void Raw_ClonesJsonElementBeforeDocumentDisposal()
    {
        // Act
        PreparedOption result;
        using (var source = JsonDocument.Parse("{\"future\":[null,false,0,[]],\"big\":123456789012345678901234567890}"))
            result = OptionSerializer.Serialize(source.RootElement, new EChartsSerializationContext());

        // Assert
        Assert.Equal("{\"future\":[null,false,0,[]],\"big\":123456789012345678901234567890}", result.Json.GetRawText());
    }

    [Fact]
    public void RawValue_ClonesWhenCapturedBeforeSerialization()
    {
        // Arrange
        EChartsValue value;
        using (var source = JsonDocument.Parse("{\"name\":\"future\"}"))
            value = EChartsValue.FromJson(source.RootElement);

        var options = new FixtureOptions { Value = value };

        // Act & Assert
        Assert.Equal("{\"value\":{\"name\":\"future\"}}", OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("3")]
    public void Raw_RejectsNonObjectRoot(string text)
    {
        // Arrange
        using var source = JsonDocument.Parse(text);

        // Act
        var error = Assert.Throws<OptionSerializationException>(
            () => OptionSerializer.Serialize(source.RootElement, new EChartsSerializationContext()));

        // Assert
        Assert.Equal("$", error.Path);
    }

    [Fact]
    public void JavaScriptLookingString_IsOrdinaryData()
    {
        // Arrange
        const string script = "function(x) { return x + 1; }";
        var options = new FixtureOptions { Text = script };
        options.AdditionalProperties["__proto__"] = EChartsValue.From(script);
        options.AdditionalProperties["$js"] = EChartsValue.From("descriptor:token");
        options.AdditionalProperties["constructor"] = EChartsValue.From("=> eval('x')");

        // Act
        var json = OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json;

        // Assert
        Assert.Equal(script, json.GetProperty("text").GetString());
        Assert.Equal(script, json.GetProperty("__proto__").GetString());
        Assert.Equal("descriptor:token", json.GetProperty("$js").GetString());
        Assert.Equal("=> eval('x')", json.GetProperty("constructor").GetString());

        // Arrange
        using var raw = JsonDocument.Parse("{\"$js\":\"function(){}\",\"__proto__\":null}");

        // Act & Assert
        Assert.Equal(raw.RootElement.GetRawText(), OptionSerializer.Serialize(raw.RootElement, FixtureOptions.CreateContext()).Json.GetRawText());
    }

    [Fact]
    public void RawValue_ExceedingTransportDepth_ThrowsWithPublicPath()
    {
        // Arrange
        var text = new string('[', 64) + "0" + new string(']', 64);
        using var source = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 128 });
        var options = new FixtureOptions { Value = EChartsValue.FromJson(source.RootElement) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$.value", error.Path);
        Assert.Contains(error.Path, error.Message);
    }

    [Fact]
    public void RawValue_AtDepthBoundaryIsPreserved()
    {
        // Arrange
        var text = new string('[', 63) + "0" + new string(']', 63);
        using var source = JsonDocument.Parse(text);
        var options = new FixtureOptions { Value = EChartsValue.FromJson(source.RootElement) };

        // Act & Assert
        Assert.Equal("{\"value\":" + text + "}", OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());
    }
}
