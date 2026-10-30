using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Xunit;

namespace BlazorECharts.Tests.GeneratedContracts;

public class UnionContractsTests
{
    private static readonly EChartsSerializationContext Context = GeneratedOptionMetadata.CreateContext();

    private static JsonElement Json(OptionObject value) => OptionSerializer.Serialize(value, Context).Json;

    [Fact]
    public void Generated_LineStepAndShowAllSymbol_PreserveLiteralUnions()
    {
        // Act & Assert
        foreach (var literal in new[] { "start", "middle", "end" })
            Assert.Equal(literal, Json(new LineSeriesOption { Step = LineStep.From(literal) }).GetProperty("step").GetString());

        Assert.False(
            Json(new LineSeriesOption { Step = LineStep.From(false), ShowAllSymbol = BooleanOrAuto.From(false) }).GetProperty("step").GetBoolean());
        Assert.True(Json(new LineSeriesOption { ShowAllSymbol = BooleanOrAuto.From(true) }).GetProperty("showAllSymbol").GetBoolean());
        Assert.Equal("auto", Json(new LineSeriesOption { ShowAllSymbol = BooleanOrAuto.From("auto") }).GetProperty("showAllSymbol").GetString());
        Assert.Throws<ArgumentException>(() => LineStep.From(true));
        Assert.Throws<ArgumentException>(() => LineStep.From("invalid"));
        Assert.Throws<ArgumentException>(() => BooleanOrAuto.From("invalid"));
    }

    [Fact]
    public void Generated_AxisIdAndDatasetDimensions_AcceptActualUpstreamAlternatives()
    {
        // Arrange
        var line = new LineSeriesOption { XAxisId = NumberOrString.From(42), YAxisId = NumberOrString.From("right") };

        // Act & Assert
        Assert.Equal(42, Json(line).GetProperty("xAxisId").GetInt32());
        Assert.Equal("right", Json(line).GetProperty("yAxisId").GetString());

        // Arrange
        var dataset = GeneratedOptionMetadata.ReadDatasetOption(
            JsonDocument.Parse("""{"dimensions":["day",{"name":"sales","displayName":"Sales","type":"float"}]}""").RootElement);

        // Act & Assert
        Assert.Equal("Sales", Json(dataset).GetProperty("dimensions")[1].GetProperty("displayName").GetString());
        Assert.Equal("day", Json(dataset).GetProperty("dimensions")[0].GetString());
    }

    [Fact]
    public void Generated_TooltipValueFormatter_IsFunctionContractNotString()
    {
        // Arrange
        var tooltip = new TooltipOption { ValueFormatter = JsFunction.Module<TooltipValueFormatterSignature>("/formatters.js", "value") };

        // Act
        var prepared = OptionSerializer.Serialize(tooltip, Context);

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("valueFormatter").ValueKind);
        Assert.Equal(TooltipValueFormatterSignature.Id, Assert.Single(prepared.Bindings).Signature);
    }

    [Fact]
    public void Generated_TitleAndCalendar_OneOrManyPreservesShape()
    {
        // Arrange
        var single = new ChartOptions { Title = OneOrMany<TitleOption>.One(new() { Text = "One" }), Calendar = OneOrMany<CalendarOption>.One(new()) };
        var array = new ChartOptions
        {
            Title = OneOrMany<TitleOption>.Many(new TitleOption { Text = "One" }),
            Calendar = OneOrMany<CalendarOption>.Many(new CalendarOption()),
        };

        // Act & Assert
        Assert.Equal(JsonValueKind.Object, Json(single).GetProperty("title").ValueKind);
        Assert.Equal(JsonValueKind.Array, Json(array).GetProperty("title").ValueKind);
        Assert.Equal(JsonValueKind.Object, Json(single).GetProperty("calendar").ValueKind);
        Assert.Equal(JsonValueKind.Array, Json(array).GetProperty("calendar").ValueKind);

        // Act
        var read = GeneratedOptionMetadata.ReadChartOptions(Json(array));

        // Assert
        Assert.Equal(Json(array).GetRawText(), Json(read).GetRawText());
    }

    [Fact]
    public void Generated_GraphicAndCustomRenderItem_EmitDescriptorMetadata()
    {
        // Arrange
        var chart = new ChartOptions
        {
            Series = OneOrMany<SeriesOption>.Many(
                new CustomSeriesOption { RenderItem = JsFunction.Module<CustomRenderItemSignature>("/render.js", "render") }),
            Graphic = OneOrMany<GraphicOption?>.Many(
                GraphicOption.From(new GraphicTextOption { OnClick = JsFunction.Module<GraphicOnClickSignature>("/events.js", "click") })),
        };

        // Act
        var prepared = OptionSerializer.Serialize(chart, Context);

        // Assert
        Assert.Equal(2, prepared.Bindings.Count);
        Assert.Equal(
            new object[] { "series", 0, "renderItem" },
            Assert.Single(prepared.Bindings, b => b.Signature == CustomRenderItemSignature.Id).Path);
        Assert.Equal(new object[] { "graphic", 0, "onclick" }, Assert.Single(prepared.Bindings, b => b.Signature == GraphicOnClickSignature.Id).Path);

        // Act
        var wire = JsonSerializer.Serialize(prepared, EChartsTransportJsonContext.Default.PreparedOption);
        using var parsed = JsonDocument.Parse(wire);

        // Assert
        Assert.Equal(GraphicOnClickSignature.Id, parsed.RootElement.GetProperty("bindings")[0].GetProperty("signature").GetString());
    }

    [Fact]
    public void Generated_ReadersPreservePresenceNullUnknownFieldsAndDefaults()
    {
        // Act
        var update = new SetOptionOptions();

        // Assert
        Assert.Equal(false, update.NotMerge);
        Assert.Equal(false, update.LazyUpdate);
        Assert.Equal(false, update.Silent);
        Assert.False(update.IsAssigned("replaceMerge"));
        Assert.Equal("{}", Json(update).GetRawText());

        // Act
        var read = GeneratedOptionMetadata.ReadChartOptions(
            JsonDocument.Parse("""{"animation":false,"animationThreshold":0,"title":null,"future":{"x":[]}}""").RootElement);

        // Assert
        Assert.Equal("{\"animation\":false,\"animationThreshold\":0,\"title\":null,\"future\":{\"x\":[]}}", Json(read).GetRawText());
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadLineSeriesOption(JsonDocument.Parse("""{"step":true}""").RootElement));
        Assert.Throws<JsonException>(
            () => GeneratedOptionMetadata.ReadChartOptions(JsonDocument.Parse("""{"xAxis":{"type":"invalid"}}""").RootElement));
    }

    [Fact]
    public void Generated_UnionInCustomData_RequiresExplicitConverter()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        context.Register(GeneratedFixtureJsonContext.Default.WrappedStep);
        var chart = new ChartOptions { AdditionalProperties = { ["custom"] = EChartsValue.From(new WrappedStep(LineStep.From("start"))) } };

        // Act
        var error = Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(chart, context));

        // Assert
        Assert.Equal("$.custom", error.Path);
        Assert.Equal(typeof(LineStep), error.ClrType);
    }

    [Fact]
    public void Generated_FixedTuple_PreservesOrderAndRejectsWrongArity()
    {
        // Arrange
        var axis = new AxisLineOption { Symbol = AxisLineOptionSymbol.From(AxisLineOptionSymbolAlternative.Create("none", "arrow")) };

        // Act & Assert
        Assert.Equal("{\"symbol\":[\"none\",\"arrow\"]}", Json(axis).GetRawText());

        // Act
        var read = GeneratedOptionMetadata.ReadAxisLineOption(Json(axis));

        // Assert
        Assert.Equal(Json(axis).GetRawText(), Json(read).GetRawText());

        // Arrange
        using var invalid = JsonDocument.Parse("""{"symbol":["arrow"]}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadAxisLineOption(invalid.RootElement));
    }
}

internal sealed record WrappedStep(LineStep Step);

[JsonSerializable(typeof(WrappedStep))]
internal partial class GeneratedFixtureJsonContext : JsonSerializerContext;
