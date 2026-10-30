using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class ExportContractTests
{
    [Fact]
    public async Task Export_FollowsAcceptedUpdatesWithoutHoldingTheQueue()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var result = chart.GetDataUrlAsync(new() { Type = ChartImageFormat.Jpeg, PixelRatio = 2, ExcludeComponents = ["title"] }).AsTask();
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));
        await chart.SetOptionAsync(new ChartOptions());
        transport.First.SetResult(Parse("{\"value\":\"stale\"}"));

        // Assert
        Assert.Equal("latest", await result);
        Assert.Equal(2, transport.Calls.Count);
        Assert.True(transport.Timeouts[1] <= transport.Timeouts[0]);
        var options = transport.Calls[0][0];
        Assert.Equal("jpeg", options.GetProperty("type").GetString());
        Assert.Equal(2, options.GetProperty("pixelRatio").GetInt32());
        Assert.Equal("title", options.GetProperty("excludeComponents")[0].GetString());
        Assert.Equal(1, transport.Updates);
    }

    [Fact]
    public async Task Export_CancellationDoesNotBlockLaterCommands()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        using var cancellation = new CancellationTokenSource();

        // Act
        var result = chart.AwaitStableAsync(cancellationToken: cancellation.Token).AsTask();
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => result);

        // Act
        await chart.SetOptionAsync(new ChartOptions());

        // Assert
        Assert.Equal(1, transport.Updates);
    }

    [Fact]
    public async Task Export_DisposeCancelsPendingWait()
    {
        // Arrange
        var transport = new Transport();
        var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var result = chart.GetDataUrlAsync().AsTask();
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));
        await chart.DisposeAsync();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => result);
    }

    [Fact]
    public async Task Stability_ValidatesBoundedTimeoutAndIncludesReadinessInDeadline()
    {
        // Act & Assert
        Assert.Throws<ArgumentOutOfRangeException>(() => new ChartStabilityOptions { Timeout = TimeSpan.FromMilliseconds(-1) });
        Assert.Throws<ArgumentOutOfRangeException>(() => new ChartStabilityOptions { Timeout = TimeSpan.MaxValue });

        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        chart.WaitForReadiness(new TaskCompletionSource().Task);

        // Act & Assert
        await Assert.ThrowsAsync<TimeoutException>(() => chart.AwaitStableAsync(new() { Timeout = TimeSpan.FromMilliseconds(30) }).AsTask());
        Assert.Empty(transport.Calls);
    }

    [Fact]
    public void Stability_ZeroTimeoutIsRejected()
    {
        // Act
        var error = Assert.Throws<ArgumentOutOfRangeException>(() => new ChartStabilityOptions { Timeout = TimeSpan.Zero });

        // Assert
        Assert.Contains("greater than zero", error.Message, StringComparison.Ordinal);
        Assert.Equal(TimeSpan.FromMilliseconds(1), new ChartStabilityOptions { Timeout = TimeSpan.FromMilliseconds(1) }.Timeout);
    }

    [Fact]
    public async Task Stability_BrowserDeadlineSurfacesAsTimeoutException()
    {
        // Under load the browser timer can expire before the managed one; both must report the same failure.

        // Arrange
        var transport = new Transport
        {
            Failure = new JSException("[StabilityTimeout] The chart stability timeout elapsed before capture.\nEChartsError: [StabilityTimeout] at exports.js"),
        };
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var error = await Assert.ThrowsAsync<TimeoutException>(() => chart.AwaitStableAsync(new() { Timeout = TimeSpan.FromSeconds(5) }).AsTask());

        // Assert
        Assert.IsType<JSException>(error.InnerException);
        await Assert.ThrowsAsync<TimeoutException>(() => chart.GetDataUrlAsync().AsTask());

        // Arrange
        transport.Failure = new JSException("[ExportFailed] synthetic");

        // Act & Assert
        await Assert.ThrowsAsync<JSException>(() => chart.GetDataUrlAsync().AsTask());
    }

    [Fact]
    public async Task Export_PreservesNativeOptionsAndErrors()
    {
        // Arrange
        var transport = new Transport { Immediate = true };
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        await chart.GetConnectedDataUrlAsync(new() { Type = ChartImageFormat.Svg, ConnectedBackgroundColor = "white", ExcludeComponents = [] });
        await chart.RenderToSvgStringAsync(new() { UseViewBox = false });
        await chart.GetSvgDataUrlAsync();

        // Assert
        Assert.Equal("white", transport.Calls[0][0].GetProperty("connectedBackgroundColor").GetString());
        Assert.Equal(0, transport.Calls[0][0].GetProperty("excludeComponents").GetArrayLength());
        Assert.False(transport.Calls[1][0].GetProperty("useViewBox").GetBoolean());
        Assert.Equal(0, transport.Calls[2].GetArrayLength());

        // Arrange
        transport.Failure = new InvalidOperationException("unsupported renderer");

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => chart.GetDataUrlAsync().AsTask());
    }

    [Fact]
    public async Task Export_ConcurrentWaitsDoNotInvalidateEachOther()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var first = chart.GetDataUrlAsync().AsTask();
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));

        // Act & Assert
        Assert.Equal("latest", await chart.GetDataUrlAsync());

        // Act
        transport.First.SetResult(Parse("{\"value\":\"first\"}"));

        // Assert
        Assert.Equal("first", await first);
        Assert.Equal(2, transport.Calls.Count);
    }

    [Fact]
    public async Task Export_ReadOnlyMethodsDoNotInvalidateCapture()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var first = chart.GetDataUrlAsync().AsTask();
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));

        // Act & Assert
        Assert.Equal(320, await chart.GetWidthAsync());

        // Act
        transport.First.SetResult(Parse("{\"value\":\"first\"}"));

        // Assert
        Assert.Equal("first", await first);
        Assert.Single(transport.Calls);
    }

    [Fact]
    public async Task Export_MemberPreparationCanBeCancelledWithoutLeavingAQueueWaiter()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        chart.WaitForReadiness(new TaskCompletionSource().Task);

        // Act
        var preparing = chart.ExportReference.Value.Prepare("operation", 30_000);
        chart.ExportReference.Value.CancelPrepare("operation");

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => preparing);

        // Act
        chart.WaitForReadiness(Task.CompletedTask);
        await chart.SetOptionAsync(new ChartOptions());

        // Assert
        Assert.Equal(1, transport.Updates);
    }

    [Fact]
    public async Task Export_CancelledCanvasReleasesLateResult()
    {
        // Arrange
        var transport = new Transport { IgnoreCancellation = true };
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        using var cancellation = new CancellationTokenSource();

        // Act
        var result = chart.RenderToCanvasAsync(cancellationToken: cancellation.Token).AsTask();
        await transport.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => result);

        // Act
        transport.First.SetResult(Parse("{\"value\":null,\"leaseId\":\"late\"}"));
        await transport.Released.Task.WaitAsync(TimeSpan.FromSeconds(3));

        // Assert
        Assert.Equal(1, transport.ReleaseCount);
    }

    [Fact]
    public async Task Export_OfAChartUpdatedDuringEveryCapture_TimesOutUntilUpdatesPause()
    {
        // Arrange
        var transport = new Transport { Immediate = true };
        await using var chart = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var updating = true;
        transport.DuringCapture = () => updating ? chart.SetOptionAsync(new ChartOptions()).AsTask() : Task.CompletedTask;

        // Act & Assert
        await Assert.ThrowsAsync<TimeoutException>(
            () => chart.GetDataUrlAsync(stability: new() { Timeout = TimeSpan.FromMilliseconds(200) }).AsTask());
        Assert.True(transport.Calls.Count > 1);

        // Arrange
        updating = false;

        // Act & Assert
        Assert.Equal("latest", await chart.GetDataUrlAsync());
    }

    [Fact]
    public void ExportOptions_AreIndependentSealedContracts()
    {
        // Act & Assert
        foreach (var type in new[]
        {
            typeof(ChartCanvasExportOptions),
            typeof(ChartDataUrlOptions),
            typeof(ChartConnectedDataUrlOptions),
            typeof(ChartSvgExportOptions),
        })
        {
            Assert.True(type.IsSealed, type.Name);
            Assert.Equal(typeof(object), type.BaseType);
        }

        // Arrange
        var context = GeneratedOptionMetadata.CreateContext();

        string Write(object value) => MethodJson.Create(w => context.WriteValue(w, value, "$")).GetRawText();

        // Act & Assert
        Assert.Equal("""{"backgroundColor":"red","pixelRatio":2}""", Write(new ChartCanvasExportOptions { BackgroundColor = "red", PixelRatio = 2 }));
        Assert.Equal("""{"backgroundColor":"red","pixelRatio":2,"type":"png","excludeComponents":["toolbox"]}""",
            Write(new ChartDataUrlOptions { BackgroundColor = "red", PixelRatio = 2, Type = ChartImageFormat.Png, ExcludeComponents = ["toolbox"] }));
        Assert.Equal("""{"backgroundColor":"red","pixelRatio":2,"type":"jpeg","excludeComponents":[],"connectedBackgroundColor":"white"}""",
            Write(
                new ChartConnectedDataUrlOptions
                {
                    BackgroundColor = "red",
                    PixelRatio = 2,
                    Type = ChartImageFormat.Jpeg,
                    ExcludeComponents = [],
                    ConnectedBackgroundColor = "white",
                }));
    }

    private static JsonElement Parse(string json)
    {
        using var d = JsonDocument.Parse(json);
        return d.RootElement.Clone();
    }

    private sealed class Transport : IChartCommandTransport, IChartExportTransport, IChartMethodTransport
    {
        internal readonly List<JsonElement> Calls = [];
        internal readonly List<double> Timeouts = [];
        internal readonly TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource<JsonElement> First = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource Released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal int Updates;
        internal int ReleaseCount;
        internal bool Immediate;
        internal bool IgnoreCancellation;
        internal Exception? Failure;
        internal Func<Task>? DuringCapture;

        public async ValueTask<JsonElement> InvokeExportAsync(string id, string method, PreparedOption args, double timeout, CancellationToken token)
        {
            Calls.Add(args.Json.GetProperty("args"));
            Timeouts.Add(timeout);
            Started.TrySetResult();
            if (Failure is not null)
                throw Failure;

            if (DuringCapture is not null)
                await DuringCapture();

            return Calls.Count == 1 && !Immediate
                ? await First.Task.WaitAsync(IgnoreCancellation ? CancellationToken.None : token)
                : Parse("{\"value\":\"latest\"}");
        }

        public ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken cancellationToken)
        {
            Updates++;
            return ValueTask.CompletedTask;
        }

        public ValueTask DisposeAsync(string id) => ValueTask.CompletedTask;

        public ValueTask<JsonElement> InvokeMethodAsync(string id, string method, JsonElement arguments, ChartRevision revision) =>
            ValueTask.FromResult(Parse("{\"value\":320}"));

        public ValueTask<EChartsOptionSnapshot> ReadSnapshotAsync(JsonElement envelope, EChartsSerializationContext context) =>
            throw new NotSupportedException();

        public ValueTask<EChartsObjectReference> ReadReferenceAsync(JsonElement envelope) => throw new NotSupportedException();

        public ValueTask<ChartVisual> ReadVisualAsync(JsonElement envelope) => throw new NotSupportedException();

        public ValueTask ReleaseResultAsync(JsonElement envelope)
        {
            ReleaseCount++;
            Released.TrySetResult();
            return ValueTask.CompletedTask;
        }
    }
}
