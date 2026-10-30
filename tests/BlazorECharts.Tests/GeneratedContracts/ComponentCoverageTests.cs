using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;
using RichStyle = BlazorECharts.Options.TextCommonOption;

namespace BlazorECharts.Tests.GeneratedContracts;

public class ComponentCoverageTests
{
    [Fact]
    public void ArrayLike_PreservesManagedArrayAndRejectsDefault()
    {
        // Arrange
        var options = new ChartOptions { Dataset = OneOrMany<DatasetOption>.One(new() { Source = OptionArrayLike<double?>.From([1d, null, 3d]) }) };

        // Act
        var json = Json(options).GetProperty("dataset").GetProperty("source");

        // Assert
        Assert.Equal(3, json.GetArrayLength());
        Assert.Equal(JsonValueKind.Null, json[1].ValueKind);

        // Arrange
        options.Dataset = OneOrMany<DatasetOption>.One(new() { Source = default(OptionArrayLike<double?>) });

        // Act & Assert
        Assert.Throws<OptionSerializationException>(() => Json(options));
    }

    [Fact]
    public void ComponentUsage_CompilesExactUnionForms()
    {
        // Arrange
        var options = new ChartOptions
        {
            Title = OneOrMany<TitleOption>.One(new() { Text = "scalar" }),
            Calendar = OneOrMany<CalendarOption>.Many(
                new CalendarOption { Id = "calendar", Range = "2026", Left = "10%", Height = 240d, CellSize = [20d, "auto"] }),
            Dataset = OneOrMany<DatasetOption>.One(
                new() { Dimensions = [new DimensionDefinitionLooseAlternative { Name = "date", Type = "time" }, "amount"] }),
        };

        // Act
        var json = Json(options);

        // Assert
        Assert.Equal(JsonValueKind.Object, json.GetProperty("title").ValueKind);
        Assert.Equal(JsonValueKind.Array, json.GetProperty("calendar").ValueKind);
        Assert.Equal("10%", json.GetProperty("calendar")[0].GetProperty("left").GetString());
        Assert.Equal("auto", json.GetProperty("calendar")[0].GetProperty("cellSize")[1].GetString());
        Assert.Equal("time", json.GetProperty("dataset").GetProperty("dimensions")[0].GetProperty("type").GetString());
        Assert.Throws<ArgumentException>(() => new CalendarOption { Orient = "diagonal" });
    }

    [Fact]
    public void DatasetMediaAndAria_PreserveShape()
    {
        // Arrange
        var options = ComponentOptionFixtures.DatasetMediaAndAria();

        // Act
        var json = Json(options);

        // Assert
        Assert.Equal(JsonValueKind.Null, json.GetProperty("aria").GetProperty("description").ValueKind);
        Assert.False(json.GetProperty("aria").GetProperty("enabled").GetBoolean());
        Assert.Equal(0, json.GetProperty("options").GetArrayLength());
        Assert.Equal(600, json.GetProperty("media")[0].GetProperty("query").GetProperty("maxWidth").GetInt32());
        Assert.Equal("Compact axes", json.GetProperty("media")[0].GetProperty("option").GetProperty("title").GetProperty("text").GetString());

        // Act
        var read = GeneratedOptionMetadata.ReadChartOptions(json);

        // Assert
        Assert.True(read.IsAssigned("media"));
        Assert.True(JsonElement.DeepEquals(json, Json(read)));

        // Act
        var transformed = Json(ComponentOptionFixtures.Transforms()).GetProperty("dataset")[1].GetProperty("transform");

        // Assert
        Assert.Equal("filter", transformed[0].GetProperty("type").GetString());
        Assert.Equal(10, transformed[0].GetProperty("config").GetProperty("gte").GetInt32());
        Assert.Equal("desc", transformed[1].GetProperty("config").GetProperty("order").GetString());
    }

    [Fact]
    public void RecursiveRichDictionary_RetainsTypedEntriesAndPresence()
    {
        // Arrange
        var style = new RichStyle
        {
            Rich = new OptionDictionary<RichStyle?>
            {
                ["a.b\""] = new() { FontSize = 12d, RichInheritPlainLabel = false, Rich = new() { ["inner"] = new() { Color = "red" } } },
                ["null"] = null,
            },
        };

        // Act
        var json = OptionSerializer.Serialize(style, GeneratedOptionMetadata.CreateContext()).Json;
        var read = GeneratedOptionMetadata.ReadTextCommonOption(json);

        // Assert
        Assert.True(read.IsAssigned("rich"));
        Assert.False(read.Rich!["a.b\""]!.RichInheritPlainLabel);
        Assert.Null(read.Rich["null"]);
        Assert.Equal("red", read.Rich["a.b\""]!.Rich!["inner"]!.Color);
        Assert.True(JsonElement.DeepEquals(json, OptionSerializer.Serialize(read, GeneratedOptionMetadata.CreateContext()).Json));
        Assert.ThrowsAny<Exception>(() => GeneratedOptionMetadata.ReadTextCommonOption(ComponentOptionFixtures.Parse("""{"rich":42}""")));
    }

    [Fact]
    public void TypedDictionary_PreservesStructuredBindingKeys()
    {
        // Arrange
        var o = new ChartOptions();
        o.AdditionalProperties["callbacks"] = EChartsValue.From(
            new OptionDictionary<JsFunction<TooltipValueFormatterSignature>?>
            {
                ["a.b\""] = JsFunction.Module<TooltipValueFormatterSignature>("/module.js", "format"),
            });

        // Act
        var prepared = OptionSerializer.Serialize(o, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("callbacks").GetProperty("a.b\"").ValueKind);
        using var wire = JsonDocument.Parse(JsonSerializer.Serialize(prepared.Bindings[0].Path, EChartsTransportJsonContext.Default.JsBindingPath));
        Assert.Equal(new[] { "callbacks", "a.b\"" }, wire.RootElement.EnumerateArray().Select(p => p.GetString()));
    }

    [Fact]
    public void RelationalOperators_PreserveExactKeys()
    {
        // Arrange
        var value = new RelationalExpressionOption { Dimension = "amount", GreaterThan = 2d, NotEqual = 4d };

        // Act
        var json = OptionSerializer.Serialize(value, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal(2, json.GetProperty(">").GetInt32());
        Assert.Equal(4, json.GetProperty("!=").GetInt32());
        Assert.False(json.TryGetProperty("GreaterThan", out _));
    }

    private static JsonElement Json(ChartOptions options) => OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json;
}
