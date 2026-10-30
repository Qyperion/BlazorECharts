using System.Text.Json;
using Microsoft.JSInterop;

namespace BlazorECharts.Events;

/// <summary>Owns exactly one native listener and managed callback reference.</summary>
public abstract class ChartSubscription : IAsyncDisposable
{
    private readonly object _gate = new();
    private readonly Func<ChartSubscription, ValueTask> _release;
    private Func<JsonElement, JsonElement, Task> _handler;
    private Task? _disposal;
    private bool _active = true;
    private long _epoch;
    private readonly TaskCompletionSource _registration = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private protected ChartSubscription(Func<JsonElement, JsonElement, Task> handler, Func<ChartSubscription, ValueTask> release, long epoch)
    {
        _handler = handler;
        _release = release;
        _epoch = epoch;
        Reference = DotNetObjectReference.Create(new Delivery(this));
    }

    /// <summary>Gets the unique subscription identity.</summary>
    public string Id { get; } = Guid.NewGuid().ToString("N");

    internal DotNetObjectReference<Delivery> Reference { get; }
    internal int ThrottleMilliseconds { get; init; }

    private protected void Replace(Func<JsonElement, JsonElement, Task> handler)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(!_active, this);
            _handler = handler;
        }
    }

    private Task Deliver(string id, long epoch, JsonElement json, JsonElement references)
    {
        Func<JsonElement, JsonElement, Task> handler;
        lock (_gate)
        {
            if (!_active || id != Id || epoch != _epoch)
                return Task.CompletedTask;

            handler = _handler;
        }

        return handler(json, references);
    }

    internal void AdvanceEpoch(long epoch)
    {
        lock (_gate)
            _epoch = epoch;
    }

    internal void Deactivate()
    {
        lock (_gate)
            _active = false;
    }

    internal void Registered() => _registration.TrySetResult();

    /// <summary>Unregisters only this listener and releases its managed reference once.</summary>
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource completion;
        lock (_gate)
        {
            if (_disposal is not null)
                return new(_disposal);

            _active = false;
            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _disposal = completion.Task;
        }

        _ = ReleaseAsync(completion);
        return new(completion.Task);
    }

    private async Task ReleaseAsync(TaskCompletionSource completion)
    {
        try
        {
            await _registration.Task.ConfigureAwait(false);
            await _release(this).ConfigureAwait(false);
            completion.SetResult();
        }
        catch (Exception e)
        {
            completion.SetException(e);
        }
        finally
        {
            Reference.Dispose();
        }
    }

    /// <summary>The browser's callback target, so that the delivery protocol stays out of the public subscription.</summary>
    internal sealed class Delivery(ChartSubscription subscription)
    {
        /// <summary>Awaits the current handler. Its exception rejects the browser invocation and reaches the browser
        /// error channel.</summary>
        [JSInvokable]
        public Task Deliver(string id, long epoch, JsonElement json, JsonElement references) => subscription.Deliver(id, epoch, json, references);
    }
}

/// <summary>A subscription whose handler receives typed <typeparamref name="TEvent"/> payloads.</summary>
public sealed class ChartSubscription<TEvent> : ChartSubscription
{
    private readonly Func<Func<TEvent, Task>, Func<JsonElement, JsonElement, Task>> _wrap;

    internal ChartSubscription(Func<TEvent, Task> handler, Func<Func<TEvent, Task>, Func<JsonElement, JsonElement, Task>> wrap,
        Func<ChartSubscription, ValueTask> release, long epoch) : base(wrap(handler), release, epoch) => _wrap = wrap;

    /// <summary>Atomically replaces the handler without registering a second listener.</summary>
    public void ReplaceHandler(Func<TEvent, Task> handler)
    {
        ArgumentNullException.ThrowIfNull(handler);
        Replace(_wrap(handler));
    }
}
