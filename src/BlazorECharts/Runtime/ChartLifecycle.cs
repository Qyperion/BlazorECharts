using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

// One component's generation, waiters and browser callback target; never owns the page runtime.
internal sealed class ChartLifecycle(Func<EChartsError, LogLevel, Task> error, Func<Task> removed) : IDisposable
{
    private const int MessageLength = 1024;
    private readonly LogThrottle _browserErrors = new(TimeSpan.FromSeconds(10), 5);
    private CancellationTokenSource _cancellation = new();
    private TaskCompletionSource _size = NewCompletion();
    private TaskCompletionSource<EChartInstance> _ready = NewReady();

    internal ChartState State { get; private set; }
    internal int Generation { get; private set; }
    internal int FailedGeneration { get; private set; }
    internal CancellationToken Token => _cancellation.Token;
    internal Task<EChartInstance> Ready => _ready.Task;
    internal Task Size => _size.Task;

    internal void ResetSize() => _size = NewCompletion();

    internal bool IsCurrent(int generation) => generation == Generation && State is ChartState.Initializing or ChartState.Ready;

    internal int Begin()
    {
        if (State == ChartState.Failed)
        {
            _cancellation.Dispose();
            _cancellation = new();
            _size = NewCompletion();
            _ready = NewReady();
        }

        State = ChartState.Initializing;
        return ++Generation;
    }

    internal void Complete(int generation, EChartInstance instance)
    {
        if (!IsCurrent(generation))
            return;

        State = ChartState.Ready;
        _ready.TrySetResult(instance);
    }

    internal void Fail(int generation, Exception exception)
    {
        if (!IsCurrent(generation))
            return;

        State = ChartState.Failed;
        FailedGeneration = generation;
        _ready.TrySetException(exception);

        // Auto initialization need not have an external waiter.
        _ = _ready.Task.Exception;
    }

    internal void Disposing()
    {
        State = ChartState.Disposing;
        _cancellation.Cancel();
        _ready.TrySetCanceled();
        _size.TrySetCanceled();
    }

    internal void Disposed() => State = ChartState.Disposed;

    [JSInvokable]
    public Task ContainerReady(int generation)
    {
        if (IsCurrent(generation))
            _size.TrySetResult();

        return Task.CompletedTask;
    }

    // The browser reports these without a .NET caller; a client could send any text, so the message is bounded and the rate limited.
    [JSInvokable]
    public Task BrowserError(int generation, string code, string message)
    {
        if (!IsCurrent(generation) || !IsCode(code) || !_browserErrors.TryEnter($"{code}:{generation}", out _))
            return Task.CompletedTask;

        message ??= "";
        if (message.Length > MessageLength)
            message = string.Concat(message.AsSpan(0, MessageLength - 1), "\u2026");

        return error(new(code, message) { Operation = "resize", DetailCode = code }, LogLevel.Warning);
    }

    private static bool IsCode(string? code) => code is { Length: > 0 and <= 64 } && code.All(char.IsAsciiLetter);

    [JSInvokable] public Task BrowserRemoved(int generation) => IsCurrent(generation) ? removed() : Task.CompletedTask;

    public void Dispose() => _cancellation.Dispose();

    private static TaskCompletionSource NewCompletion() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static TaskCompletionSource<EChartInstance> NewReady() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
