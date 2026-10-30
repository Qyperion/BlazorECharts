using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class ChartCommandQueueTests
{
    [Fact]
    public async Task CancellationWhileAwaitingReadiness_DoesNotDispatchAfterReady()
    {
        // Arrange
        var transport = new ControlledTransport();
        await using var chart = new EChartInstance("a", transport, GeneratedOptionMetadata.CreateContext());
        var readiness = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        chart.WaitForReadiness(readiness.Task);
        using var cancellation = new CancellationTokenSource();

        // Act
        var cancelled = chart.SetOptionAsync(new ChartOptions(), cancellationToken: cancellation.Token).AsTask();
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);

        // Act
        readiness.SetResult();
        transport.First.SetResult();
        await chart.SetOptionAsync(new ChartOptions { Animation = false });

        // Assert
        Assert.Single(transport.Calls);
        Assert.False(transport.Calls[0].GetProperty("animation").GetBoolean());
    }

    [Fact]
    public async Task Queue_BurstCoalescesOnlySupersededDeclarative()
    {
        // Arrange
        using var queue = new ChartCommandQueue();
        var block = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var applied = new List<int>();
        var first = queue.Enqueue(async (_, _) => await block.Task).AsTask();

        // Act
        var superseded = new List<Task>();
        for (var i = 0; i < 1000; i++)
        {
            var value = i;
            superseded.Add(queue.Enqueue((_, _) =>
            {
                applied.Add(value);
                return ValueTask.CompletedTask;
            }, declarative: true, replaces: true).AsTask());
        }

        // Assert
        Assert.Equal(1, queue.PendingCount);

        // Act
        var imperative = queue.Enqueue((_, _) =>
        {
            applied.Add(-1);
            return ValueTask.CompletedTask;
        }).AsTask();
        var tail = queue.Enqueue((_, _) =>
        {
            applied.Add(1001);
            return ValueTask.CompletedTask;
        }, declarative: true, replaces: true).AsTask();
        block.SetResult();
        await Task.WhenAll(first, superseded[^1], imperative, tail);

        // Assert
        Assert.Equal(new[] { 999, -1, 1001 }, applied);
        Assert.All(superseded[..^1], task => Assert.True(task.IsCanceled));
        Assert.Equal(1003, queue.CompletedRevision);
    }

    [Fact]
    public async Task DefaultMergeAndImperativeCommands_AreNeverCoalesced_AndOverflowRejectsExplicitly()
    {
        // Arrange
        using var queue = new ChartCommandQueue();
        var block = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = queue.Enqueue(async (_, _) => await block.Task).AsTask();
        var applied = new List<int>();

        // Act
        var pending = Enumerable.Range(0, 64).Select(i => queue.Enqueue((_, _) =>
        {
            applied.Add(i);
            return ValueTask.CompletedTask;
        }, declarative: i % 2 == 0).AsTask()).ToArray();

        // Act & Assert
        Assert.ThrowsAny<InvalidOperationException>(() => queue.Enqueue((_, _) => ValueTask.CompletedTask));

        // Act
        block.SetResult();
        await Task.WhenAll(pending.Append(first));

        // Assert
        Assert.Equal(Enumerable.Range(0, 64), applied);
    }

    [Fact]
    public async Task DisposeOrRetry_RejectsStaleGenerationCompletion()
    {
        // Arrange
        using var queue = new ChartCommandQueue();
        var block = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = queue.Enqueue(async (_, _) =>
        {
            entered.SetResult();
            await block.Task;
        }).AsTask();
        await entered.Task;

        // Act
        queue.Dispose();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);

        // Act
        block.SetResult();

        // Assert
        Assert.Equal(0, queue.CompletedRevision);
        Assert.Throws<ObjectDisposedException>(() => queue.Enqueue((_, _) => ValueTask.CompletedTask));
    }

    [Fact]
    public async Task Recreation_IncrementsGeneration_WithoutResettingRevision_AndTransfersPendingCommands()
    {
        // Arrange
        using var queue = new ChartCommandQueue();
        var stamps = new List<ChartRevision>();

        // Act
        await queue.Enqueue((stamp, _) =>
        {
            stamps.Add(stamp);
            return ValueTask.CompletedTask;
        });
        await queue.Enqueue((stamp, _) =>
        {
            stamps.Add(stamp);
            return ValueTask.CompletedTask;
        }, recreate: true);
        await queue.Enqueue((stamp, _) =>
        {
            stamps.Add(stamp);
            return ValueTask.CompletedTask;
        });

        // Assert
        Assert.Equal(new[] { new ChartRevision(1, 1, 1), new(2, 2, 2), new(2, 3, 3) }, stamps);
    }

    [Fact]
    public async Task TypedAndRawCommands_AreSerialized_AndCaptureInputAtAcceptance()
    {
        // Arrange
        var transport = new ControlledTransport();
        await using var chart = new EChartInstance("a", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        var first = chart.SetOptionAsync(new ChartOptions { Animation = false }).AsTask();
        using var document = JsonDocument.Parse("{\"marker\":2}");
        var second = chart.SetOptionAsync(document.RootElement).AsTask();

        // Assert
        Assert.Single(transport.Calls);
        Assert.False(second.IsCompleted);

        // Act
        transport.First.SetResult();
        await Task.WhenAll(first, second);

        // Assert
        Assert.Equal(2, transport.Calls.Count);
        Assert.Equal(2, transport.Calls[1].GetProperty("marker").GetInt32());
    }

    [Fact]
    public async Task CancellationAfterDispatch_DoesNotOvertakeRunningCommand()
    {
        // Arrange
        var transport = new ControlledTransport();
        await using var chart = new EChartInstance("a", transport, GeneratedOptionMetadata.CreateContext());
        using var cancellation = new CancellationTokenSource();

        // Act
        var first = chart.SetOptionAsync(new ChartOptions(), cancellationToken: cancellation.Token).AsTask();
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);

        // Act
        var second = chart.SetOptionAsync(new ChartOptions()).AsTask();

        // Assert
        Assert.Single(transport.Calls);

        // Act
        transport.First.SetResult();
        await second;

        // Assert
        Assert.Equal(2, transport.Calls.Count);
    }

    [Fact]
    public void InlineContinuations_ResumeTheCallerWhenTheCommandCompletes()
    {
        // In the browser a thread-pool hop is a setTimeout(0), clamped to 4 ms in a chain of awaited updates.

        // Arrange
        using var queue = new ChartCommandQueue(inlineContinuations: true);
        var release = new TaskCompletionSource();
        var command = queue.Enqueue(async (_, _) => await release.Task.ConfigureAwait(false)).AsTask();
        var resumed = false;
        _ = command.ContinueWith(_ => resumed = true, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);

        // Act
        release.SetResult();

        // Assert
        Assert.True(command.IsCompletedSuccessfully);
        Assert.True(resumed);
    }

    [Fact]
    public async Task InlineContinuations_SupersededCallerResumesAfterItsReplacementIsQueued()
    {
        // Arrange
        using var queue = new ChartCommandQueue(inlineContinuations: true);
        var block = new TaskCompletionSource();
        var applied = new List<string>();
        Func<ChartRevision, CancellationToken, ValueTask> Apply(string name) => (_, _) =>
        {
            applied.Add(name);
            return ValueTask.CompletedTask;
        };

        var first = queue.Enqueue(async (_, _) => await block.Task.ConfigureAwait(false)).AsTask();
        var patch = queue.Enqueue(Apply("patch"), declarative: true).AsTask();
        Task? retry = null;
        _ = patch.ContinueWith(_ => retry = queue.Enqueue(Apply("retry")).AsTask(), CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);

        // Act
        var replacement = queue.Enqueue(Apply("replacement"), declarative: true, replaces: true).AsTask();
        block.SetResult();
        await Task.WhenAll(first, replacement, retry!);

        // Assert
        Assert.True(patch.IsCanceled);
        Assert.Equal(["replacement", "retry"], applied);
    }

    [Fact]
    public async Task InlineContinuations_DisposeFromACallerStopsTheQueue()
    {
        // Arrange
        using var queue = new ChartCommandQueue(inlineContinuations: true);
        var release = new TaskCompletionSource();
        var applied = false;
        var first = queue.Enqueue(async (_, _) => await release.Task.ConfigureAwait(false)).AsTask();
        var second = queue.Enqueue((_, _) =>
        {
            applied = true;
            return ValueTask.CompletedTask;
        }).AsTask();
        _ = first.ContinueWith(_ => queue.Dispose(), CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);

        // Act
        release.SetResult();

        // Assert
        Assert.True(first.IsCompletedSuccessfully);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => second);
        Assert.False(applied);
        Assert.Equal(0, queue.PendingCount);
    }

    private sealed class ControlledTransport : IChartCommandTransport
    {
        public TaskCompletionSource First { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public List<JsonElement> Calls { get; } = [];

        public async ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken cancellationToken)
        {
            Calls.Add(option.Json);
            if (Calls.Count == 1)
                await First.Task.WaitAsync(cancellationToken);
        }

        public ValueTask DisposeAsync(string id) => ValueTask.CompletedTask;
    }
}
