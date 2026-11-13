using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
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
        if (descriptor.Name.StartsWith(ZrEvents.Prefix, StringComparison.Ordinal) && query is { Json.ValueKind: not JsonValueKind.Null })
            throw new ArgumentException("ZRender events take no query; use EventQuery.Throttled for a throttle.", nameof(query));

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

        await RegisterAsync(
            transport,
            descriptor.Name,
            query,
            epoch => subscription = new(handler, Wrap, ReleaseSubscriptionAsync, epoch) { ThrottleMilliseconds = query?.ThrottleMilliseconds ?? 0 },
            cancellationToken).ConfigureAwait(false);
        return subscription!;
    }

    /// <summary>Subscribes a browser function to an event. It runs in the browser with the native event and the
    /// native chart, and no call reaches .NET: use it where a round trip is too slow or the handler needs the chart at
    /// once, for example to restart a timeline that ended.</summary>
    /// <remarks>The function runs inside the native event dispatch and outside the chart command queue. Its exception,
    /// or the rejection of a promise it returns, raises <c>EventHandlerFailed</c> on the browser error event. An inline
    /// function requires <c>AllowInlineJavaScript</c>. The subscription follows the chart through a recreation.</remarks>
    public async ValueTask<ChartSubscription> SubscribeAsync<TEvent>(
        ChartEvent<TEvent> descriptor,
        JsFunction<ChartEventHandlerSignature> handler,
        EventQuery? query = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(handler);
        if (descriptor.Name.StartsWith(ZrEvents.Prefix, StringComparison.Ordinal) && query is { Json.ValueKind: not JsonValueKind.Null })
            throw new ArgumentException("ZRender events take no query; use EventQuery.Throttled for a throttle.", nameof(query));

        if (handler.Kind == JsBindingKind.Inline && !_serialization.AllowInlineJavaScript)
            throw new InvalidOperationException("An inline event handler requires AllowInlineJavaScript=true. Use JsFunction.Module for the default module policy.");

        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        if (_transport is not IChartEventTransport transport)
            throw new NotSupportedException("The transport does not support events.");

        var binding = new JsBinding(JsBindingPath.Root.Append("handler"), "handler", handler);
        ChartSubscription? subscription = null;
        await RegisterAsync(
            transport,
            descriptor.Name,
            query,
            epoch => subscription = new BrowserChartSubscription(ReleaseSubscriptionAsync, epoch)
            {
                ThrottleMilliseconds = query?.ThrottleMilliseconds ?? 0,
                BrowserHandler = binding,
            },
            cancellationToken).ConfigureAwait(false);
        return subscription!;
    }

    private async ValueTask RegisterAsync(
        IChartEventTransport transport,
        string name,
        EventQuery? query,
        Func<long, ChartSubscription> create,
        CancellationToken cancellationToken)
    {
        ChartSubscription? subscription = null;
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
                    subscription = create(_eventEpoch);
                    _subscriptions.Add(subscription.Id, subscription);
                }

                try
                {
                    await transport.SubscribeAsync(Id, subscription, name, query?.Json ?? NullJson).ConfigureAwait(false);
                }
                finally
                {
                    subscription.Registered();
                }
            }, renders: false).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
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
