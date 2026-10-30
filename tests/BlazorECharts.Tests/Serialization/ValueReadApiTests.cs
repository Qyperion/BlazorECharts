using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class ValueReadApiTests
{
    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    [Fact]
    public void Union_ConstructedAlternative_IsReadableThroughValueAndTryGet()
    {
        // Act
        AnimationEasing easing = "cubicIn";

        // Assert
        Assert.Equal("cubicIn", easing.Value);
        Assert.True(easing.TryGet(out string? name));
        Assert.Equal("cubicIn", name);

        // Act
        ZRColor color = new LinearGradientObject { X2 = 1 };

        // Assert
        Assert.False(color.TryGet(out string? _));
        Assert.True(color.TryGet(out LinearGradientObject? gradient));
        Assert.Equal(1, gradient.X2);
    }

    [Fact]
    public void Union_ReadFromSnapshot_DecodesTheMatchingAlternative()
    {
        // Act
        var options = GeneratedOptionMetadata.ReadChartOptions(
            Json("""{"animationEasing":"cubicIn","backgroundColor":{"type":"linear","x":0,"y":0,"x2":0,"y2":1,"colorStops":[{"offset":0,"color":"red"}]}}"""));

        // Assert
        var easing = options.AnimationEasing!.Value;
        Assert.IsType<EChartsValue>(easing.Value);
        Assert.True(easing.TryGet(out string? name));
        Assert.Equal("cubicIn", name);

        var background = options.BackgroundColor!.Value;
        Assert.False(background.TryGet(out string? _));
        Assert.True(background.TryGet(out LinearGradientObject? gradient));
        Assert.Equal(1, gradient.Y2);
        Assert.Equal(0, gradient.ColorStops![0]!.Offset);
    }

    [Fact]
    public void Union_PrimitiveAlternatives_FollowTheJsonKind()
    {
        // Act
        var number = NumberOrString.Read(Json("42"));

        // Assert
        Assert.True(number.TryGet(out double value));
        Assert.Equal(42, value);
        Assert.False(number.TryGet(out string? _));

        // Act
        var text = NumberOrString.Read(Json("\"42%\""));

        // Assert
        Assert.False(text.TryGet(out double _));
        Assert.True(text.TryGet(out string? percent));
        Assert.Equal("42%", percent);
    }

    [Fact]
    public void OneOrMany_ExposesItsShapeAndItems()
    {
        // Act
        var one = OneOrMany<string?>.One("a");

        // Assert
        Assert.False(one.IsMany);
        Assert.True(one.TryGetOne(out var scalar));
        Assert.Equal("a", scalar);
        Assert.Equal(["a"], one.Items);

        // Act
        var nullScalar = OneOrMany<string?>.One(null);

        // Assert
        Assert.True(nullScalar.TryGetOne(out var missing));
        Assert.Null(missing);
        Assert.Equal([null], nullScalar.Items);

        // Act
        var many = OneOrMany<string?>.Many("a", null);

        // Assert
        Assert.True(many.IsMany);
        Assert.False(many.TryGetOne(out _));
        Assert.Equal(["a", null], many.Items);
        Assert.Empty(OneOrMany<string?>.Many().Items);
        Assert.Throws<NotSupportedException>(() => ((IList<string?>)many.Items).Add("b"));

        // Act
        var uninitialized = default(OneOrMany<string?>);

        // Assert
        Assert.False(uninitialized.IsMany);
        Assert.False(uninitialized.TryGetOne(out _));
        Assert.Throws<InvalidOperationException>(() => uninitialized.Items);
    }

    [Fact]
    public void OneOrMany_ReadFromSnapshot_KeepsTheJsonShape()
    {
        // Act
        var options = GeneratedOptionMetadata.ReadChartOptions(
            Json("""{"title":{"text":"A"},"xAxis":[{"type":"category","data":["Mon"]}],"series":[{"type":"line","data":[1,2]}]}"""));

        // Assert
        Assert.True(options.Title!.Value.TryGetOne(out var title));
        Assert.Equal("A", title!.Text);
        var axis = Assert.Single(options.XAxis!.Value.Items);
        Assert.True(options.XAxis.Value.IsMany);
        Assert.True(axis!.Value.TryGet(out XAxisCategoryOption? category));
        Assert.True(category!.Type!.Value.TryGet(out string? type));
        Assert.Equal("category", type);
        Assert.IsType<LineSeriesOption>(Assert.Single(options.Series!.Value.Items));
    }

    [Fact]
    public void OptionArrayLike_ExposesManagedValuesOrBrowserReference()
    {
        // Act
        var values = OptionArrayLike<double?>.From([1, null]);

        // Assert
        Assert.True(values.TryGetValues(out var items));
        Assert.Equal([1, null], items);
        Assert.False(values.TryGetReference(out _));

        // Act
        var reference = new BlazorECharts.Runtime.ReferenceRegistry("runtime", "owner").Register(new NoopResource());
        var browser = OptionArrayLike<double?>.From(reference);

        // Assert
        Assert.False(browser.TryGetValues(out _));
        Assert.True(browser.TryGetReference(out var read));
        Assert.Same(reference, read);

        // Act & Assert
        Assert.False(default(OptionArrayLike<double?>).TryGetValues(out _));
        Assert.False(default(OptionArrayLike<double?>).TryGetReference(out _));

        // A JSON array reads as the plain array of data items; ArrayLike holds managed values or a browser reference.

        // Act
        var series = (ScatterSeriesOption)GeneratedOptionMetadata.CreateContext().ReadSeries(Json("""{"type":"scatter","data":[1,2.5]}"""));

        // Assert
        Assert.False(series.Data!.Value.TryGet(out OptionArrayLike<double?> _));
        Assert.True(series.Data.Value.TryGet(out ScatterSeriesOptionDataItem?[]? items2));
        Assert.True(items2[1]!.Value.TryGet(out double second) && second == 2.5);
    }

    private sealed class NoopResource : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    [Fact]
    public void Tuple_Elements_AreReadableFromConstructionAndSnapshot()
    {
        // Act
        var series = (GaugeSeriesOption)GeneratedOptionMetadata.CreateContext()
            .ReadSeries(Json("""{"type":"gauge","axisLine":{"lineStyle":{"color":[[0.3,"#67e0e3"],[1,"#fd666d"]]}}}"""));

        // Assert
        var stop = series.AxisLine!.LineStyle!.Color![0]!.Value;
        Assert.Equal(0.3, stop.Item0);
        Assert.Equal("#67e0e3", stop.Item1);

        // Act
        var created = series.AxisLine.LineStyle.Color[1]!.Value.GetType().GetMethod("Create")!.Invoke(null, [0.5, "#000"])!;

        // Assert
        Assert.Equal(0.5, created.GetType().GetProperty("Item0")!.GetValue(created));
    }

    [Fact]
    public void WordCloudUnion_ReadFromSnapshot_DecodesTheMatchingAlternative()
    {
        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();
        WordCloudTypeRegistration.Register(context);

        // Act
        var series = (WordCloudSeriesOption)context.ReadSeries(Json("""{"type":"wordCloud","textStyle":{"color":"#2768ac"}}"""));

        // Assert
        Assert.True(series.TextStyle!.Color!.Value.TryGet(out string? color));
        Assert.Equal("#2768ac", color);
        Assert.IsType<EChartsValue>(series.TextStyle.Color.Value.Value);
    }
}
