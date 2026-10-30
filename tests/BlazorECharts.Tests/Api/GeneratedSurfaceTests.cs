using System.Reflection;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Api;

/// <summary>Shapes of the generated public surface that the 1.0 baseline freezes.</summary>
public sealed class GeneratedSurfaceTests
{
    private static readonly Type[] Models = typeof(ChartOptions).Assembly.GetExportedTypes()
        .Where(t => t.IsSubclassOf(typeof(OptionObject)) && !t.IsAbstract).ToArray();

    [Fact]
    public void LargeDataSeries_TakeCollectionExpressions()
    {
        // Arrange
        var scatter = new ScatterSeriesOption { Data = [new OptionDataValue?[] { 1, 2 }, 3, new ScatterDataItemOption { Name = "A" }] };
        var lines = new LinesSeriesOption { Data = [new LinesDataItemOption { Name = "route" }] };
        var context = OptionMetadata.CreateContext();

        // Act & Assert
        Assert.Equal("""[[1,2],3,{"name":"A"}]""", OptionSerializer.Serialize(scatter, context).Json.GetProperty("data").GetRawText());
        Assert.Equal("""[{"name":"route"}]""", OptionSerializer.Serialize(lines, context).Json.GetProperty("data").GetRawText());

        // Act
        var count = 0;
        foreach (var _ in scatter.Data!.Value)
            count++;

        // Assert
        Assert.Equal(3, count);

        // Arrange
        ScatterSeriesOptionData typed = OptionArrayLike<double?>.From([1, 2]);

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => typed.GetEnumerator());
    }

    [Fact]
    public void VariantType_IsWrittenByTheVariantOnly()
    {
        // Act
        var variants = Models.Where(t => t.GetConstructor(Type.EmptyTypes) is { } ctor && ((OptionObject)ctor.Invoke(null)).IsAssigned("type")
            && !t.IsSubclassOf(typeof(SeriesOption)) && t.GetProperty("Type") is not null).ToArray();

        // Assert
        Assert.True(variants.Length > 40, $"{variants.Length} variants");
        Assert.Empty(variants.Where(t => t.GetProperty("Type")!.SetMethod?.IsPublic == true).Select(t => t.Name));
    }

    [Fact]
    public void EventHandlerMembers_FollowDotNetNaming()
    {
        // Act
        var handlers = Models.SelectMany(t => t.GetProperties())
            .Where(p => p.Name.StartsWith("On", StringComparison.Ordinal) && p.Name.Length > 2)
            .Select(p => p.Name)
            .ToHashSet();

        // Assert
        Assert.Contains("OnDoubleClick", handlers);
        Assert.Contains("OnMouseWheel", handlers);
        Assert.DoesNotContain(handlers, name => char.IsLower(name[2]));
        Assert.NotNull(Type.GetType("BlazorECharts.Options.GeoUnselectAction, BlazorECharts"));
        Assert.NotNull(Type.GetType("BlazorECharts.Options.LegendUnselectAction, BlazorECharts"));
    }

    [Fact]
    public void SharedUnions_AreNamedByWhatTheyAre()
    {
        // Act & Assert
        Assert.Equal(typeof(TooltipTrigger?), typeof(TooltipOption).GetProperty("Trigger")!.PropertyType);
        Assert.Equal(typeof(CategoryAxisType?), typeof(XAxisCategoryOption).GetProperty("Type")!.PropertyType);
        Assert.Equal(typeof(CartesianOrPolarCoordinateSystem?), typeof(LineSeriesOption).GetProperty("CoordinateSystem")!.PropertyType);
        Assert.Equal(typeof(SeriesLabelFormatter?), typeof(BarLabelOption).GetProperty("Formatter")!.PropertyType);
    }

    [Fact]
    public void EncodeChildGroup_WritesTheFieldThatUniversalTransitionReads()
    {
        // Arrange
        var encode = new OptionEncode { ItemChildGroupId = "group" };

        // Act & Assert
        Assert.Equal("""{"itemChildGroupId":"group"}""", OptionSerializer.Serialize(encode, OptionMetadata.CreateContext()).Json.GetRawText());
        Assert.Null(typeof(OptionEncode).GetProperty("ChildGroupdId"));
    }

    [Fact]
    public void ExcludeSeriesId_OnlyOnActionsThatReadIt()
    {
        // ECharts 6.1.0 reads excludeSeriesId only in updateDirectly: high-down, select changes and series-scoped updates.

        // Arrange
        var readers = new HashSet<string>(StringComparer.Ordinal) { "HighlightAction", "DownplayAction", "SelectAction", "UnselectAction", "ToggleSelectAction",
            "SunburstHighlightAction", "SunburstUnhighlightAction", "FocusNodeAdjacencyAction", "UnfocusNodeAdjacencyAction" };

        // Act
        var actions = typeof(ChartOptions).Assembly.GetExportedTypes().Where(t => t.IsSubclassOf(typeof(ChartAction))).ToArray();

        // Assert
        Assert.Equal(
            readers.Order(StringComparer.Ordinal),
            actions.Where(t => t.GetProperty("ExcludeSeriesId") is not null).Select(t => t.Name).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void TransitionStates_HoldOnlyWhatEChartsAnimates()
    {
        // enterFrom, leaveTo and keyframes: transform props, style, shape and extra (customGraphicTransition.js, customGraphicKeyframeAnimation.js).

        // Arrange
        var animated = new HashSet<string>(StringComparer.Ordinal)
        {
            "X", "Y", "OriginX", "OriginY", "AnchorX", "AnchorY", "Rotation", "ScaleX", "ScaleY", "SkewX", "SkewY",
            "Style", "Shape", "Extra", "Percent", "Easing",
        };
        var bags = new[]
        {
            typeof(GraphicRectOptionEnterFrom),
            typeof(GraphicRectOptionKeyframeAnimationItemKeyframesItem),
            typeof(GraphicGroupOptionKeyframeAnimationItemKeyframesItem),
            typeof(PathProps),
            typeof(GroupProps),
        };

        // Act & Assert
        foreach (var bag in bags)
            Assert.DoesNotContain(
                bag.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly),
                p => !animated.Contains(p.Name));

        Assert.NotNull(typeof(GraphicRectOptionKeyframeAnimationItemKeyframesItem).GetProperty("Percent"));
    }

    [Fact]
    public void EventAndActionDocs_UseEChartsApiText()
    {
        // Arrange
        var xml = System.Xml.Linq.XDocument.Load(Path.ChangeExtension(typeof(ChartOptions).Assembly.Location, ".xml"));
        var members = xml.Descendants("member").ToDictionary(m => (string)m.Attribute("name")!, m => m);
        var text = string.Join("\n", members.Values.Select(m => m.Value));

        // Assert
        Assert.DoesNotContain("Source-defined", text, StringComparison.Ordinal);
        Assert.DoesNotContain("public:", text, StringComparison.Ordinal);
        Assert.DoesNotContain("(self[])", text, StringComparison.Ordinal);
        var dataZoom = members["T:BlazorECharts.Events.DataZoomEvent"];
        Assert.Contains("Event emitted after zooming data area.", dataZoom.Element("summary")!.Value, StringComparison.Ordinal);
        Assert.Equal("https://echarts.apache.org/en/api.html#events.datazoom", (string)dataZoom.Element("seealso")!.Attribute("href")!);
        var highlight = members["T:BlazorECharts.Options.HighlightAction"];
        Assert.Contains("Highlights specified data graphics.", highlight.Element("summary")!.Value, StringComparison.Ordinal);
        Assert.Equal("https://echarts.apache.org/en/api.html#action.highlight", (string)highlight.Element("seealso")!.Attribute("href")!);
        Assert.Equal(
            "https://echarts.apache.org/en/api.html#events.Mouse%20events.click",
            (string)members["T:BlazorECharts.Events.ClickEvent"].Element("seealso")!.Attribute("href")!);
    }

    [Fact]
    public void MainType_IsNeverAnOption()
    {
        // Act & Assert
        Assert.Empty(Models.Where(t => t.GetProperty("MainType") is not null).Select(t => t.Name));
        Assert.Null(typeof(BlazorECharts.WordCloud.WordCloudSeriesOption).GetProperty("MainType"));
        Assert.Equal(typeof(CoordinateSystemDataCoord?), typeof(ToolboxMagicTypeFeatureOptionOptionBar).GetProperty("Coord")!.PropertyType);
    }

    [Fact]
    public void UpstreamDeprecatedMembers_AreObsolete()
    {
        // Act
        var obsolete = Models.SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            .Select(p => (Member: p.DeclaringType!.Name + "." + p.Name, Attribute: p.GetCustomAttribute<ObsoleteAttribute>())).Where(
                p => p.Attribute is not null).ToDictionary(p => p.Member, p => p.Attribute!.Message);

        // Assert
        Assert.Equal("Deprecated in ECharts 6.1.0: Use `grid.outerBounds` instead.", obsolete["GridOption.ContainLabel"]);
        Assert.Equal("Deprecated in ECharts 6.1.0: use appendTo: 'body' instead.", obsolete["TooltipOption.AppendToBody"]);
        Assert.Contains("RadarIndicatorOption.Text", obsolete.Keys);
        Assert.Equal(24, obsolete.Count);
    }
}
