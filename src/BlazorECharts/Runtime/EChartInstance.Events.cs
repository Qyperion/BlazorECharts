using System.Text.Json;
using BlazorECharts.Events;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace BlazorECharts.Runtime;

public partial class EChartInstance
{
    internal ILogger Logger { get; init; } = NullLogger.Instance;

    private readonly LogThrottle _handlerFailures = new(TimeSpan.FromSeconds(10), 5);
    private readonly Dictionary<string, ChartSubscription> _subscriptions = [];
    private long _eventEpoch;

    /// <summary>Subscribes only on request. Native queries retain ECharts semantics; handler Tasks are awaited outside
    /// the chart command queue.</summary>
    public async ValueTask<ChartSubscription<TEvent>> SubscribeAsync<TEvent>(
        ChartEvent<TEvent> descriptor,
        Func<TEvent, Task> handler,
        EventQuery? query = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(handler);
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        if (_transport is not IChartEventTransport transport)
            throw new NotSupportedException("The transport does not support events.");

        ChartSubscription<TEvent>? subscription = null;

        // The failure still rejects the browser delivery, which raises EventHandlerFailed on the chart container.
        Func<JsonElement, JsonElement, Task> Wrap(Func<TEvent, Task> value) => async (json, references) =>
        {
            try
            {
                var data = descriptor.Read(json);
                if (data is ChartEventPayload payload)
                    payload.NativeReferences = references.Clone();

                await value(data).ConfigureAwait(false);
            }
            catch (Exception error)
            {
                LogHandlerFailure(descriptor.Name, subscription?.Id, error);
                throw;
            }
        };

        try
        {
            // Subscription acceptance is a barrier with option/recreate commands.
            // Cancellation waits for actual registration before disposing the reference.
            await _commands.Enqueue(async (_, token) =>
            {
                using var waiting = CancellationTokenSource.CreateLinkedTokenSource(token, cancellationToken);
                await _readiness.WaitAsync(waiting.Token).ConfigureAwait(false);
                waiting.Token.ThrowIfCancellationRequested();
                EnsureActive();
                lock (_gate)
                {
                    EnsureActive();
                    subscription = new(handler, Wrap, ReleaseSubscriptionAsync, _eventEpoch)
                    {
                        ThrottleMilliseconds = query?.ThrottleMilliseconds ?? 0,
                    };
                    _subscriptions.Add(subscription.Id, subscription);
                }

                try
                {
                    await transport.SubscribeAsync(Id, subscription, descriptor.Name, query?.Json ?? NullJson).ConfigureAwait(false);
                }
                finally
                {
                    subscription.Registered();
                }
            }, renders: false).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            return subscription!;
        }
        catch
        {
            if (subscription is not null)
                await subscription.DisposeAsync().ConfigureAwait(false);

            throw;
        }
    }

    private void LogHandlerFailure(string name, string? subscription, Exception error)
    {
        if (!Logger.IsEnabled(LogLevel.Error) || !_handlerFailures.TryEnter($"{name}:{subscription}", out var suppressed))
            return;

        if (suppressed == 0)
            Logger.LogError(
                error,
                "EChart event handler for {Event} failed (chart {ChartId}, subscription {SubscriptionId}).",
                name,
                Id,
                subscription);
        else
            Logger.LogError(
                error,
                "EChart event handler for {Event} failed (chart {ChartId}, subscription {SubscriptionId}); {Suppressed} similar failures were not logged.",
                name,
                Id,
                subscription,
                suppressed);
    }

    private static readonly JsonElement NullJson = JsonDocument.Parse("null").RootElement.Clone();

    private async ValueTask ReleaseSubscriptionAsync(ChartSubscription subscription)
    {
        try
        {
            if (_transport is IChartEventTransport transport)
                await transport.UnsubscribeAsync(Id, subscription.Id).ConfigureAwait(false);
        }
        finally
        {
            lock (_gate)
                _subscriptions.Remove(subscription.Id);
        }
    }

    private long AdvanceEventEpoch()
    {
        lock (_gate)
        {
            ++_eventEpoch;
            foreach (var subscription in _subscriptions.Values)
                subscription.AdvanceEpoch(_eventEpoch);

            return _eventEpoch;
        }
    }

    private void RestoreEventEpoch(long epoch)
    {
        lock (_gate)
        {
            _eventEpoch = epoch;
            foreach (var subscription in _subscriptions.Values)
                subscription.AdvanceEpoch(epoch);
        }
    }
}
