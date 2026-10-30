using BlazorECharts.Runtime;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class CommandQueueSlotTests
{
    [Fact]
    public async Task FullQueue_RejectsSynchronouslyAndSignalsTheNextFreeSlot()
    {
        // Arrange
        using var queue = new ChartCommandQueue();
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var commands = Enumerable.Range(0, 65).Select(_ => queue.Enqueue(async (_, _) => await gate.Task, declarative: true).AsTask()).ToArray();

        // Act & Assert
        Assert.Throws<ChartQueueFullException>(() => { _ = queue.Enqueue((_, _) => ValueTask.CompletedTask, declarative: true); });

        // Act
        var slot = queue.WaitForSlotAsync();

        // Assert
        Assert.False(slot.IsCompleted);

        // Act
        gate.SetResult();

        // Assert
        await slot.WaitAsync(TimeSpan.FromSeconds(5));
        await Task.WhenAll(commands).WaitAsync(TimeSpan.FromSeconds(5));
    }
}
