using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;
using Xunit;

namespace BlazorECharts.Tests.WordCloud;

public sealed class WordCloudLifecycleContractTests
{
    private static EChartInstance Chart(Transport transport)
    {
        var context = GeneratedOptionMetadata.CreateContext();
        WordCloudTypeRegistration.Register(context);
        return new("wordcloud", transport, context);
    }

    private static ChartOptions Options(string word) => new()
    {
        Animation = false,
        Series = OneOrMany<SeriesOption>.One(new WordCloudSeriesOption
        {
            LayoutAnimation = true,
            Data = [new WordCloudDataItem { Name = word, Value = 1 }],
        }),
    };

    [Fact]
    public async Task WordCloudExport_AcceptedUpdateInvalidatesEarlierCapture()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = Chart(transport);
        await chart.SetOptionAsync(Options("Початковий"));

        // Act
        var export = chart.GetDataUrlAsync().AsTask();
        await transport.Started.Task;
        await chart.SetOptionAsync(Options("Останній"));
        transport.First.SetResult(Parse("{\"value\":\"old image\"}"));

        // Assert
        Assert.Equal("latest image", await export);
        Assert.Equal(2, transport.Exports);
        Assert.Equal("Останній", transport.LastOption.GetProperty("series").GetProperty("data")[0].GetProperty("name").GetString());
        Assert.True(transport.LastOption.GetProperty("series").GetProperty("layoutAnimation").GetBoolean());
        Assert.True(transport.Timeouts[1] <= transport.Timeouts[0]);
    }

    [Fact]
    public async Task WordCloudWait_CancellationLeavesUpdateQueueUsable()
    {
        // Arrange
        var transport = new Transport();
        await using var chart = Chart(transport);
        await chart.SetOptionAsync(Options("Україна"));
        using var cancellation = new CancellationTokenSource();

        // Act
        var wait = chart.AwaitStableAsync(cancellationToken: cancellation.Token).AsTask();
        await transport.Started.Task;
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => wait);

        // Act
        await chart.SetOptionAsync(Options("ПісляСкасування"));

        // Assert
        Assert.Equal(2, transport.Updates);
    }

    [Fact]
    public async Task WordCloudWait_DisposalRejectsPendingExport()
    {
        // Arrange
        var transport = new Transport();
        var chart = Chart(transport);
        await chart.SetOptionAsync(Options("Слово"));

        // Act
        var wait = chart.RenderToSvgStringAsync().AsTask();
        await transport.Started.Task;
        await chart.DisposeAsync();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => wait);
        Assert.Equal(1, transport.Disposals);
    }

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private sealed class Transport : IChartCommandTransport, IChartExportTransport
    {
        internal readonly TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource<JsonElement> First = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal JsonElement LastOption;
        internal int Exports;
        internal int Updates;
        internal int Disposals;
        internal readonly List<double> Timeouts = [];

        public ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken token)
        {
            Updates++;
            LastOption = option.Json;
            return ValueTask.CompletedTask;
        }

        public ValueTask DisposeAsync(string id)
        {
            Disposals++;
            return ValueTask.CompletedTask;
        }

        public async ValueTask<JsonElement> InvokeExportAsync(string id, string method, PreparedOption args, double timeout, CancellationToken token)
        {
            Exports++;
            Timeouts.Add(timeout);
            Started.TrySetResult();
            return Exports == 1 ? await First.Task.WaitAsync(token) : Parse("{\"value\":\"latest image\"}");
        }
    }
}
