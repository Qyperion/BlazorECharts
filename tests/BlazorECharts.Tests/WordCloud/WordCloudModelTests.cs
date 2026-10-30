using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace BlazorECharts.Tests.WordCloud;

public class WordCloudModelTests
{
    private static EChartsSerializationContext Context(bool inline = false)
    {
        var context = new EChartsSerializationContext { AllowInlineJavaScript = inline };
        GeneratedOptionMetadata.Register(context);
        WordCloudTypeRegistration.Register(context);
        return context;
    }

    [Fact]
    public void WordCloudSeries_SharesTheCoreSeriesTypes()
    {
        // Arrange
        Type Property(Type type, string name) => type.GetProperty(name)!.PropertyType;

        // Act & Assert
        Assert.Equal(typeof(NumberOrString?), Property(typeof(WordCloudSeriesOption), nameof(WordCloudSeriesOption.Name)));
        Assert.Equal(typeof(ZRColorOneOrMany?), Property(typeof(WordCloudSeriesOption), nameof(WordCloudSeriesOption.Color)));
        Assert.Equal(typeof(SelectedMap?), Property(typeof(WordCloudSeriesOption), nameof(WordCloudSeriesOption.SelectedMap)));
        Assert.Equal(typeof(SeriesSelectedMode?), Property(typeof(WordCloudSeriesOption), nameof(WordCloudSeriesOption.SelectedMode)));
        Assert.Equal(typeof(AnimationOption), Property(typeof(WordCloudSeriesOption), nameof(WordCloudSeriesOption.StateAnimation)));
        Assert.Equal(typeof(ZRColor?[][]), Property(typeof(WordCloudSeriesOption), nameof(WordCloudSeriesOption.ColorLayer)));
        foreach (var box in new[] { "Width", "Height", "Top", "Right", "Bottom", "Left" })
            Assert.Equal(typeof(NumberOrString?), Property(typeof(WordCloudSeriesOption), box));

        foreach (var style in new[] { typeof(WordCloudTextStyle), typeof(WordCloudItemTextStyle) })
            foreach (var font in new[] { "FontWeight", "FontSize", "Width" })
                Assert.Equal(typeof(NumberOrString?), Property(style, font));

        // Arrange
        using var json = JsonDocument.Parse("""{"type":"wordCloud","name":7,"width":"50%","left":12,"color":["#f00",{"type":"linear","x":0,"y":0,"x2":1,"y2":0,"colorStops":[]},null],"colorLayer":[["#0f0",null],null],"stateAnimation":{"duration":200,"easing":"linear"},"selectedMap":"all","selectedMode":"single","textStyle":{"fontSize":"14","fontWeight":600}}""");

        // Act
        var series = WordCloudTypeRegistration.ReadWordCloudSeriesOption(json.RootElement, Context());

        // Assert
        Assert.True(series.Name!.Value.TryGet(out double name) && name == 7);
        Assert.True(series.Width!.Value.TryGet(out string? width) && width == "50%");
        Assert.True(series.Left!.Value.TryGet(out double left) && left == 12);
        var palette = series.Color!.Value.Items;
        Assert.True(palette[0]!.Value.TryGet(out string? red) && red == "#f00");
        Assert.True(palette[1]!.Value.TryGet(out LinearGradientObject? gradient) && gradient.X2 == 1);
        Assert.Null(palette[2]);
        Assert.True(series.ColorLayer![0]![0]!.Value.TryGet(out string? green) && green == "#0f0");
        Assert.Null(series.ColorLayer[0]![1]);
        Assert.Null(series.ColorLayer[1]);
        Assert.Equal(200, series.StateAnimation!.Duration);
        Assert.True(series.SelectedMap!.Value.TryGet(out string? all) && all == "all");
        Assert.True(series.SelectedMode!.Value.TryGet(out string? single) && single == "single");
        Assert.True(series.TextStyle!.FontSize!.Value.TryGet(out string? size) && size == "14");
        Assert.True(JsonElement.DeepEquals(json.RootElement, OptionSerializer.Serialize(series, Context()).Json));

        // Act
        series.Width = series.Name;

        // Assert
        Assert.Equal(7, OptionSerializer.Serialize(series, Context()).Json.GetProperty("width").GetDouble());
    }

    [Fact]
    public void WordCloudSeries_TypesTheSeedAndTheLayersOfTheWords()
    {
        // Arrange
        var context = Context();
        var series = new WordCloudSeriesOption { RandomSeed = "stable", Z = 3, Zlevel = 1 };

        // Act
        var json = OptionSerializer.Serialize(series, context).Json;

        // Assert
        Assert.Equal("""{"type":"wordCloud","randomSeed":"stable","z":3,"zlevel":1}""", json.GetRawText());
        Assert.Equal(typeof(NumberOrString?), typeof(WordCloudSeriesOption).GetProperty(nameof(WordCloudSeriesOption.RandomSeed))!.PropertyType);

        // Arrange
        using var numeric = JsonDocument.Parse("""{"type":"wordCloud","randomSeed":42,"z":0,"zlevel":0}""");

        // Act
        var read = Assert.IsType<WordCloudSeriesOption>(context.ReadSeries(numeric.RootElement));

        // Assert
        Assert.True(read.RandomSeed!.Value.TryGet(out double seed) && seed == 42);
        Assert.Equal(0, read.Z);
        Assert.Equal(0, read.Zlevel);
        Assert.Empty(read.AdditionalProperties);
        Assert.True(JsonElement.DeepEquals(numeric.RootElement, OptionSerializer.Serialize(read, context).Json));

        // Arrange
        using var wrong = JsonDocument.Parse("""{"type":"wordCloud","randomSeed":true}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => context.ReadSeries(wrong.RootElement));
    }

    [Fact]
    public void WordCloudSeries_OmitsInheritedMembersWithoutEffectAndKeepsTheirJson()
    {
        // Arrange
        string[] omitted = ["Select", "AnimationThreshold", "AnimationDuration", "AnimationDurationUpdate", "AnimationDelay",
            "AnimationDelayUpdate", "AnimationEasing", "AnimationEasingUpdate", "Progressive", "ProgressiveThreshold", "ProgressiveChunkMode",
            "HoverLayerThreshold", "SeriesLayoutBy", "LabelLine", "LabelLayout", "UniversalTransition", "DataGroupId", "CoordinateSystem",
            "CoordinateSystemUsage", "Coord"];

        // Act & Assert
        foreach (var name in omitted)
            Assert.Null(typeof(WordCloudSeriesOption).GetProperty(name));

        foreach (var name in new[] { "Select", "GroupId", "ChildGroupId" })
            Assert.Null(typeof(WordCloudDataItem).GetProperty(name));

        Assert.Null(typeof(WordCloudState).GetProperty("Disabled"));
        Assert.NotNull(typeof(WordCloudSeriesOption).GetProperty(nameof(WordCloudSeriesOption.Cursor)));
        Assert.NotNull(typeof(WordCloudSeriesOption).GetProperty(nameof(WordCloudSeriesOption.BlendMode)));

        // Arrange
        using var json = JsonDocument.Parse("""{"type":"wordCloud","animationDuration":5000,"universalTransition":true,"coord":[1,0],"select":{"disabled":false},"emphasis":{"disabled":true},"data":[{"name":"A","value":1,"groupId":"g","select":{"textStyle":{"color":"red"}}}]}""");
        var context = Context();

        // Act
        var series = Assert.IsType<WordCloudSeriesOption>(context.ReadSeries(json.RootElement));

        // Assert
        Assert.Equal(["animationDuration", "universalTransition", "coord", "select"], series.AdditionalProperties.Keys);
        Assert.Equal(["disabled"], series.Emphasis!.AdditionalProperties.Keys);
        Assert.Equal(["groupId", "select"], series.Data![0].AdditionalProperties.Keys);
        Assert.True(JsonElement.DeepEquals(json.RootElement, OptionSerializer.Serialize(series, context).Json));
    }

    [Fact]
    public void WordCloudColorCallback_IsOnlyOnTheSeriesTextStyle()
    {
        // Act & Assert
        Assert.Equal(typeof(WordCloudColor?), typeof(WordCloudTextStyle).GetProperty(nameof(WordCloudTextStyle.Color))!.PropertyType);
        Assert.Equal(typeof(string), typeof(WordCloudItemTextStyle).GetProperty(nameof(WordCloudItemTextStyle.Color))!.PropertyType);
        Assert.Equal(typeof(WordCloudItemTextStyle), typeof(WordCloudDataItem).GetProperty(nameof(WordCloudDataItem.TextStyle))!.PropertyType);
        Assert.Equal(typeof(WordCloudItemTextStyle), typeof(WordCloudState).GetProperty(nameof(WordCloudState.TextStyle))!.PropertyType);
        Assert.Equal(typeof(WordCloudItemTextStyle), typeof(WordCloudRichText).GetProperty("Item")!.PropertyType);
    }

    [Fact]
    public void WordCloudMixedSeries_RoundTripsDiscriminator()
    {
        // Arrange
        var context = Context();
        var options = new ChartOptions
        {
            Series = OneOrMany<SeriesOption>.Many(
                new LineSeriesOption { ShowSymbol = false },
                new WordCloudSeriesOption { KeepAspect = false, ShrinkToFit = false, GridSize = 0, Data = [] }),
        };

        // Act
        var json = OptionSerializer.Serialize(options, context).Json;
        var roundTrip = GeneratedOptionMetadata.ReadChartOptions(json, context);
        var again = OptionSerializer.Serialize(roundTrip, context).Json;

        // Assert
        Assert.Equal(json.GetRawText(), again.GetRawText());
        var wordCloud = Assert.IsType<WordCloudSeriesOption>(context.ReadSeries(json.GetProperty("series")[1]));
        Assert.Equal("wordCloud", wordCloud.Type);
        Assert.True(wordCloud.IsAssigned("keepAspect"));
        Assert.False(wordCloud.KeepAspect);
        Assert.Empty(wordCloud.Data!);
        Assert.Equal("{\"type\":\"wordCloud\"}", OptionSerializer.Serialize(new WordCloudSeriesOption(), context).Json.GetRawText());
        Assert.Contains("\"data\":null", OptionSerializer.Serialize(new WordCloudSeriesOption { Data = null }, context).Json.GetRawText());
    }

    [Fact]
    public void WordCloudModels_CoverEveryInventoryProperty()
    {
        // Arrange
        var context = Context();
        using var fixtures = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures/wordcloud-models.json")));

        // Act & Assert
        foreach (var fixture in fixtures.RootElement.EnumerateArray())
        {
            var json = fixture.GetProperty("json");
            var value = WordCloudTypeRegistration.Read(fixture.GetProperty("model").GetString()!, json, context);
            var actual = OptionSerializer.Serialize(value, context).Json;
            Assert.True(JsonElement.DeepEquals(json, actual), fixture.GetProperty("model").GetString() + ": " + actual);
            foreach (var field in json.EnumerateObject())
                Assert.True(value.IsAssigned(field.Name), field.Name);
        }
    }

    [Fact]
    public void WordCloudTooltip_AcceptsCoreSeriesTooltipAndItemString()
    {
        // Arrange
        var context = Context();
        var series = new WordCloudSeriesOption
        {
            Tooltip = new SeriesTooltipOption { Formatter = "series {b}" },
            Data =
            [
                new WordCloudDataItem { Name = "A", Value = 1, Tooltip = "item" },
                new WordCloudDataItem { Name = "B", Value = 1, Tooltip = new SeriesTooltipOption { Formatter = "object {b}" } },
            ],
        };

        // Act
        var json = OptionSerializer.Serialize(series, context).Json;

        // Assert
        Assert.Equal("series {b}", json.GetProperty("tooltip").GetProperty("formatter").GetString());
        Assert.Equal("item", json.GetProperty("data")[0].GetProperty("tooltip").GetString());
        Assert.Equal("object {b}", json.GetProperty("data")[1].GetProperty("tooltip").GetProperty("formatter").GetString());

        // Act
        var read = Assert.IsType<WordCloudSeriesOption>(context.ReadSeries(json));

        // Assert
        Assert.IsType<SeriesTooltipOption>(read.Tooltip);
        Assert.True(JsonElement.DeepEquals(json, OptionSerializer.Serialize(read, context).Json));

        // Arrange
        using var wrong = JsonDocument.Parse("""{"type":"wordCloud","data":[{"name":"A","tooltip":1}]}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => context.ReadSeries(wrong.RootElement));
    }

    [Fact]
    public void WordCloudCallbacks_UseModuleOrExplicitInline()
    {
        // Arrange
        var options = new WordCloudSeriesOption
        {
            Shape = JsFunction.Module<WordCloudShapeSignature>("modules/words.js", "shape"),
            TextStyle = new WordCloudTextStyle { Color = JsFunction.Module<WordCloudColorSignature>("modules/words.js", "color") },
        };

        // Act
        var prepared = OptionSerializer.Serialize(options, Context());

        // Assert
        Assert.Equal(2, prepared.Bindings.Count);
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("shape").ValueKind);

        // Act
        options.Shape = JsFunction.Inline<WordCloudShapeSignature>("theta => 1");

        // Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(options, Context()));
        Assert.Equal(2, OptionSerializer.Serialize(options, Context(true)).Bindings.Count);
    }

    [Fact]
    public void WordCloudUnknownFieldsAndCollisions_ArePreservedAndRejected()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"wordCloud","keepAspect":null,"future":{"zero":0,"flag":false,"items":[]}}""");
        var context = Context();

        // Act
        var value = context.ReadSeries(json.RootElement);

        // Assert
        Assert.True(JsonElement.DeepEquals(json.RootElement, OptionSerializer.Serialize(value, context).Json));

        // Act
        value.AdditionalProperties["keepAspect"] = EChartsValue.From(true);

        // Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(value, context));
    }

    [Fact]
    public void AddWordCloud_ConfiguresOptionalExtensionWithoutChangingCore()
    {
        // Act
        var builder = new ServiceCollection().AddECharts().AddWordCloud().AddWordCloud();

        // Assert
        var extension = Assert.Single(builder.Options.Extensions);
        Assert.Equal("3.0.0", extension.Version);

        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act
        extension.ConfigureSerialization(context);

        // Assert
        Assert.Equal("wordCloud", context.ReadSeries(OptionSerializer.Serialize(new WordCloudSeriesOption(), context).Json).Type);
        Assert.Throws<JsonException>(
            () => GeneratedOptionMetadata.CreateContext().ReadSeries(OptionSerializer.Serialize(new WordCloudSeriesOption(), context).Json));

        // Arrange
        var conflicting = new ServiceCollection().AddECharts().AddExtension(new WrongWordCloud());

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => conflicting.AddWordCloud());
    }

    [Fact]
    public void WordCloudExtensionVersion_MatchesShippedManifestLockAndOverrides()
    {
        // Arrange
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !File.Exists(Path.Combine(root.FullName, "BlazorECharts.slnx")))
            root = root.Parent;

        Assert.NotNull(root);

        JsonElement Read(params string[] path) => JsonDocument.Parse(File.ReadAllText(Path.Combine([root.FullName, .. path]))).RootElement;

        var manifest = Read("src", "BlazorECharts.WordCloud", "wwwroot", "js", "assets-manifest.json");
        var version = new WordCloudExtension().Version;

        // Assert
        var package = Read("schemas", "upstream", "sources.lock.json")
            .GetProperty("packages")
            .EnumerateArray()
            .Single(item => item.GetProperty("name").GetString() == "@qyperion/echarts-wordcloud");

        Assert.Equal(version, manifest.GetProperty("version").GetString());
        Assert.Equal(version, manifest.GetProperty("package").GetProperty("version").GetString());
        Assert.Equal(version, package.GetProperty("version").GetString());
        Assert.Equal(version, Read("schemas", "overrides", $"wordcloud-{version}.json").GetProperty("version").GetString());
    }

    [Fact]
    public void WordCloudUnionAlternatives_PreserveShapesAndRejectWrongJson()
    {
        // Arrange
        var context = Context();
        WordCloudSeriesOption[] values =
        [
            new() { Shape = "circle", Width = 0, SelectedMode = true, SelectedMap = "all", StateAnimation = new AnimationOption { Duration = 0 } },
            new() { Shape = "cardioid", Color = "red", Width = "50%", ColorLayer = [["red", null], null] },
            new()
            {
                Shape = "diamond",
                TextStyle = new() { Padding = new double[] { 0, 1 }, BorderRadius = 0, FontWeight = "normal", BackgroundColor = "red" },
            },
            new() { Shape = "triangle-forward", Data = [new() { Value = new double[] { 0, 1 } }] },
            new()
            {
                Shape = "triangle",
                Color = ["red", new RadialGradientObject { ColorStops = [] }, new ImagePatternObject { Image = "pixel.svg" }],
            },
            new() { Shape = "pentagon", SelectedMode = "multiple", TextStyle = new() { FontSize = 12, Width = "40%" } },
            new() { Shape = JsFunction.Module<WordCloudShapeSignature>("m.js", "shape") },
        ];

        // Act & Assert
        foreach (var value in values)
        {
            var prepared = OptionSerializer.Serialize(value, context);
            var read = context.ReadSeries(prepared.Json);
            Assert.True(JsonElement.DeepEquals(prepared.Json, OptionSerializer.Serialize(read, context).Json));
        }

        foreach (var text in new[] { "{\"type\":\"wordCloud\",\"shape\":12}", "{\"type\":\"wordCloud\",\"data\":{}}", "{\"type\":\"wordCloud\",\"selectedMode\":\"invalid\"}", "{\"type\":\"wordCloud\",\"colorLayer\":[[1]]}", "{\"type\":\"wordCloud\",\"maskImage\":\"url.png\"}" })
        {
            using var json = JsonDocument.Parse(text);
            Assert.Throws<JsonException>(() => context.ReadSeries(json.RootElement));
        }

        Assert.Throws<ArgumentException>(() => new WordCloudState { Focus = "invalid" });
    }

    [Fact]
    public async Task WordCloudNativeImages_UseExistingReferenceBindingsAndPolicy()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "owner");
        await using var image = registry.Register(new NoopResource());
        var context = new EChartsSerializationContext { ReferenceRuntimeId = "page" };
        WordCloudTypeRegistration.Register(context);
        var words = new WordCloudSeriesOption
        {
            MaskImage = image,
            TextStyle = new()
            {
                BackgroundColor = new WordCloudImageBackground { Image = image },
                Color = JsFunction.Module<WordCloudColorSignature>("m.js", "color"),
            },
        };
        words.TextStyle.Rich = new WordCloudRichText
        {
            ["token.with.dot"] = new WordCloudItemTextStyle { BackgroundColor = new WordCloudImageBackground { Image = image } },
        };

        // Act
        var prepared = OptionSerializer.Serialize(words, context);

        // Assert
        Assert.Equal(4, prepared.Bindings.Count);
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("maskImage").ValueKind);
        Assert.Equal(1, registry.LeaseCount);
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(words, Context()));
    }

    private sealed class NoopResource : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    [Theory]
    [InlineData("3")]
    [InlineData("[4,2]")]
    [InlineData("null")]
    public void WordCloudTextBorders_PreserveNativeNumericDashForms(string dash)
    {
        // Arrange
        var context = Context();
        using var json = JsonDocument.Parse("{\"type\":\"wordCloud\",\"textStyle\":{\"borderType\":" + dash + ",\"textBorderType\":" + dash + "}}");

        // Act
        var value = context.ReadSeries(json.RootElement);

        // Assert
        Assert.True(JsonElement.DeepEquals(json.RootElement, OptionSerializer.Serialize(value, context).Json));
    }

    [Fact]
    public void WordCloudTextRuntimeFields_AreTypedAndRoundTrip()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"rich":{"token":{"fontSize":12,"color":"red"},"empty":null},"richInheritPlainLabel":false,"overflow":"truncate","lineOverflow":"truncate","ellipsis":"~","minMargin":0,"textMargin":[0,1]}""");
        var context = Context();

        // Act
        var style = WordCloudTypeRegistration.ReadWordCloudTextStyle(json.RootElement, context);

        // Assert
        foreach (var field in json.RootElement.EnumerateObject())
            Assert.True(style.IsAssigned(field.Name), field.Name);

        Assert.Empty(style.AdditionalProperties);
        Assert.True(JsonElement.DeepEquals(json.RootElement, OptionSerializer.Serialize(style, context).Json));

        // Arrange
        var typed = new WordCloudTextStyle
        {
            BorderType = new double[] { 4, 2 },
            TextBorderType = 3,
            Rich = new WordCloudRichText { ["token"] = new WordCloudItemTextStyle { FontSize = 12, Color = "red" }, ["empty"] = null },
            RichInheritPlainLabel = false,
            Overflow = "truncate",
            LineOverflow = "truncate",
            Ellipsis = "~",
            MinMargin = 0,
            TextMargin = new double[] { 0, 1 },
        };

        // Act
        var written = OptionSerializer.Serialize(typed, context).Json;

        // Assert
        Assert.Equal(2, written.GetProperty("borderType").GetArrayLength());
        Assert.Equal(3, written.GetProperty("textBorderType").GetDouble());
        Assert.Equal("red", written.GetProperty("rich").GetProperty("token").GetProperty("color").GetString());
    }

    private sealed class WrongWordCloud : IChartExtension
    {
        public string Id => "echarts-wordcloud";
        public string Version => "2.0.0";
        public string ModuleUrl => "wrong.js";
        public IReadOnlyList<string> Dependencies => [];
    }
}
