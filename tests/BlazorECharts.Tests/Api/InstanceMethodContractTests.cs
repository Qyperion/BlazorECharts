using System.Text.Json;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class InstanceMethodContractTests
{
    [Fact]
    public void CoordinateResults_PreservePartialMatrixNumbers()
    {
        // Arrange
        using var pixel = JsonDocument.Parse("""[{"$number":"NaN"},12]""");

        // Act
        var result = new ChartPixelValue(pixel.RootElement);

        // Assert
        Assert.True(double.IsNaN(result.Numbers![0]));
        Assert.Equal(12, result.Numbers[1]);

        // Arrange
        using var layout = JsonDocument.Parse("""{"rect":{"x":{"$number":"NaN"},"y":10,"width":{"$number":"NaN"},"height":20},"matrixXYLocatorRange":[[{"$number":"NaN"},{"$number":"NaN"}],[0,0]]}""");

        // Act
        var rectangle = new ChartCoordinateLayout(layout.RootElement);

        // Assert
        Assert.True(double.IsNaN(rectangle.Rect!.X));
        Assert.Equal(10, rectangle.Rect.Y);
        Assert.True(double.IsNaN(rectangle.MatrixXYLocatorRange![0][0]));
        Assert.Equal(0, rectangle.MatrixXYLocatorRange[1][1]);

        // Arrange
        using var absent = JsonDocument.Parse("null");

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => new ChartPixelValue(absent.RootElement));
    }

    [Fact]
    public void FinderWithoutSelectors_PreservesComponentAndDefaultsToFirst()
    {
        // Act
        var finder = ChartFinder.Select("xAxis");

        // Assert
        Assert.Equal(0, finder.Json.GetProperty("xAxisIndex").GetInt32());

        // Act
        var series = ChartFinder.Select("series", dataIndex: 2);

        // Assert
        Assert.Equal(0, series.Json.GetProperty("seriesIndex").GetInt32());
        Assert.Equal(2, series.Json.GetProperty("dataIndex").GetInt32());
    }

    [Fact]
    public async Task Methods_RespectGenerationAndOrdering()
    {
        // Arrange
        var transport = new MethodsTransport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        chart.WaitForReadiness(ready.Task);

        // Act
        var show = chart.ShowLoadingAsync().AsTask();
        var snapshot = chart.GetOptionAsync().AsTask();
        var hide = chart.HideLoadingAsync().AsTask();

        // Assert
        Assert.Empty(transport.Calls);

        // Act
        ready.SetResult();
        await Task.WhenAll(show, snapshot, hide);

        // Assert
        Assert.Equal(new[] { "showLoading", "getOption", "hideLoading" }, transport.Calls);

        // Arrange
        await (await snapshot).DisposeAsync();
        transport.Fail = true;

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => chart.ClearAsync().AsTask());

        // Act
        await chart.DisposeAsync();

        // Assert
        await Assert.ThrowsAsync<ObjectDisposedException>(() => chart.GetWidthAsync().AsTask());
    }

    [Fact]
    public async Task InstanceMethods_UseCorrectOverloadAndReturnShape()
    {
        // Arrange
        var transport = new MethodsTransport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act & Assert
        Assert.Equal(12, (await chart.ConvertToPixelAsync(ChartFinder.Component("xAxis"), CoordinateValue.From(2))).Scalar);
        Assert.Equal(new double[] { 12, 34 }, (await chart.ConvertFromPixelAsync(ChartFinder.Component("grid"), [2, 3])).Numbers);

        // Act
        await chart.ShowLoadingAsync("default", new ChartLoadingOptions { Text = "Loading", ShowSpinner = false });

        // Assert
        Assert.Equal("default", transport.Arguments[2][0].GetString());
        Assert.False(transport.Arguments[2][1].GetProperty("showSpinner").GetBoolean());

        // Act & Assert
        Assert.False(await chart.IsSsrAsync());
        Assert.False(await chart.IsDisposedAsync());

        // Act
        await chart.ConvertFromPixelAsync(ChartFinder.Component("matrix"), [double.NaN, 1]);

        // Assert
        Assert.Equal("NaN", transport.Arguments[^1][1][0].GetProperty("$number").GetString());
    }

    [Fact]
    public void Finder_AndCombinesComponentSelectorsWithoutMutation()
    {
        // Arrange
        var x = ChartFinder.Select("xAxis", index: 2);

        // Act & Assert
        Assert.Equal("""{"xAxisIndex":2,"yAxisId":"y1"}""", x.And("yAxis", id: "y1").Json.GetRawText());
        Assert.Equal("""{"xAxisIndex":2}""", x.Json.GetRawText());
        Assert.Equal("""{"geoIndex":0,"seriesIndex":0}""", ChartFinder.Component("geo").And("series").Json.GetRawText());
        Assert.Equal(
            """{"seriesIndex":0,"dataIndex":3,"gridName":["a","b"]}""",
            ChartFinder.Select("series", dataIndex: 3).And("grid", name: EventActionValue.Array("a", "b")).Json.GetRawText());
        Assert.Equal(
            """{"xAxisIndex":"all","yAxisIndex":1,"yAxisName":"right"}""",
            ChartFinder.Select("xAxis", index: "all").And("yAxis", index: 1, name: "right").Json.GetRawText());

        // Arrange
        using var extension = JsonDocument.Parse("""{"customIndex":4}""");

        // Act & Assert
        Assert.Equal("""{"customIndex":4,"polarId":"p"}""", ChartFinder.FromJson(extension.RootElement).And("polar", id: "p").Json.GetRawText());
        Assert.Throws<ArgumentException>(() => x.And("xAxis", index: 1));
        Assert.Throws<ArgumentException>(() => ChartFinder.Select("series", dataIndex: 1).And("data", index: 0));
        Assert.Throws<ArgumentException>(() => x.And("yAxis", index: "first"));
        Assert.Throws<ArgumentException>(() => x.And(" "));
    }

    [Fact]
    public async Task ConvertOptions_AreForwardedAsNativeThirdArgument()
    {
        // Arrange
        var transport = new MethodsTransport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var matrix = ChartFinder.Component("matrix");

        // Act
        await chart.ConvertToPixelAsync(
            matrix,
            CoordinateValue.Array(1, 2),
            new ChartConvertOptions { Clamp = ChartMatrixClamp.Body, IgnoreMergeCells = true });

        // Assert
        Assert.Equal("""{"clamp":2,"ignoreMergeCells":true}""", transport.Arguments[^1][2].GetRawText());

        // Act
        await chart.ConvertFromPixelAsync(matrix, 5, new ChartConvertOptions { Clamp = ChartMatrixClamp.None });

        // Assert
        Assert.Equal("""{"clamp":0}""", transport.Arguments[^1][2].GetRawText());

        // Act
        await chart.ConvertFromPixelAsync(matrix, [1, 2], new ChartConvertOptions { IgnoreMergeCells = false });

        // Assert
        Assert.Equal("""{"ignoreMergeCells":false}""", transport.Arguments[^1][2].GetRawText());

        // Act
        var layout = await chart.ConvertToLayoutAsync(
            matrix,
            CoordinateValue.Array(1, 2),
            new ChartConvertOptions { Clamp = ChartMatrixClamp.Corner });

        // Assert
        Assert.Equal("convertToLayout", transport.Calls[^1]);
        Assert.Equal("""{"clamp":3}""", transport.Arguments[^1][2].GetRawText());
        Assert.Equal(4, layout.Rect!.Height);

        // Act
        await chart.ConvertToLayoutAsync(matrix, CoordinateValue.Array(1, 2), new ChartConvertOptions { Clamp = ChartMatrixClamp.All });

        // Assert
        Assert.Equal("""{"clamp":1}""", transport.Arguments[^1][2].GetRawText());

        // Act
        await chart.ConvertToPixelAsync(ChartFinder.Component("grid"), CoordinateValue.Array(1, 2));

        // Assert
        Assert.Equal(2, transport.Arguments[^1].GetArrayLength());

        // Act
        await chart.ConvertFromPixelAsync(ChartFinder.Component("grid"), 3);

        // Assert
        Assert.Equal(2, transport.Arguments[^1].GetArrayLength());

        // Act & Assert
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => chart.ConvertToPixelAsync(matrix, 1, new ChartConvertOptions { Clamp = (ChartMatrixClamp)7 }).AsTask());
    }

    [Fact]
    public async Task NullOptionArguments_BindWithoutAmbiguity()
    {
        // Arrange
        var transport = new MethodsTransport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        await chart.ShowLoadingAsync(null);

        // Assert
        Assert.Equal("showLoading", transport.Calls[^1]);
        Assert.Equal(0, transport.Arguments[^1].GetArrayLength());

        // Act
        await chart.ConvertToLayoutAsync(ChartFinder.Component("grid"), CoordinateValue.Array(1, 2), null);

        // Assert
        Assert.Equal("convertToLayout", transport.Calls[^1]);
        Assert.Equal(2, transport.Arguments[^1].GetArrayLength());

        // Act & Assert
        await Assert.ThrowsAsync<ArgumentNullException>(() => chart.SetThemeAsync(null!).AsTask());
    }

    [Fact]
    public void UnavailableVisuals_ThrowInsteadOfEmptySuccess()
    {
        // Arrange
        using var json = JsonDocument.Parse("null");

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => new ChartVisual(json.RootElement));
    }

    private sealed class MethodsTransport : IChartCommandTransport, IChartMethodTransport
    {
        internal List<string> Calls = [];
        internal List<JsonElement> Arguments = [];
        internal bool Fail;

        public ValueTask<JsonElement> InvokeMethodAsync(string id, string method, JsonElement arguments, ChartRevision revision)
        {
            Calls.Add(method);
            Arguments.Add(arguments);
            if (Fail)
                throw new InvalidOperationException("native failure");

            using var json = JsonDocument.Parse(
                method == "getOption"
                    ? "{\"value\":{\"series\":[]}}"
                    : method == "convertToPixel"
                        ? "{\"value\":12}"
                        : method == "convertFromPixel"
                            ? "{\"value\":[12,34]}"
                            : method == "convertToLayout" ? "{\"value\":{\"rect\":{\"x\":1,\"y\":2,\"width\":3,\"height\":4}}}" : "{\"value\":null}");
            return ValueTask.FromResult(json.RootElement.Clone());
        }

        public ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken cancellationToken) =>
            ValueTask.CompletedTask;

        public ValueTask DisposeAsync(string id) => ValueTask.CompletedTask;

        public ValueTask<EChartsOptionSnapshot> ReadSnapshotAsync(JsonElement envelope, EChartsSerializationContext context) =>
            ValueTask.FromResult(new EChartsOptionSnapshot(GeneratedOptionMetadata.ReadChartOptions(envelope.GetProperty("value"), context)));

        public ValueTask<EChartsObjectReference> ReadReferenceAsync(JsonElement envelope) => throw new NotSupportedException();

        public ValueTask<ChartVisual> ReadVisualAsync(JsonElement envelope) => ValueTask.FromResult(new ChartVisual(envelope.GetProperty("value")));

        public ValueTask ReleaseResultAsync(JsonElement envelope) => ValueTask.CompletedTask;
    }
}
