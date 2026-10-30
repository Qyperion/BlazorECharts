using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class EventActionContractTests
{
    [Fact]
    public void DownplayPayload_CompilesAndRoundTripsTheCompleteDeclaration()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        using var input = JsonDocument.Parse("""{"type":"downplay","notBlur":false,"escapeConnect":false,"excludeSeriesId":[0,"s"],"animation":{"duration":0,"delay":0,"easing":"cubicInOut"},"batch":[{"animation":{"duration":0,"easing":"linear"},"excludeSeriesId":[],"seriesIndex":0,"dataIndex":0,"future":null}],"future":{"zero":0,"flag":false,"empty":[]}}""");

        // Act
        DownplayPayload payload = GeneratedOptionMetadata.ReadDownplayPayload(input.RootElement);

        // Assert
        HighlightPayloadAnimation animation = payload.Animation!;
        HighlightPayloadBatchItem item = Assert.Single(payload.Batch!)!;
        Assert.False(payload.NotBlur);
        Assert.False(payload.EscapeConnect);
        Assert.Equal(0, animation.Duration);
        Assert.Equal(0, animation.Delay);
        Assert.Equal("cubicInOut", OptionSerializer.Serialize(animation, context).Json.GetProperty("easing").GetString());
        Assert.Equal(0, item.Animation!.Duration);
        Assert.True(item.AdditionalProperties.ContainsKey("seriesIndex"));

        // Act
        var json = OptionSerializer.Serialize(payload, context).Json;

        // Assert
        Assert.Equal("downplay", json.GetProperty("type").GetString());
        Assert.Equal(0, json.GetProperty("excludeSeriesId")[0].GetDouble());
        Assert.Equal("s", json.GetProperty("excludeSeriesId")[1].GetString());
        Assert.Equal(0, json.GetProperty("batch")[0].GetProperty("excludeSeriesId").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("batch")[0].GetProperty("future").ValueKind);
        Assert.Equal(json.GetRawText(), OptionSerializer.Serialize(GeneratedOptionMetadata.ReadDownplayPayload(json), context).Json.GetRawText());

        // The declaration model uses the existing action/queue seam via its exact JSON.

        // Act
        var action = GeneratedOptionMetadata.ReadDownplayAction(json);

        // Assert
        Assert.Equal("downplay", action.Type);
        Assert.False(action.NotBlur);
        Assert.Equal(0, OptionSerializer.Serialize(Assert.Single(action.Batch!), context).Json.GetProperty("dataIndex").GetDouble());
        Assert.True(action.AdditionalProperties.ContainsKey("future"));
    }

    [Fact]
    public void DownplayPayload_PreservesUnsetNullFalseEmptyBatchAndOpenFields()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act
        var empty = OptionSerializer.Serialize(new DownplayPayload(), context).Json;

        // Assert
        Assert.False(empty.TryGetProperty("notBlur", out _));
        Assert.False(empty.TryGetProperty("batch", out _));

        // Arrange
        using var input = JsonDocument.Parse("""{"type":"downplay","notBlur":null,"animation":null,"batch":[],"excludeSeriesId":0,"unknown":""}""");

        // Act
        var payload = GeneratedOptionMetadata.ReadDownplayPayload(input.RootElement);

        // Assert
        Assert.Null(payload.NotBlur);
        Assert.Null(payload.Animation);
        Assert.Empty(payload.Batch!);

        // Act
        var json = OptionSerializer.Serialize(payload, context).Json;

        // Assert
        Assert.Equal(JsonValueKind.Null, json.GetProperty("notBlur").ValueKind);
        Assert.Equal(0, json.GetProperty("excludeSeriesId").GetDouble());
        Assert.Equal("", json.GetProperty("unknown").GetString());

        // Act
        payload.Type = "downplay";
        payload.NotBlur = false;

        // Assert
        Assert.False(OptionSerializer.Serialize(payload, context).Json.GetProperty("notBlur").GetBoolean());
    }

    [Fact]
    public void DownplayPayload_EasingUsesTheExistingTypedBindingAndSeparatePaths()
    {
        // Arrange
        var easing = JsFunction.Module<BlazorECharts.Values.Signatures.HighlightPayloadEasingSignature>("./easing.js", "ease");
        var payload = new DownplayPayload
        {
            Type = "downplay",
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
        Assert.Throws<ArgumentException>(() => payload.Type = "highlight");
        Assert.Throws<ArgumentException>(() => payload.Animation.Easing = "unknown");
    }

    [Theory]
    [InlineData("""{"type":"highlight"}""", typeof(JsonException))]
    [InlineData("""{"type":0}""", typeof(JsonException))]
    [InlineData("""{"animation":{"easing":"unknown"}}""", typeof(JsonException))]
    [InlineData("""{"animation":{"duration":"slow"}}""", typeof(JsonException))]
    [InlineData("""{"excludeSeriesId":false}""", typeof(JsonException))]
    [InlineData("""{"excludeSeriesId":[{}]}""", typeof(JsonException))]
    [InlineData("""{"batch":[{"animation":{"easing":false}}]}""", typeof(JsonException))]
    public void DownplayPayload_RejectsNonSourceLiteralAnimationAndIdAlternatives(string value, Type exceptionType)
    {
        // Arrange
        using var input = JsonDocument.Parse(value);

        // Act & Assert
        Assert.Throws(exceptionType, () => GeneratedOptionMetadata.ReadDownplayPayload(input.RootElement));
    }

    [Fact]
    public void HighlightPayload_CompilesAndRoundTripsTheCompleteDeclaration()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        using var input = JsonDocument.Parse("""{"type":"highlight","notBlur":false,"escapeConnect":false,"excludeSeriesId":[0,"s"],"animation":{"duration":0,"delay":0,"easing":"cubicInOut"},"batch":[{"animation":{"duration":0,"easing":"linear"},"excludeSeriesId":[],"seriesIndex":0,"dataIndex":0,"future":null}],"future":{"zero":0,"flag":false,"empty":[]}}""");

        // Act
        HighlightPayload payload = GeneratedOptionMetadata.ReadHighlightPayload(input.RootElement);

        // Assert
        HighlightPayloadAnimation animation = payload.Animation!;
        HighlightPayloadBatchItem item = Assert.Single(payload.Batch!)!;
        Assert.False(payload.NotBlur);
        Assert.False(payload.EscapeConnect);
        Assert.Equal(0, animation.Duration);
        Assert.Equal(0, animation.Delay);
        Assert.Equal("cubicInOut", OptionSerializer.Serialize(animation, context).Json.GetProperty("easing").GetString());
        Assert.Equal(0, item.Animation!.Duration);
        Assert.True(item.AdditionalProperties.ContainsKey("seriesIndex"));

        // Act
        var json = OptionSerializer.Serialize(payload, context).Json;

        // Assert
        Assert.Equal("highlight", json.GetProperty("type").GetString());
        Assert.Equal(0, json.GetProperty("excludeSeriesId")[0].GetDouble());
        Assert.Equal("s", json.GetProperty("excludeSeriesId")[1].GetString());
        Assert.Equal(0, json.GetProperty("batch")[0].GetProperty("excludeSeriesId").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("batch")[0].GetProperty("future").ValueKind);
        Assert.Equal(json.GetRawText(), OptionSerializer.Serialize(GeneratedOptionMetadata.ReadHighlightPayload(json), context).Json.GetRawText());

        // The declaration model uses the existing action/queue seam via its exact JSON.

        // Act
        var action = GeneratedOptionMetadata.ReadHighlightAction(json);

        // Assert
        Assert.Equal("highlight", action.Type);
        Assert.False(action.NotBlur);
        Assert.Equal(0, OptionSerializer.Serialize(Assert.Single(action.Batch!), context).Json.GetProperty("dataIndex").GetDouble());
        Assert.True(action.AdditionalProperties.ContainsKey("future"));
    }

    [Fact]
    public void HighlightPayload_PreservesUnsetNullFalseEmptyBatchAndOpenFields()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        // Act
        var empty = OptionSerializer.Serialize(new HighlightPayload(), context).Json;

        // Assert
        Assert.False(empty.TryGetProperty("notBlur", out _));
        Assert.False(empty.TryGetProperty("batch", out _));

        // Arrange
        using var input = JsonDocument.Parse("""{"type":"highlight","notBlur":null,"animation":null,"batch":[],"excludeSeriesId":0,"unknown":""}""");

        // Act
        var payload = GeneratedOptionMetadata.ReadHighlightPayload(input.RootElement);

        // Assert
        Assert.Null(payload.NotBlur);
        Assert.Null(payload.Animation);
        Assert.Empty(payload.Batch!);

        // Act
        var json = OptionSerializer.Serialize(payload, context).Json;

        // Assert
        Assert.Equal(JsonValueKind.Null, json.GetProperty("notBlur").ValueKind);
        Assert.Equal(0, json.GetProperty("excludeSeriesId").GetDouble());
        Assert.Equal("", json.GetProperty("unknown").GetString());

        // Act
        payload.Type = "highlight";
        payload.NotBlur = false;

        // Assert
        Assert.False(OptionSerializer.Serialize(payload, context).Json.GetProperty("notBlur").GetBoolean());
    }

    [Fact]
    public void HighlightPayload_EasingUsesTheExistingTypedBindingAndSeparatePaths()
    {
        // Arrange
        var easing = JsFunction.Module<BlazorECharts.Values.Signatures.HighlightPayloadEasingSignature>("./easing.js", "ease");
        var payload = new HighlightPayload
        {
            Type = "highlight",
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
        Assert.Throws<ArgumentException>(() => payload.Type = "downplay");
        Assert.Throws<ArgumentException>(() => payload.Animation.Easing = "unknown");
    }

    [Theory]
    [InlineData("""{"type":"downplay"}""", typeof(JsonException))]
    [InlineData("""{"type":0}""", typeof(JsonException))]
    [InlineData("""{"animation":{"easing":"unknown"}}""", typeof(JsonException))]
    [InlineData("""{"animation":{"duration":"slow"}}""", typeof(JsonException))]
    [InlineData("""{"excludeSeriesId":false}""", typeof(JsonException))]
    [InlineData("""{"excludeSeriesId":[{}]}""", typeof(JsonException))]
    [InlineData("""{"batch":[{"animation":{"easing":false}}]}""", typeof(JsonException))]
    public void HighlightPayload_RejectsNonSourceLiteralAnimationAndIdAlternatives(string value, Type exceptionType)
    {
        // Arrange
        using var input = JsonDocument.Parse(value);

        // Act & Assert
        Assert.Throws(exceptionType, () => GeneratedOptionMetadata.ReadHighlightPayload(input.RootElement));
    }

    // ECharts 6.1.0 legendAction returns the indexes of every legend the action touched (legendAction.js).
    [Fact]
    public void LegendAllAndInverseSelect_LegendIndexIsTheArrayTheRuntimeSends()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"legendselectall","selected":{"A":true},"legendIndex":[0,2]}""");

        // Act & Assert
        Assert.Equal([0, 2], new LegendSelectAllEvent(json.RootElement).LegendIndex!);
        Assert.Equal([0, 2], new LegendInverseSelectEvent(json.RootElement).LegendIndex!);
    }

    [Fact]
    public void BrushSelect_SelectedItemsExposeNativeSeriesIdentity()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"brushSelect","batch":[{"selected":[{"seriesId":"s","seriesIndex":0,"seriesName":"A","dataIndex":[0]}]}]}""");

        // Act
        var selected = Assert.Single(Assert.Single(GeneratedOptionMetadata.ReadBrushSelectAction(json.RootElement).Batch!).Selected!);

        // Assert
        Assert.NotNull(selected.GetType().GetProperty("SeriesId"));
        Assert.NotNull(selected.GetType().GetProperty("SeriesName"));
        Assert.Equal("s", selected.GetType().GetProperty("SeriesId")!.GetValue(selected));
        Assert.Equal("A", selected.GetType().GetProperty("SeriesName")!.GetValue(selected));
    }

    [Fact]
    public void BrushSelectedFromPointerDrag_ReadsNonFiniteNumbersAsNaN()
    {
        // A lineX drag stores [NaN, NaN] for the other axis; the event bridge sends non-finite numbers as null.

        // Arrange
        using var json = JsonDocument.Parse("""
            {"type":"brushselected","batch":[{"brushId":"b","brushIndex":0,"areas":[{"brushType":"lineX","xAxisIndex":0,"coordRange":[3,6],
             "range":[140.5,218.5],"__rangeOffset":{"offset":[0,0],"xyMinMax":[[140.5,218.5],[null,null]]}}],
             "selected":[{"seriesId":"messages","seriesIndex":0,"seriesName":"Messages","dataIndex":[3,4,5,6]}],"type":"brushselected","batch":null}]}
            """);

        // Act
        var batch = Assert.Single(new BrushSelectedEvent(json.RootElement).Batch!);

        // Assert
        var selected = Assert.Single(batch.Selected!);
        Assert.Equal([3, 4, 5, 6], selected.DataIndex!);
        Assert.Equal("messages", selected.SeriesId);
        var offset = Assert.Single(batch.Areas!).RangeOffset!;
        Assert.Equal([140.5, 218.5], offset.XyMinMax![0]);
        Assert.All(offset.XyMinMax[1], value => Assert.True(double.IsNaN(value)));
    }

    [Fact]
    public void ActionEvents_FollowTheEChartsPayload()
    {
        // Payloads as ECharts 6.1.0 emits them (tests/browser/event-conformance.spec.ts).

        // Arrange
        using var all = JsonDocument.Parse("""{"type":"legendselectall","legendIndex":[0],"selected":{"A":true,"B":true}}""");

        // Act
        var selectAll = new LegendSelectAllEvent(all.RootElement);

        // Assert
        Assert.Equal([0], selectAll.LegendIndex!);
        Assert.True(selectAll.Selected!["B"]);
        Assert.Null(typeof(LegendSelectChangedEvent).GetProperty("SeriesId"));
        Assert.Null(typeof(LegendSelectChangedEvent).GetProperty("AllSelected"));
        Assert.Null(typeof(ClickEvent).GetProperty("Batch"));
        Assert.Null(typeof(ClickEvent).GetProperty("DataIndexInside"));
        Assert.Null(typeof(RenderedEvent).GetProperty("Type"));

        // Arrange
        using var batched = JsonDocument.Parse("""{"type":"highlight","escapeConnect":false,"batch":[{"seriesIndex":1,"dataIndex":2,"type":"highlight","batch":null}]}""");

        // Act
        var item = Assert.Single(new HighlightEvent(batched.RootElement).Batch!);

        // Assert
        Assert.True(item.SeriesIndex!.Value.TryGetNumber(out var series) && series == 1);

        // Arrange
        using var roam = JsonDocument.Parse("""{"type":"georoam","geoId":"geo","dx":10,"dy":0}""");

        // Act & Assert
        Assert.Null(new GeoRoamEvent(roam.RootElement).TotalZoom);
        Assert.Null(typeof(GraphRoamEvent).GetProperty("TotalZoom"));
    }

    [Fact]
    public void BrushSelect_AreasExposeInternalOptionsAndRejectInvalidBrushType()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"brushSelect","areas":[{"brushType":"rect","brushMode":"single","transformable":false,"removeOnClick":false,"z":0,"brushStyle":{"fill":"red","lineWidth":0}}]}""");

        // Act
        var area = Assert.Single(GeneratedOptionMetadata.ReadBrushSelectAction(json.RootElement).Areas!);

        // Assert
        foreach (var field in new[] { "BrushMode", "BrushStyle", "Transformable", "RemoveOnClick", "Z" })
            Assert.NotNull(area.GetType().GetProperty(field));

        // Act
        var roundtrip = OptionSerializer.Serialize(area, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.False(roundtrip.GetProperty("transformable").GetBoolean());
        Assert.Equal(0, roundtrip.GetProperty("brushStyle").GetProperty("lineWidth").GetDouble());

        // Arrange
        using var invalid = JsonDocument.Parse("""{"areas":[{"brushType":"circle"}]}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadBrushSelectAction(invalid.RootElement));
    }

    [Fact]
    public void RemainingRuntimeActions_PreserveTypedOptionsSelectionGeoBatchAndPresence()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var selection = new BrushSelectAction
        {
            EscapeConnect = false,
            Batch =
            [
                new ChartBrushSelectBatchItem
                {
                    BrushIndex = 0,
                    Areas = [],
                    Selected = [new ChartBrushSelectedSeries { SeriesId = "s", SeriesName = "A", SeriesIndex = 0, DataIndex = [0, 2] }],
                },
            ],
        };

        // Act
        var brush = GeneratedOptionMetadata.ReadBrushSelectAction(OptionSerializer.Serialize(selection, context).Json);

        // Assert
        Assert.Equal(new[] { 0, 2 }, Assert.Single(Assert.Single(brush.Batch!).Selected!).DataIndex);
        Assert.Empty(brush.Batch![0].Areas!);
        Assert.False(brush.EscapeConnect);

        // Arrange
        var data = new ChangeDataViewAction { NewOption = new ChartOptions { Animation = false }, Animation = null };
        data.NewOption.AdditionalProperties["future"] = EChartsValue.From(0);

        // Act
        var json = OptionSerializer.Serialize(data, context).Json;
        var read = GeneratedOptionMetadata.ReadChangeDataViewAction(json);

        // Assert
        Assert.False(OptionSerializer.Serialize(read.NewOption!, context).Json.GetProperty("animation").GetBoolean());
        Assert.True(read.NewOption!.AdditionalProperties.ContainsKey("future"));
        Assert.Equal(JsonValueKind.Null, json.GetProperty("animation").ValueKind);
        Assert.False(OptionSerializer.Serialize(new ChangeDataViewAction(), context).Json.TryGetProperty("newOption", out _));

        // Arrange
        var magic = new ChangeMagicTypeAction
        {
            CurrentType = "bar",
            NewTitle = new ChartMagicTypeTitle { Line = "", Tiled = "Tiled" },
            FeatureName = "magicType",
            NewOption = new ChartOptions(),
            Batch = [],
        };

        // Act
        var m = GeneratedOptionMetadata.ReadChangeMagicTypeAction(OptionSerializer.Serialize(magic, context).Json);

        // Assert
        Assert.Equal("bar", m.CurrentType!.Value.Json.GetString());
        Assert.Equal("", m.NewTitle!.Line);
        Assert.Empty(m.Batch!);
        Assert.Throws<ArgumentException>(() => magic.CurrentType = "pie");

        // Arrange
        var geo = new GeoRoamAction
        {
            GeoIndex = EventActionValue.Array(0d, 1d),
            SeriesId = EventActionValue.Array("map", 0d),
            ComponentType = "geo",
            Dx = 0,
            Dy = 0,
            Zoom = 1,
            OriginX = 0,
            OriginY = 0,
            Batch = [new ChartGeoRoamBatchItem { GeoId = "geo", Dx = 3, Dy = 0 }],
        };
        geo.AdditionalProperties["future"] = EChartsValue.From(false);

        // Act
        var gjson = OptionSerializer.Serialize(geo, context).Json;
        var g = GeneratedOptionMetadata.ReadGeoRoamAction(gjson);

        // Assert
        Assert.Equal(0, g.Dx);
        Assert.Equal(3, Assert.Single(g.Batch!).Dx);
        Assert.Equal(2, g.GeoIndex!.Value.Json.GetArrayLength());
        Assert.True(g.AdditionalProperties.ContainsKey("future"));
        Assert.Throws<ArgumentException>(() => geo.GeoIndex = false);
        Assert.Throws<ArgumentException>(() => geo.ComponentType = "graph");
        Assert.Equal(gjson.GetRawText(), OptionSerializer.Serialize(g, context).Json.GetRawText());
    }

    [Fact]
    public void TreeToggle_RoundTripsScalarIndexSelectorsPresenceBatchAndUnknownFields()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var action = new TreeExpandAndCollapseAction
        {
            SeriesId = EventActionValue.Array("tree", 0d),
            DataIndex = 0,
            EscapeConnect = false,
            Animation = null,
            Batch = [new ChartTreeToggleBatchItem { DataIndex = 1, SeriesIndex = 0d }],
        };
        action.AdditionalProperties["future"] = EChartsValue.From(false);

        // Act
        var json = OptionSerializer.Serialize(action, context).Json;

        // Assert
        Assert.Equal("treeExpandAndCollapse", json.GetProperty("type").GetString());
        Assert.False(json.GetProperty("escapeConnect").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("animation").ValueKind);
        Assert.Equal(
            json.GetRawText(),
            OptionSerializer.Serialize(GeneratedOptionMetadata.ReadTreeExpandAndCollapseAction(json), context).Json.GetRawText());
        Assert.False(OptionSerializer.Serialize(new TreeExpandAndCollapseAction(), context).Json.TryGetProperty("dataIndex", out _));
        Assert.Empty(
            GeneratedOptionMetadata.ReadTreeExpandAndCollapseAction(
                OptionSerializer.Serialize(new TreeExpandAndCollapseAction { Batch = [] }, context).Json).Batch!);

        // Arrange
        using var invalid = JsonDocument.Parse("""{"type":"treeExpandAndCollapse","dataIndex":[0]}""");

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => GeneratedOptionMetadata.ReadTreeExpandAndCollapseAction(invalid.RootElement));
    }

    [Fact]
    public void TreeEvents_KeepToggleScalarAndTreemapDirectionNativeTargetAndBatchDistinct()
    {
        // Arrange
        ChartEvent<TreeExpandAndCollapseEvent> toggle = ChartEvents.TreeExpandAndCollapse;
        ChartEvent<TreemapRootToNodeEvent> root = ChartEvents.TreemapRootToNode;

        // Act & Assert
        Assert.Equal("treeexpandandcollapse", toggle.Name);
        Assert.Equal("treemaproottonode", root.Name);

        // Arrange
        using var json = JsonDocument.Parse("""{"type":"treeexpandandcollapse","dataIndex":0,"escapeConnect":false,"batch":[{"dataIndex":1,"future":[]}],"unknown":null}""");

        // Act
        var e = new TreeExpandAndCollapseEvent(json.RootElement);

        // Assert
        Assert.Equal(0, e.DataIndex);
        Assert.False(e.EscapeConnect);
        Assert.Equal(1, Assert.Single(e.Batch!).DataIndex);
        Assert.True(e.Batch![0].AdditionalProperties.ContainsKey("future"));
        Assert.Equal(JsonValueKind.Null, e.Raw.GetProperty("unknown").ValueKind);

        // Arrange
        using var emitted = JsonDocument.Parse("""{"type":"treemaproottonode","targetNode":null,"targetNodeId":"branch","direction":"rollUp","from":"view","batch":[{"targetNode":"leaf","direction":"drillDown"}]}""");

        // Act
        var r = new TreemapRootToNodeEvent(emitted.RootElement);

        // Assert
        Assert.Null(r.TargetNode);
        Assert.Equal("branch", r.TargetNodeId);
        Assert.Equal("view", r.From);
        Assert.Equal("rollUp", r.Direction!.Value.Json.GetString());
        Assert.NotNull(Assert.Single(r.Batch!).TargetNode);
        Assert.Null(typeof(TreeExpandAndCollapseEvent).GetProperty("Direction"));

        // Arrange
        using var bad = JsonDocument.Parse("""{"direction":"sideways","targetNode":{}}""");

        // Act & Assert
        Assert.Throws<ArgumentException>(() => new TreemapRootToNodeEvent(bad.RootElement).Direction);
        Assert.Throws<JsonException>(() => new TreemapRootToNodeEvent(bad.RootElement).TargetNode);

        // Arrange
        using var absent = JsonDocument.Parse("{}");

        // Act & Assert
        Assert.Null(new TreeExpandAndCollapseEvent(absent.RootElement).DataIndex);
        Assert.Null(new TreemapRootToNodeEvent(absent.RootElement).Direction);
    }

    [Fact]
    public async Task TreemapNativeTarget_UsesSeparateBindingsAndRejectsForeignOrDisposedReferences()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "treemap");
        var reference = registry.Register(new TargetResource());
        var context = new EChartsSerializationContext { ReferenceRuntimeId = "page" };
        GeneratedOptionMetadata.Register(context);
        var item = new ChartTreemapRootEventBatchItem { TargetNode = reference };

        // Act
        var prepared = OptionSerializer.Serialize(item, context);

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("targetNode").ValueKind);
        Assert.Equal("targetNode", Assert.Single(prepared.Bindings).Path.Single());

        // Arrange
        var foreign = new EChartsSerializationContext { ReferenceRuntimeId = "other" };
        GeneratedOptionMetadata.Register(foreign);

        // Act & Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(item, foreign));
        Assert.Equal(1, registry.LeaseCount);

        // Act
        await reference.DisposeAsync();

        // Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(item, context));
        Assert.Equal(0, registry.Count);
    }

    [Fact]
    public void SunburstHighDown_RejectsUnknownDataTypes()
    {
        // Act & Assert
        Assert.Throws<ArgumentException>(() => new SunburstHighlightAction { DataType = "unknown" });
        Assert.Throws<ArgumentException>(() => new SunburstUnhighlightAction { DataType = "unknown" });

        // Arrange
        var action = new SunburstHighlightAction { DataType = "main" };

        // Act
        var json = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("main", json.GetProperty("dataType").GetString());
    }

    [Fact]
    public void SunburstActions_PreserveSelectorsNativeTargetUnionPresenceAndBatch()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var root = new SunburstRootToNodeAction
        {
            SeriesId = EventActionValue.Array("s", 0d),
            TargetNode = "branch",
            TargetNodeId = null,
            EscapeConnect = false,
            Batch =
            [
                new ChartSunburstRootActionBatchItem { TargetNodeId = "leaf", Animation = new AnimationOption { Duration = 0, Easing = "linear" } },
            ],
        };
        root.AdditionalProperties["future"] = EChartsValue.From(false);

        // Act
        var json = OptionSerializer.Serialize(root, context).Json;

        // Assert
        Assert.Equal("sunburstRootToNode", json.GetProperty("type").GetString());
        Assert.Equal("branch", json.GetProperty("targetNode").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("targetNodeId").ValueKind);
        Assert.False(json.GetProperty("escapeConnect").GetBoolean());

        // Act
        var read = GeneratedOptionMetadata.ReadSunburstRootToNodeAction(json);

        // Assert
        Assert.Equal(json.GetRawText(), OptionSerializer.Serialize(read, context).Json.GetRawText());
        Assert.Equal(0, Assert.Single(read.Batch!).Animation!.Duration);
        Assert.False(OptionSerializer.Serialize(new SunburstRootToNodeAction(), context).Json.TryGetProperty("targetNode", out _));

        // Arrange
        var highlight = new SunburstHighlightAction { TargetNodeId = "leaf", DataIndex = EventActionValue.Array(0d), NotBlur = false, Batch = [] };

        // Act & Assert
        Assert.Empty(GeneratedOptionMetadata.ReadSunburstHighlightAction(OptionSerializer.Serialize(highlight, context).Json).Batch!);
        Assert.Equal("sunburstUnhighlight", new SunburstUnhighlightAction { DataIndex = 0d }.Type);
        Assert.Throws<ArgumentException>(() => new SunburstHighlightAction { SeriesIndex = "bad" });

        // Arrange
        using var forged = JsonDocument.Parse("""{"type":"sunburstRootToNode","targetNode":{"token":"fake"}}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadSunburstRootToNodeAction(forged.RootElement));
    }

    [Fact]
    public void SunburstEvents_KeepDirectionDistinctFromForwardedHighlightAndNativeReferences()
    {
        // Arrange
        ChartEvent<SunburstHighlightEvent> high = ChartEvents.SunburstHighlight;
        ChartEvent<SunburstRootToNodeEvent> root = ChartEvents.SunburstRootToNode;
        ChartEvent<SunburstUnhighlightEvent> down = ChartEvents.SunburstUnhighlight;

        // Act & Assert
        Assert.Equal("sunbursthighlight", high.Name);
        Assert.Equal("sunburstroottonode", root.Name);
        Assert.Equal("sunburstunhighlight", down.Name);

        // Arrange
        using var json = JsonDocument.Parse("""{"type":"sunburstroottonode","targetNode":null,"direction":"rollUp","escapeConnect":false,"batch":[{"type":"sunburstroottonode","targetNode":"branch","direction":"drillDown","future":0}]}""");

        // Act
        var e = new SunburstRootToNodeEvent(json.RootElement);

        // Assert
        Assert.Null(e.TargetNode);
        Assert.False(e.EscapeConnect);
        Assert.Equal("rollUp", e.Direction!.Value.Json.GetString());
        Assert.Equal("drillDown", Assert.Single(e.Batch!).Direction!.Value.Json.GetString());
        Assert.True(e.Batch![0].AdditionalProperties.ContainsKey("future"));

        // Arrange
        using var invalid = JsonDocument.Parse("""{"direction":"sideways"}""");

        // Act & Assert
        Assert.Throws<ArgumentException>(() => new SunburstRootToNodeEvent(invalid.RootElement).Direction);

        // Arrange
        using var absent = JsonDocument.Parse("{}");

        // Act & Assert
        Assert.Null(new SunburstHighlightEvent(absent.RootElement).DataIndex);
        Assert.Null(typeof(SunburstHighlightAction).GetProperty("Direction"));
        Assert.Null(typeof(ChartSunburstRootActionBatchItem).GetProperty("Direction"));
    }

    [Fact]
    public async Task SunburstNativeTarget_UsesSeparateBindingsAndRejectsDisposedOrForeignReferences()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "sunburst");
        var reference = registry.Register(new TargetResource());
        var context = new EChartsSerializationContext { ReferenceRuntimeId = "page" };
        GeneratedOptionMetadata.Register(context);
        var action = new SunburstRootToNodeAction
        {
            TargetNode = reference,
            Batch = [new ChartSunburstRootActionBatchItem { TargetNode = reference }],
        };

        // Act
        var prepared = OptionSerializer.Serialize(action, context);

        // Assert
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("targetNode").ValueKind);
        Assert.Equal(2, prepared.Bindings.Count);
        Assert.All(prepared.Bindings, binding => Assert.Equal("targetNode", binding.Path.Last()));
        Assert.Equal(1, registry.LeaseCount);

        // Arrange
        var foreign = new EChartsSerializationContext { ReferenceRuntimeId = "other" };
        GeneratedOptionMetadata.Register(foreign);

        // Act & Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(action, foreign));

        // Act
        await reference.DisposeAsync();

        // Assert
        Assert.Throws<OptionSerializationException>(() => OptionSerializer.Serialize(action, context));
        Assert.Equal(0, registry.Count);
    }

    private sealed class TargetResource : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    [Fact]
    public void AxisPointerAction_BindsExactDispatchAndPositionSignatures()
    {
        // Arrange
        var action = new UpdateAxisPointerAction
        {
            DispatchAction = JsFunction.Module<BlazorECharts.Values.Signatures.DispatchActionSignature>("./axis-actions.mjs", "dispatch"),
            Position = "inside",
            TooltipOption = new TooltipShowPayloadTooltipOption { Show = false },
        };

        // Act
        var prepared = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal("dispatchAction", Assert.Single(prepared.Bindings).Path[0]);
        Assert.False(prepared.Json.GetProperty("tooltipOption").GetProperty("show").GetBoolean());

        // Arrange
        using var invalid = JsonDocument.Parse("""{"type":"updateAxisPointer","dispatchAction":{}}""");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadUpdateAxisPointerAction(invalid.RootElement));
    }

    [Fact]
    public void AxisBatches_KeepActionInputsSeparateFromReturnedEvents()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"type":"updateAxisPointer","seriesIndex":0,"batch":[{"currTrigger":"leave","axesInfo":[],"future":false}]}""");

        // Act
        var action = GeneratedOptionMetadata.ReadUpdateAxisPointerAction(json.RootElement);

        // Assert
        Assert.Equal("leave", action.Batch![0].CurrTrigger!.Value.Json.GetString());
        Assert.Empty(action.Batch[0].AxesInfo!);

        // Act
        var output = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.False(output.GetProperty("batch")[0].GetProperty("future").GetBoolean());

        // Arrange
        using var emitted = JsonDocument.Parse("""{"type":"updateaxispointer","escapeConnect":false,"batch":[{"type":"updateaxispointer","axesInfo":[],"future":0}]}""");

        // Act
        var e = new UpdateAxisPointerEvent(emitted.RootElement);

        // Assert
        Assert.False(e.EscapeConnect);
        Assert.Empty(e.Batch![0].AxesInfo!);
        Assert.True(e.Batch[0].AdditionalProperties.ContainsKey("future"));
        Assert.Null(typeof(UpdateAxisPointerEvent).GetProperty("CurrTrigger"));
    }

    [Fact]
    public void AxisActions_RoundTripClosedPayloadsPresenceAndUnknownFields()
    {
        // Arrange
        var order = new ChangeAxisOrderAction
        {
            ComponentType = "xAxis",
            XAxisIndex = 0d,
            IsInitSort = false,
            SortInfo = new ChartAxisSortInfo { OrdinalNumbers = [2, 0, 1] },
        };
        order.AdditionalProperties["future"] = EChartsValue.From(false);

        // Act
        var json = OptionSerializer.Serialize(order, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.False(json.GetProperty("isInitSort").GetBoolean());
        Assert.False(json.GetProperty("future").GetBoolean());
        Assert.Equal(2, GeneratedOptionMetadata.ReadChangeAxisOrderAction(json).SortInfo!.OrdinalNumbers![0]);

        // Arrange
        var parallel = new ParallelAxisExpandAction
        {
            ParallelId = EventActionValue.Array("p", 0d),
            AxisExpandable = false,
            AxisExpandCenter = 0,
            AxisExpandWindow = [],
            Animation = null,
        };

        // Act
        var p = OptionSerializer.Serialize(parallel, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal(0, p.GetProperty("axisExpandWindow").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, p.GetProperty("animation").ValueKind);
        Assert.Null(GeneratedOptionMetadata.ReadParallelAxisExpandAction(p).Animation);

        // Arrange
        var pointer = new UpdateAxisPointerAction
        {
            CurrTrigger = "mousemove",
            SeriesIndex = 0,
            DataIndex = 0,
            AxesInfo = [new ChartAxisPointerInfo { AxisDim = "x", AxisIndex = 0, Value = "X" }],
        };

        // Act
        var a = OptionSerializer.Serialize(pointer, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("X", GeneratedOptionMetadata.ReadUpdateAxisPointerAction(a).AxesInfo![0].Value!.Value.Json.GetString());
        Assert.Throws<ArgumentException>(() => new UpdateAxisPointerAction { CurrTrigger = "invalid" });
        Assert.Throws<ArgumentException>(() => new ChartAxisPointerInfo { Value = true });

        // Arrange
        using var output = JsonDocument.Parse("""{"type":"updateaxispointer","axesInfo":[{"axisDim":"x","axisIndex":0,"value":0}],"seriesIndex":0,"dataIndex":0,"dataIndexInside":0,"future":false}""");

        // Act
        var e = new UpdateAxisPointerEvent(output.RootElement);

        // Assert
        Assert.Equal(0, e.AxesInfo![0].AxisIndex);
        Assert.Equal(0, e.DataIndexInside);
        Assert.False(e.Raw.GetProperty("future").GetBoolean());
        Assert.Equal("changeaxisorder", ChartEvents.ChangeAxisOrder.Name);
        Assert.Equal("parallelaxisexpand", ChartEvents.ParallelAxisExpand.Name);
        Assert.Equal("updateaxispointer", ChartEvents.UpdateAxisPointer.Name);
    }

    [Theory]
    [InlineData("\"not-an-easing\"")]
    [InlineData("false")]
    public void NodePayloadAnimation_RejectsNonSourceEasingAlternatives(string easing)
    {
        // Arrange
        using var json = JsonDocument.Parse("{\"type\":\"dragNode\",\"animation\":{\"easing\":" + easing + "}}");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadDragNodeAction(json.RootElement));

        // Arrange
        using var batch = JsonDocument.Parse("{\"type\":\"focusNodeAdjacency\",\"batch\":[{\"animation\":{\"easing\":" + easing + "}}]}");

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadFocusNodeAdjacencyAction(batch.RootElement));
    }

    [Fact]
    public void NodePayloadAnimation_PreservesLiteralsFunctionBindingsAndPresence()
    {
        // Act & Assert
        Assert.Throws<ArgumentException>(() => new AnimationOption { Easing = "not-an-easing" });

        // Arrange
        var animation = new AnimationOption { Duration = 0, Delay = null, Easing = "linear" };
        var action = new DragNodeAction { Animation = animation, Batch = [new ChartDragNodeBatchItem { Animation = animation }] };
        var context = GeneratedOptionMetadata.CreateContext();

        // Act
        var json = OptionSerializer.Serialize(action, context).Json;
        var read = GeneratedOptionMetadata.ReadDragNodeAction(json);

        // Assert
        Assert.Equal("linear", OptionSerializer.Serialize(read.Animation!, context).Json.GetProperty("easing").GetString());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("animation").GetProperty("delay").ValueKind);
        Assert.Equal(0, read.Batch![0].Animation!.Duration);

        // Arrange
        animation.Easing = JsFunction.Module<BlazorECharts.Values.Signatures.AnimationEasingAlternativeSignature>("./easing.js", "ease");

        // Act
        var prepared = OptionSerializer.Serialize(action, context);

        // Assert
        Assert.Equal(2, prepared.Bindings.Count);
        Assert.All(prepared.Bindings, binding => Assert.Equal("easing", binding.Path.Last()));
        Assert.Equal(JsonValueKind.Null, prepared.Json.GetProperty("animation").GetProperty("easing").ValueKind);
    }

    [Fact]
    public void NodeActions_CompileRoundTripAndPreserveTypedBatchAndPresence()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        var drag = new DragNodeAction
        {
            SeriesId = 0d,
            SeriesIndex = EventActionValue.Array(0d),
            SeriesName = EventActionValue.Array("S", 0d),
            DataIndex = 0,
            LocalX = 0,
            LocalY = null,
            EscapeConnect = false,
            Batch = [new ChartDragNodeBatchItem { SeriesId = "s", DataIndex = 0, LocalX = 0, LocalY = 0.25 }],
        };
        drag.AdditionalProperties["future"] = EChartsValue.From(false);

        // Act
        var json = OptionSerializer.Serialize(drag, context).Json;

        // Assert
        Assert.Equal("dragNode", json.GetProperty("type").GetString());
        Assert.Equal(0, json.GetProperty("localX").GetDouble());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("localY").ValueKind);
        Assert.False(json.GetProperty("escapeConnect").GetBoolean());
        Assert.False(json.GetProperty("future").GetBoolean());

        // Act
        var restored = GeneratedOptionMetadata.ReadDragNodeAction(json);

        // Assert
        Assert.Equal(0, restored.DataIndex);
        Assert.Equal(0, restored.LocalX);
        Assert.Null(restored.LocalY);
        Assert.Equal(0.25, Assert.Single(restored.Batch!).LocalY);
        Assert.Equal(json.GetRawText(), OptionSerializer.Serialize(restored, context).Json.GetRawText());

        // Arrange
        using var empty = JsonDocument.Parse("""{"type":"dragNode"}""");

        // Act & Assert
        Assert.Null(GeneratedOptionMetadata.ReadDragNodeAction(empty.RootElement).LocalX);
        Assert.False(OptionSerializer.Serialize(new DragNodeAction(), context).Json.TryGetProperty("localX", out _));

        // Arrange
        var focus = new FocusNodeAdjacencyAction
        {
            SeriesId = EventActionValue.Array("g", 0d),
            SeriesIndex = 0d,
            ExcludeSeriesId = EventActionValue.Array(0d),
            Batch = [],
        };
        var unfocus = new UnfocusNodeAdjacencyAction { SeriesName = 0d, EscapeConnect = false };

        // Act & Assert
        Assert.Empty(GeneratedOptionMetadata.ReadFocusNodeAdjacencyAction(OptionSerializer.Serialize(focus, context).Json).Batch!);
        Assert.Equal("unfocusNodeAdjacency", OptionSerializer.Serialize(unfocus, context).Json.GetProperty("type").GetString());
        Assert.Throws<ArgumentException>(() => new DragNodeAction { SeriesIndex = "invalid" });
        Assert.Throws<ArgumentException>(() => new FocusNodeAdjacencyAction { SeriesId = true });

        // Arrange
        using var invalid = JsonDocument.Parse("""{"type":"dragNode","localX":false}""");

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => GeneratedOptionMetadata.ReadDragNodeAction(invalid.RootElement));
    }

    [Fact]
    public void NodeEvents_HaveDistinctTypedDescriptorsAndLosslessNativeBatchPayloads()
    {
        // Arrange
        ChartEvent<DragNodeEvent> drag = ChartEvents.DragNode;
        ChartEvent<FocusNodeAdjacencyEvent> focus = ChartEvents.FocusNodeAdjacency;
        ChartEvent<UnfocusNodeAdjacencyEvent> unfocus = ChartEvents.UnfocusNodeAdjacency;

        // Act & Assert
        Assert.Equal("dragnode", drag.Name);
        Assert.Equal("focusnodeadjacency", focus.Name);
        Assert.Equal("unfocusnodeadjacency", unfocus.Name);

        // Arrange
        using var json = JsonDocument.Parse("""{"type":"dragnode","seriesId":0,"dataIndex":0,"localX":0,"localY":null,"escapeConnect":false,"future":{"empty":[],"zero":0},"batch":[{"type":"dragnode","seriesId":"s","dataIndex":0,"localX":0,"localY":0.5,"future":false}]}""");

        // Act
        var payload = new DragNodeEvent(json.RootElement);

        // Assert
        Assert.Equal(0, payload.DataIndex);
        Assert.Equal(0, payload.LocalX);
        Assert.Null(payload.LocalY);
        Assert.False(payload.EscapeConnect);
        var item = Assert.Single(payload.Batch!);
        Assert.Equal("dragnode", item.Type);
        Assert.Equal(0.5, item.LocalY);
        Assert.False(OptionSerializer.Serialize(item, GeneratedOptionMetadata.CreateContext()).Json.GetProperty("future").GetBoolean());

        // Act
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
            payload.Write(writer);

        // Assert
        Assert.Equal(json.RootElement.GetRawText(), System.Text.Encoding.UTF8.GetString(stream.ToArray()));

        // Arrange
        using var batched = JsonDocument.Parse("""{"type":"focusnodeadjacency","batch":[{"type":"focusnodeadjacency","seriesId":["g",0],"seriesIndex":[],"animation":{"duration":0},"future":false}]}""");

        // Act
        var focused = new FocusNodeAdjacencyEvent(batched.RootElement);

        // Assert
        Assert.Null(focused.SeriesId);
        Assert.Equal(0, Assert.Single(focused.Batch!).Animation!.Duration);

        // Arrange
        using var unfocused = JsonDocument.Parse("""{"batch":[]}""");

        // Act & Assert
        Assert.Empty(new UnfocusNodeAdjacencyEvent(unfocused.RootElement).Batch!);

        // Arrange
        using var empty = JsonDocument.Parse("{}");

        // Act & Assert
        Assert.Null(new DragNodeEvent(empty.RootElement).DataIndex);
        Assert.Null(new FocusNodeAdjacencyEvent(empty.RootElement).Batch);
    }

    [Fact]
    public void TooltipEvents_HaveIndependentTypedPayloads_AndLosslessOptionalFields()
    {
        // Arrange
        ChartEvent<ShowTipEvent> show = ChartEvents.ShowTip;
        ChartEvent<HideTipEvent> hide = ChartEvents.HideTip;

        // Act & Assert
        Assert.Equal("showtip", show.Name);
        Assert.Equal("hidetip", hide.Name);

        // Arrange
        using var json = JsonDocument.Parse("""{"type":"showtip","from":"tooltip_1","seriesIndex":0,"dataIndex":0,"dataIndexInside":0,"x":0,"y":12,"name":null,"escapeConnect":false,"dataByCoordSys":[],"future":{"flag":false,"empty":[]}}""");

        // Act
        var payload = new ShowTipEvent(json.RootElement);

        // Assert
        Assert.Equal("tooltip_1", payload.From);
        Assert.Equal(0, payload.SeriesIndex);
        Assert.Equal(0, payload.DataIndex);
        Assert.Equal(0, payload.DataIndexInside);
        Assert.Equal(0, payload.X);
        Assert.Equal(12, payload.Y);
        Assert.Null(payload.Name);
        Assert.False(payload.EscapeConnect);
        Assert.Empty(payload.DataByCoordSys!);

        // Act
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
            payload.Write(writer);

        // Assert
        Assert.Equal(json.RootElement.GetRawText(), System.Text.Encoding.UTF8.GetString(stream.ToArray()));

        // Arrange
        using var empty = JsonDocument.Parse("{}");

        // Act & Assert
        Assert.Null(new ShowTipEvent(empty.RootElement).SeriesIndex);
        Assert.Null(new ShowTipEvent(empty.RootElement).DataByCoordSys);
        Assert.Null(new HideTipEvent(empty.RootElement).From);

        // Arrange
        using var hidden = JsonDocument.Parse("""{"type":"hidetip","from":null,"escapeConnect":false,"future":0}""");

        // Act & Assert
        Assert.Null(new HideTipEvent(hidden.RootElement).From);
        Assert.False(new HideTipEvent(hidden.RootElement).EscapeConnect);
        Assert.Equal(0, new HideTipEvent(hidden.RootElement).Raw.GetProperty("future").GetInt32());
    }

    [Fact]
    public void TooltipEvents_ReadClosedAxisTooltipAndBatchContracts()
    {
        // Arrange
        using var json = JsonDocument.Parse("""
            {"type":"showtip","dispatchAction":null,"position":["20%",0],"tooltip":{"content":"value","encodeHTMLContent":false},"tooltipOption":{"show":false},
             "dataByCoordSys":[{"coordSysId":"grid","coordSysIndex":0,"coordSysType":"grid","coordSysMainType":"grid","dataByAxis":[
                {"axisDim":"x","axisIndex":0,"axisId":"x","axisType":"category","value":"X","valueLabelOpt":{"precision":"auto","formatter":null},"seriesDataIndices":[{"seriesIndex":0,"dataIndex":0,"dataIndexInside":0}],"future":false}]}],
             "batch":[{"type":"showtip","dataIndexInside":0,"seriesIndex":0,"dataIndex":0,"from":"tooltip_1","dataByCoordSys":null}]}
            """);

        // Act
        var payload = new ShowTipEvent(json.RootElement);

        // Assert
        DataByCoordSys system = Assert.Single(payload.DataByCoordSys!)!;
        Assert.Equal("grid", system.CoordSysMainType);
        Assert.Equal(0, system.CoordSysIndex);
        DataByAxis axis = Assert.Single(system.DataByAxis!)!;
        Assert.Equal("x", axis.AxisDim);
        Assert.Equal("category", axis.AxisType);
        TooltipDataIndex item = Assert.Single(axis.SeriesDataIndices!)!;
        Assert.Equal(0, item.SeriesIndex);
        Assert.Equal(0, item.DataIndex);
        Assert.Equal(0, item.DataIndexInside);

        // Act
        var axisJson = OptionSerializer.Serialize(axis, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("X", axisJson.GetProperty("value").GetString());
        Assert.Equal("auto", axisJson.GetProperty("valueLabelOpt").GetProperty("precision").GetString());
        Assert.Equal(JsonValueKind.Null, axisJson.GetProperty("valueLabelOpt").GetProperty("formatter").ValueKind);
        Assert.False(axisJson.GetProperty("future").GetBoolean());
        Assert.Null(payload.DispatchAction);
        Assert.False(payload.TooltipOption!.Show);

        // Arrange
        var projected = new TooltipShowPayload { Tooltip = payload.Tooltip, Position = payload.Position };

        // Act
        var tooltipJson = OptionSerializer.Serialize(projected, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.False(tooltipJson.GetProperty("tooltip").GetProperty("encodeHTMLContent").GetBoolean());
        Assert.Equal("20%", tooltipJson.GetProperty("position")[0].GetString());
        Assert.Equal(0, Assert.Single(payload.Batch!).DataIndexInside);
        Assert.Null(Assert.Single(payload.Batch!).DataByCoordSys);

        // Arrange
        using var text = JsonDocument.Parse("""{"tooltip":"plain text"}""");

        // Act
        var textPayload = new TooltipShowPayload { Tooltip = new ShowTipEvent(text.RootElement).Tooltip };

        // Assert
        Assert.Equal(
            "plain text",
            OptionSerializer.Serialize(textPayload, GeneratedOptionMetadata.CreateContext()).Json.GetProperty("tooltip").GetString());

        // Arrange
        using var hide = JsonDocument.Parse("""{"batch":[{"type":"hidetip","from":"tooltip_1"}]}""");

        // Act & Assert
        Assert.Equal("tooltip_1", Assert.Single(new HideTipEvent(hide.RootElement).Batch!).From);
    }

    [Theory]
    [InlineData("{\"precision\":false}")]
    [InlineData("{\"precision\":\"invalid\"}")]
    [InlineData("{\"formatter\":42}")]
    [InlineData("{\"formatter\":false}")]
    public void TooltipAxisLabel_RejectsNonSourceAlternatives(string value)
    {
        // Arrange
        using var json = JsonDocument.Parse(value);

        // Act & Assert
        Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadDataByAxisValueLabelOpt(json.RootElement));
    }

    [Fact]
    public void TooltipAxisLabel_ClosedAlternativesKeepTemplateAndCallback()
    {
        // Arrange
        var label = new DataByAxisValueLabelOpt { Precision = 0d, Formatter = "{value}" };

        // Act
        var json = OptionSerializer.Serialize(label, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal(0, json.GetProperty("precision").GetInt32());
        Assert.Equal("{value}", json.GetProperty("formatter").GetString());

        // Arrange
        label.Precision = "auto";
        label.Formatter = JsFunction.Module<BlazorECharts.Values.Signatures.DataByAxisValueLabelOptFormatterAlternativeSignature>(
            "./formatter.js",
            "format");

        // Act
        var prepared = OptionSerializer.Serialize(label, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal("auto", prepared.Json.GetProperty("precision").GetString());
        Assert.Equal("formatter", Assert.Single(prepared.Bindings).Path[0]);
    }

    [Fact]
    public void NestedActionContracts_SerializeAndRoundTripWithUnknownFields()
    {
        // Arrange
        var area = new ChartBrushArea
        {
            BrushType = "rect",
            Range = EventActionValue.Array(EventActionValue.Array(0d, 10d), EventActionValue.Array(0d, 20d)),
        };
        area.AdditionalProperties["future"] = EChartsValue.From(false);
        var action = new BrushEndAction { Areas = [area], Animation = new ChartPayloadAnimation { Duration = 0, Easing = "linear" } };

        // Act
        var json = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal(0, json.GetProperty("animation").GetProperty("duration").GetInt32());
        Assert.False(json.GetProperty("areas")[0].GetProperty("future").GetBoolean());

        // Act
        var restored = GeneratedOptionMetadata.ReadBrushEndAction(json);

        // Assert
        Assert.Equal("rect", restored.Areas![0].BrushType);
        Assert.True(restored.Areas[0].AdditionalProperties.ContainsKey("future"));
    }

    [Fact]
    public void TooltipBoxAndFunctionAlternatives_HaveTypedConstruction()
    {
        // Arrange
        var action = new ShowTipAction { Position = EventActionValue.From(new ChartTooltipBoxLayout { Left = 10d, Top = "20%" }) };

        // Act
        var json = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("20%", json.GetProperty("position").GetProperty("top").GetString());

        // Arrange
        action.Position = EventActionValue.From(
            JsFunction.Module<BlazorECharts.Values.Signatures.TooltipPositionCallback>("./position.js", "position"));

        // Act
        var prepared = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Single(prepared.Bindings);
        Assert.Equal("position", prepared.Bindings[0].Path[0]);
    }

    [Fact]
    public void ClosedNestedPayloads_AreTyped_AndRetainUnknownExtensions()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"selected":[{"seriesIndex":2,"dataType":"node","dataIndex":[0,3],"future":false}]}""");

        // Act
        var payload = new SelectChangedEvent(json.RootElement);

        // Assert
        Assert.Equal(2, payload.Selected![0].SeriesIndex);
        Assert.Equal(new[] { 0, 3 }, payload.Selected[0].DataIndex);
        Assert.True(payload.Selected[0].AdditionalProperties.ContainsKey("future"));

        // Arrange
        using var breaks = JsonDocument.Parse("""{"breaks":[{"start":1,"end":5,"isExpanded":true,"old":{"isExpanded":false}}]}""");

        // Act & Assert
        Assert.False(new AxisBreakChangedEvent(breaks.RootElement).Breaks![0].Old!.IsExpanded);

        // Arrange
        using var axis = JsonDocument.Parse("""{"parallelAxisId":"axis-a","intervals":[[1,3]]}""");

        // Act & Assert
        Assert.Equal("axis-a", new AxisAreaSelectedEvent(axis.RootElement).ParallelAxisId);
        Assert.Equal(3, new AxisAreaSelectedEvent(axis.RootElement).Intervals![0][1]);
    }

    [Theory]
    [InlineData("[\"50%\",20]")]
    [InlineData("{\"left\":\"10%\",\"top\":5}")]
    public void ShowTipPosition_AcceptsFullNativePositionUnion(string position)
    {
        // Arrange
        using var json = JsonDocument.Parse(position);
        var action = new ShowTipAction { Position = EventActionValue.FromJson(json.RootElement) };

        // Act
        var actual = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal(position, actual.GetProperty("position").GetRawText());
    }

    [Fact]
    public void PayloadExcludeSeries_AcceptsNumericAndMixedIdentifiers()
    {
        // Arrange
        using var json = JsonDocument.Parse("[1,\"series\"]");

        // Act
        var action = new HighlightAction { ExcludeSeriesId = EventActionValue.FromJson(json.RootElement) };

        // Assert
        Assert.Equal(
            2,
            OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json.GetProperty("excludeSeriesId").GetArrayLength());
    }

    [Fact]
    public async Task DisposeDuringSubscribe_RetainsCallbackUntilRegistrationSettles()
    {
        // Arrange
        var transport = new Transport { RegisterBlock = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var subscribing = chart.SubscribeAsync(ChartEvents.Click, _ => Task.CompletedTask).AsTask();

        // Act
        var disposing = chart.DisposeAsync().AsTask();

        // Assert
        Assert.False(disposing.IsCompleted);

        // Act
        transport.RegisterBlock.SetResult();
        await disposing;

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => subscribing);
        Assert.Single(transport.Released);
    }

    [Fact]
    public void AxisBreakSelectors_AcceptFullDeclarationAlternatives()
    {
        // Arrange
        using var indices = JsonDocument.Parse("[0,2]");
        var action = new ExpandAxisBreakAction
        {
            XAxisId = EventActionValue.Array("x", 3d),
            XAxisIndex = EventActionValue.FromJson(indices.RootElement),
            YAxisIndex = false,
        };

        // Act
        var json = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal(2, json.GetProperty("xAxisId").GetArrayLength());
        Assert.False(json.GetProperty("yAxisIndex").GetBoolean());
    }

    [Fact]
    public async Task Subscribe_CancelledBeforeReadiness_DoesNotAllocateCallback()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        // Act
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => chart.SubscribeAsync(ChartEvents.Click, _ => Task.CompletedTask, cancellationToken: cancellation.Token).AsTask());

        // Assert
        Assert.Empty(transport.Queries);
        Assert.Empty(transport.Released);
    }

    [Fact]
    public async Task Dispose_AttemptsAllListenersAndNativeCleanup_WhenOneUnsubscribeFails()
    {
        // Arrange
        var transport = new Transport { FailUnsubscribe = true };
        var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        await chart.SubscribeAsync(ChartEvents.Click, _ => Task.CompletedTask);
        await chart.SubscribeAsync(ChartEvents.Click, _ => Task.CompletedTask);

        // Act
        await Assert.ThrowsAnyAsync<Exception>(() => chart.DisposeAsync().AsTask());

        // Assert
        Assert.Equal(2, transport.Released.Count);
        Assert.True(transport.Disposed);
    }

    [Fact]
    public void EventPayload_PreservesKnownAndUnknownFields()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"selected":{"A":false},"name":"A","extra":{"zero":0,"empty":[]}}""");

        // Act
        var payload = new LegendSelectChangedEvent(json.RootElement);

        // Assert
        Assert.False(payload.Selected!["A"]);
        Assert.Equal(0, payload.Raw.GetProperty("extra").GetProperty("zero").GetInt32());

        // Arrange
        using var zoom = JsonDocument.Parse("""{"start":0,"end":100,"batch":[{"start":5}]}""");

        // Act & Assert
        Assert.Equal(0, new DataZoomEvent(zoom.RootElement).Start);
        Assert.Equal(5, new DataZoomEvent(zoom.RootElement).Batch![0].Start);

        // Arrange
        using var brush = JsonDocument.Parse("""{"areas":[{"brushType":"rect","range":[[0,10],[0,20]]}]}""");

        // Act & Assert
        Assert.Equal("rect", new BrushEndEvent(brush.RootElement).Areas![0].BrushType);
    }

    [Fact]
    public async Task ActionOrdering_UsesChartQueue_AndCapturesPayload()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var option = chart.SetOptionAsync(new ChartOptions()).AsTask();
        var payload = new DataZoomAction { Start = 0, End = 99 };
        var action = chart.DispatchActionAsync(payload).AsTask();
        payload.Start = 50;

        // Assert
        Assert.Equal(new[] { "setOption" }, transport.Order);

        // Act
        transport.Block.SetResult();
        await Task.WhenAll(option, action);

        // Assert
        Assert.Equal(new[] { "setOption", "dataZoom" }, transport.Order);
        Assert.Equal(0, transport.Action.GetProperty("start").GetInt32());
        Assert.Equal(2, chart.AcceptedRevision.Revision);
    }

    [Fact]
    public async Task Subscriptions_FilterReplaceAndDispose()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var calls = new List<string>();
        await using var first = await chart.SubscribeAsync(ChartEvents.Click, e =>
        {
            calls.Add("first");
            return Task.CompletedTask;
        }, EventQuery.Component("series.bar"));
        await using var second = await chart.SubscribeAsync(ChartEvents.Click, e =>
        {
            calls.Add("second");
            return Task.CompletedTask;
        });
        var delivery = first.Reference.Value;
        first.ReplaceHandler(e =>
        {
            calls.Add("replacement");
            return Task.CompletedTask;
        });
        using var empty = JsonDocument.Parse("{}");
        using var refs = JsonDocument.Parse("[]");

        // Act
        await delivery.Deliver(first.Id, 0, empty.RootElement, refs.RootElement);
        await first.DisposeAsync();
        await first.DisposeAsync();
        await delivery.Deliver(first.Id, 0, empty.RootElement, refs.RootElement);
        await second.Reference.Value.Deliver(second.Id, 0, empty.RootElement, refs.RootElement);

        // Assert
        Assert.Equal(new[] { "replacement", "second" }, calls);
        Assert.Single(transport.Released);
        Assert.Equal("series.bar", transport.Queries[0].GetString());
    }

    [Fact]
    public async Task EventHandler_FaultReachesErrorChannel()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        await using var subscription = await chart.SubscribeAsync(
            ChartEvents.Click,
            _ => Task.FromException(new InvalidOperationException("handler failed")));
        using var empty = JsonDocument.Parse("{}");
        using var refs = JsonDocument.Parse("[]");

        // Act
        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            () => subscription.Reference.Value.Deliver(subscription.Id, 0, empty.RootElement, refs.RootElement));

        // Assert
        Assert.Equal("handler failed", error.Message);
    }

    [Fact]
    public void ActionUnions_RejectWrongShape_AndPreserveExplicitValues()
    {
        // Arrange
        var action = new HighlightAction { SeriesIndex = EventActionValue.FromJson(JsonDocument.Parse("[0,1]").RootElement), NotBlur = false };

        // Act
        var json = OptionSerializer.Serialize(action, GeneratedOptionMetadata.CreateContext()).Json;

        // Assert
        Assert.Equal("highlight", json.GetProperty("type").GetString());
        Assert.Equal(2, json.GetProperty("seriesIndex").GetArrayLength());
        Assert.False(json.GetProperty("notBlur").GetBoolean());
        Assert.Throws<ArgumentException>(() => action.SeriesIndex = EventActionValue.FromJson(JsonDocument.Parse("true").RootElement));
    }

    [Fact]
    public void MouseEvents_ExposeDocumentedEmittedFields()
    {
        // Arrange
        using var json = JsonDocument.Parse("""
            {"componentType":"series","seriesType":"pie","percent":37.5,"color":"#5470c6",
             "treePathInfo":[{"name":"Root","dataIndex":0,"value":[3,4],"future":false},{"name":"Leaf","dataIndex":2,"value":2}],
             "treeAncestors":[{"name":"Root","dataIndex":0,"value":3}],
             "info":{"kind":"marker","zero":0},"targetType":"axisLabel","break":{"start":5,"end":10,"future":1},
             "coord":[1,-1],"selfType":"area","xAxisIndex":3}
            """);

        // Act
        var e = new ClickEvent(json.RootElement);

        // Assert
        Assert.Equal(37.5, e.Percent);
        Assert.Equal(new[] { "Root", "Leaf" }, e.TreePathInfo!.Select(i => i.Name));
        Assert.Equal(2, e.TreePathInfo![1].DataIndex);
        Assert.Equal("[3,4]", e.TreePathInfo[0].Value!.Value.Json.GetRawText());
        Assert.True(e.TreePathInfo[0].AdditionalProperties.ContainsKey("future"));
        Assert.Equal(0, Assert.Single(e.TreeAncestors!).DataIndex);
        Assert.Equal("""{"kind":"marker","zero":0}""", Serialized(e.Info!.Value));
        Assert.Equal("axisLabel", e.TargetType);
        Assert.Equal(5, e.Break!.Start);
        Assert.Equal(10, e.Break.End);
        Assert.True(e.Break.AdditionalProperties.ContainsKey("future"));
        Assert.Equal(new[] { 1d, -1d }, e.Coord);
        Assert.Equal("area", e.SelfType);
        Assert.Equal("\"#5470c6\"", Serialized(EChartsValue.From(e.Color!.Value)));
        Assert.Equal(3, e.Raw.GetProperty("xAxisIndex").GetInt32());

        // Arrange
        using var empty = JsonDocument.Parse("""{"info":null,"color":null}""");

        // Act
        var absent = new MouseOverEvent(empty.RootElement);

        // Assert
        Assert.Null(absent.Info);
        Assert.Null(absent.Color);
        Assert.Null(absent.TreePathInfo);
        Assert.Null(absent.Break);

        // Arrange
        using var gradient = JsonDocument.Parse("""{"color":{"type":"linear","x":0,"y":0,"x2":1,"y2":0,"colorStops":[{"offset":0,"color":"red"},{"offset":1,"color":"blue"}]}}""");

        // Act & Assert
        Assert.Equal(
            "linear",
            JsonDocument.Parse(Serialized(EChartsValue.From(new ClickEvent(gradient.RootElement).Color!.Value))).RootElement
                .GetProperty("type")
                .GetString());
    }

    [Theory]
    [InlineData(typeof(ClickEvent))]
    [InlineData(typeof(DoubleClickEvent))]
    [InlineData(typeof(MouseDownEvent))]
    [InlineData(typeof(MouseMoveEvent))]
    [InlineData(typeof(MouseUpEvent))]
    [InlineData(typeof(MouseOverEvent))]
    [InlineData(typeof(MouseOutEvent))]
    [InlineData(typeof(GlobalOutEvent))]
    [InlineData(typeof(ContextMenuEvent))]
    public void AllMouseEvents_ShareDocumentedFieldContracts(Type type)
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"percent":50,"treeAncestors":[{"name":"A","dataIndex":1,"value":1}],"info":7,"break":{"start":1,"end":2},"coord":[0,1],"selfType":"line","targetType":"axisName","color":"red"}""");

        // Act
        var payload = (ChartEventPayload)Activator.CreateInstance(type, json.RootElement)!;

        // Assert
        object? Get(string name) => type.GetProperty(name)!.GetValue(payload);

        Assert.Equal(50d, Get("Percent"));
        Assert.Equal("A", Assert.Single((ChartTreePathItem[])Get("TreeAncestors")!).Name);
        Assert.Equal(typeof(ChartTreePathItem[]), type.GetProperty("TreePathInfo")!.PropertyType);
        Assert.Equal("7", Serialized((EChartsValue)Get("Info")!));
        Assert.Equal(2d, ((ChartAxisLabelBreak)Get("Break")!).End);
        Assert.Equal(new[] { 0d, 1d }, (double[])Get("Coord")!);
        Assert.Equal("line", Get("SelfType"));
        Assert.Equal("axisName", Get("TargetType"));
        Assert.Equal(typeof(BlazorECharts.Values.ZRColor?), type.GetProperty("Color")!.PropertyType);
    }

    [Fact]
    public void EventActionValue_TypedReadersMatchOnlyTheirShape()
    {
        // Act & Assert
        Assert.True(EventActionValue.From(2.5).TryGetNumber(out var number));
        Assert.Equal(2.5, number);
        Assert.False(EventActionValue.From("2").TryGetNumber(out _));
        Assert.True(EventActionValue.From("all").TryGetString(out var text));
        Assert.Equal("all", text);
        Assert.False(EventActionValue.From(1d).TryGetString(out _));
        Assert.True(EventActionValue.From(false).TryGetBoolean(out var flag));
        Assert.False(flag);
        Assert.False(EventActionValue.From("false").TryGetBoolean(out _));

        // Arrange
        var numbers = EventActionValue.From([1d, 2.5]);

        // Act & Assert
        Assert.Equal("[1,2.5]", numbers.Json.GetRawText());
        Assert.True(numbers.TryGetNumbers(out var array));
        Assert.Equal(new[] { 1d, 2.5 }, array);
        Assert.False(numbers.TryGetNumberMatrix(out _));

        // Arrange
        var matrix = EventActionValue.From([[0d, 10d], []]);

        // Act & Assert
        Assert.Equal("[[0,10],[]]", matrix.Json.GetRawText());
        Assert.True(matrix.TryGetNumberMatrix(out var rows));
        Assert.Equal(10, rows[0][1]);
        Assert.Empty(rows[1]);
        Assert.False(matrix.TryGetNumbers(out _));
        Assert.False(EventActionValue.Array(1d, "x").TryGetNumbers(out _));

        // Arrange
        using var map = JsonDocument.Parse("""{"A":false,"B":true}""");

        // Act & Assert
        Assert.True(EventActionValue.FromJson(map.RootElement).TryGetBooleanMap(out var selected));
        Assert.False(selected["A"]);
        Assert.True(selected["B"]);

        // Arrange
        using var mixed = JsonDocument.Parse("""{"A":false,"B":1}""");

        // Act & Assert
        Assert.False(EventActionValue.FromJson(mixed.RootElement).TryGetBooleanMap(out _));

        // Arrange
        var function = EventActionValue.From(JsFunction.Module<BlazorECharts.Values.Signatures.TooltipPositionCallback>("./position.js", "position"));

        // Act & Assert
        Assert.False(function.TryGetNumber(out _));
        Assert.False(function.TryGetString(out _));
        Assert.False(function.TryGetNumbers(out _));
        Assert.False(function.TryGetBooleanMap(out _));
        Assert.False(default(EventActionValue).TryGetBoolean(out _));
        Assert.False(default(EventActionValue).TryGetNumberMatrix(out _));
        Assert.Throws<ArgumentNullException>(() => EventActionValue.From((double[])null!));
        Assert.Throws<ArgumentNullException>(() => EventActionValue.From(new double[][] { null! }));

        // Arrange
        using var selection = JsonDocument.Parse("""{"dataIndex":[1,4]}""");

        // Act & Assert
        Assert.True(new SunburstHighlightEvent(selection.RootElement).DataIndex!.Value.TryGetNumbers(out var indices));
        Assert.Equal(new[] { 1d, 4d }, indices);
    }

    [Fact]
    public async Task EventQuery_SelectWritesNativeObjectQueryKeys()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var query = EventQuery.Select("series", index: 1, id: "s1", name: "Sales", dataIndex: 2, dataName: "Mon", dataType: "node", element: "label")
            .WithThrottle(TimeSpan.FromMilliseconds(5));

        // Act
        await using var subscription = await chart.SubscribeAsync(ChartEvents.Click, _ => Task.CompletedTask, query);

        // Assert
        Assert.Equal(
            """{"seriesIndex":1,"seriesId":"s1","seriesName":"Sales","dataIndex":2,"name":"Mon","dataType":"node","element":"label"}""",
            transport.Queries[0].GetRawText());
        Assert.Equal(5, subscription.ThrottleMilliseconds);
        Assert.Equal("""{"graphicName":"marker"}""", EventQuery.Select("graphic", name: "marker").Json.GetRawText());
        Assert.Equal("""{"dataIndex":0,"dataType":"edge"}""", EventQuery.Select(dataIndex: 0, dataType: "edge").Json.GetRawText());
        Assert.Throws<ArgumentException>(() => EventQuery.Select("series"));
        Assert.Throws<ArgumentException>(() => EventQuery.Select(index: 0));
        Assert.Throws<ArgumentException>(() => EventQuery.Select("data", index: 0));
        Assert.Throws<ArgumentException>(() => EventQuery.Select(" ", index: 0));
        Assert.Throws<ArgumentException>(() => EventQuery.Select());
    }

    private static string Serialized(EChartsValue value)
    {
        var options = new ChartOptions();
        options.AdditionalProperties["value"] = value;
        return OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json.GetProperty("value").GetRawText();
    }

    private sealed class Transport : IChartCommandTransport, IChartEventTransport
    {
        internal readonly TaskCompletionSource Block = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly List<string> Order = [];
        internal readonly List<string> Released = [];
        internal readonly List<JsonElement> Queries = [];
        internal JsonElement Action;
        internal bool FailUnsubscribe;
        internal bool Disposed;
        internal TaskCompletionSource? RegisterBlock;

        public async ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken token)
        {
            Order.Add("setOption");
            await Block.Task;
        }

        public ValueTask DisposeAsync(string id)
        {
            Disposed = true;
            return ValueTask.CompletedTask;
        }

        public ValueTask DispatchActionAsync(string id, JsonElement payload, JsonElement settings, ChartRevision revision)
        {
            Action = payload;
            Order.Add(payload.GetProperty("type").GetString()!);
            return ValueTask.CompletedTask;
        }

        public async ValueTask SubscribeAsync(string id, ChartSubscription subscription, string name, JsonElement query)
        {
            Queries.Add(query);
            if (RegisterBlock is not null)
                await RegisterBlock.Task;
        }

        public ValueTask UnsubscribeAsync(string id, string subscription)
        {
            Released.Add(subscription);
            return FailUnsubscribe ? ValueTask.FromException(new InvalidOperationException("release failed")) : ValueTask.CompletedTask;
        }
    }
}
