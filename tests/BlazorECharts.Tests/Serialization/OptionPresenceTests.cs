using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class OptionPresenceTests
{
    [Fact]
    public void Presence_UnsetOmitted_ExplicitNullFalseZeroEmptyArrayPreserved()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();

        // Act & Assert
        Assert.Equal("{}", OptionSerializer.Serialize(new FixtureOptions(), context).Json.GetRawText());

        // Arrange
        var options = new FixtureOptions { Text = null, Animation = false, Z = 0, Data = [] };

        // Act
        var json = OptionSerializer.Serialize(options, context).Json;

        // Assert
        Assert.Equal("{\"text\":null,\"animation\":false,\"z\":0,\"data\":[]}", json.GetRawText());
        Assert.True(options.IsAssigned("animation"));
        Assert.False(options.IsAssigned("Animation"));
    }

    [Fact]
    public void Presence_NestedUnset_DoesNotInventEmptyObjects()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        var options = new FixtureOptions();

        // Act & Assert
        Assert.False(OptionSerializer.Serialize(options, context).Json.TryGetProperty("nested", out _));

        // Act
        options.Nested = new FixtureNestedOptions();

        // Assert
        Assert.Equal("{\"nested\":{}}", OptionSerializer.Serialize(options, context).Json.GetRawText());

        // Act
        options.Nested.Show = false;

        // Assert
        Assert.Equal("{\"nested\":{\"show\":false}}", OptionSerializer.Serialize(options, context).Json.GetRawText());

        // Act
        options.Nested = null;

        // Assert
        Assert.Equal(JsonValueKind.Null, OptionSerializer.Serialize(options, context).Json.GetProperty("nested").ValueKind);
    }

    [Fact]
    public void Presence_MutationsAppearInNewPayload_ExistingPayloadIsSnapshot()
    {
        // Arrange
        var context = FixtureOptions.CreateContext();
        var options = new FixtureOptions { Z = 4 };

        // Act
        var first = OptionSerializer.Serialize(options, context);
        options.Z = 0;
        options.AdditionalProperties["new"] = EChartsValue.From(true);

        // Assert
        Assert.Equal("{\"z\":4}", first.Json.GetRawText());
        Assert.Equal("{\"z\":0,\"new\":true}", OptionSerializer.Serialize(options, context).Json.GetRawText());
    }

    [Fact]
    public void AdditionalProperties_AssignedTypedCollision_ThrowsWithPath()
    {
        // Arrange
        var nested = new FixtureNestedOptions { Show = false };
        nested.AdditionalProperties["show"] = EChartsValue.From(true);
        var options = new FixtureOptions { Components = OneOrMany<FixtureNestedOptions>.Many(nested) };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, FixtureOptions.CreateContext()));

        // Assert
        Assert.Equal("$.components[0].show", error.Path);
        Assert.Contains("assigned", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(error.Path, error.Message);
    }

    [Fact]
    public void AdditionalProperties_UnassignedTypedNameAllowed_UsesOrdinalOrder()
    {
        // Arrange
        var options = new FixtureOptions { Text = "typed" };
        options.AdditionalProperties["z"] = EChartsValue.From(3);
        using var raw = JsonDocument.Parse("{\"future\":[null,false,0,[]]}");
        options.AdditionalProperties["alpha"] = EChartsValue.FromJson(raw.RootElement);

        // Act & Assert
        Assert.Equal("{\"text\":\"typed\",\"alpha\":{\"future\":[null,false,0,[]]},\"z\":3}",
            OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());
    }

    [Fact]
    public void AdditionalProperties_KeyComparisonIsCaseSensitive()
    {
        // Arrange
        var options = new FixtureOptions { Animation = false };
        options.AdditionalProperties["Animation"] = EChartsValue.From(true);

        // Act & Assert
        Assert.Equal("{\"animation\":false,\"Animation\":true}",
            OptionSerializer.Serialize(options, FixtureOptions.CreateContext()).Json.GetRawText());
    }
}
