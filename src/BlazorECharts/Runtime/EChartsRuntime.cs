using System.Runtime.CompilerServices;
using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

/// <summary>A scoped interop facade. Shared runtime and extension registrations belong to the browser page.</summary>
public sealed partial class EChartsRuntime
    : IAsyncDisposable, IDisposable, IChartCommandTransport, IChartRevisionTransport, IChartRecreationTransport, IChartEventTransport
{
    private readonly IJSRuntime _js;
    private readonly NavigationManager _navigation;
    private readonly EChartsRuntimeOptions _options;
    private readonly object _gate = new();

    // Allocations and runtime calls in flight. Disposal waits for them; they do not wait for each other.
    private int _handleUses;

    private TaskCompletionSource? _handleUsesEnded;
    private readonly Dictionary<string, EChartInstance> _instances = [];
    private readonly string _ownerId = Guid.NewGuid().ToString("N");
    private Task? _initialization;
    private Task? _disposal;
    private IJSObjectReference? _module;
    private int _moduleImportAttempts;

    // Interactive Server: results and events cross the circuit's SignalR connection. WebAssembly and Hybrid hosts run in-process.
    internal bool Server { get; init; }

    // Set by AddECharts; a facade constructed directly logs nothing.
    internal ILoggerFactory? Loggers { get; init; }

    // The .NET interop protocol of runtime-loader.js (runtime-protocol.ts): openFacade receives it first and rejects another one.
    internal const int RuntimeProtocol = 3;

    private ResourceAssetCollection? _assets;

    // The static asset map of the host. With MapStaticAssets the loader URL carries its content fingerprint, so the module
    // of a new deployment is never the one an open page already holds.
    internal void UseAssets(ResourceAssetCollection assets)
    {
        lock (_gate)
            _assets ??= assets;
    }

    private ILogger? _instanceLogger;

    private ILogger InstanceLogger => _instanceLogger ??= Loggers?.CreateLogger<EChartInstance>() ?? NullLogger<EChartInstance>.Instance;

    private static bool IsCircuit(IJSRuntime js) =>
        !OperatingSystem.IsBrowser() && js.GetType().FullName == "Microsoft.AspNetCore.Components.Server.Circuits.RemoteJSRuntime";

    // Calls without a token keep the interop default timeout (Server: CircuitOptions.JSInteropDefaultCallTimeout), which an explicit token
    // would replace. A reply lost to an outage or to the hub limit then fails the call instead of holding the chart queue as a cancellation.
    internal static async ValueTask<T> WithReplyTimeoutAsync<T>(string operation, ValueTask<T> pending)
    {
        try
        {
            return await pending.ConfigureAwait(false);
        }
        catch (OperationCanceledException error)
        {
            throw ReplyTimeout(operation, error);
        }
    }

    internal static async ValueTask WithReplyTimeoutAsync(string operation, ValueTask pending)
    {
        try
        {
            await pending.ConfigureAwait(false);
        }
        catch (OperationCanceledException error)
        {
            throw ReplyTimeout(operation, error);
        }
    }

    private static TimeoutException ReplyTimeout(string operation, Exception cause) =>
        new(
            $"[ResultTimeout] {operation} received no reply within the JS interop call timeout (Interactive Server: CircuitOptions.JSInteropDefaultCallTimeout, "
            + "1 minute by default). The circuit was interrupted, or the reply exceeded HubOptions.MaximumReceiveMessageSize; see EChartsRuntimeOptions.MaximumServerResultSize.",
            cause);

    /// <summary>Creates a facade without performing JS interop, including during prerender.</summary>
    public EChartsRuntime(IJSRuntime js, NavigationManager navigation, EChartsRuntimeOptions options)
    {
        _js = js;
        _navigation = navigation;
        _options = options;
        Server = IsCircuit(js);
        _serialization = new() { AllowInlineJavaScript = options.AllowInlineJavaScript };
        GeneratedOptionMetadata.Register(_serialization);
    }

    private readonly EChartsSerializationContext _serialization;

    /// <summary>Gets explicit serializer registrations. Configure consumer metadata before using options.</summary>
    public EChartsSerializationContext Serialization
    {
        get
        {
            ConfigureExtensions();
            return _serialization;
        }
    }

    internal int OwnedChartCount
    {
        get
        {
            lock (_gate)
                return _instances.Count;
        }
    }

    /// <summary>Gets the page runtime identity after successful initialization.</summary>
    public string? RuntimeId { get; private set; }

    /// <summary>Initializes the page runtime, or explicitly retries a failed or timed-out attempt. Cancellation stops
    /// this waiter only.</summary>
    public ValueTask InitializeAsync(CancellationToken cancellationToken = default) => EnsureInitializedAsync(true, cancellationToken);

    private ValueTask EnsureInitializedAsync(bool retry, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Task initialization;
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
            if (_initialization is null || (retry && (_initialization.IsFaulted || _initialization.IsCanceled)))
            {
                var configuration = _options.Freeze();
                ConfigureExtensions();
                _initialization = InitializeCoreAsync(configuration, _initialization is not null);
            }

            initialization = _initialization;
        }

        return new(initialization.WaitAsync(cancellationToken));
    }

    private async Task InitializeCoreAsync(RuntimeConfiguration configuration, bool retry)
    {
        if (_module is null)
        {
            // The first import uses the stable, cacheable URL, fingerprinted when the host maps static assets. A failed import stays
            // failed for its URL in the page's module map, so this facade then imports its own URL, and an explicit retry adds the
            // attempt. Symbol.for keeps one page registry per protocol.
            const string label = $"{StaticAssets.BasePath}/js/runtime-loader.js";
            ResourceAssetCollection? assets;
            lock (_gate)
                assets = _assets;

            var loader = new Uri(new Uri(_navigation.BaseUri), assets?[label] ?? label).AbsoluteUri;
            var facade = $"{loader}?__blazorecharts_facade={_ownerId}";
            var attempt = _moduleImportAttempts++;
            if (attempt > 0)
                _module = await _js.InvokeAsync<IJSObjectReference>("import", $"{facade}&__blazorecharts_retry={attempt}").ConfigureAwait(false);
            else
            {
                try
                {
                    _module = await _js.InvokeAsync<IJSObjectReference>("import", loader).ConfigureAwait(false);
                }
                catch (JSException)
                {
                    _module = await _js.InvokeAsync<IJSObjectReference>("import", facade).ConfigureAwait(false);
                }
            }
        }

        var json = JsonSerializer.SerializeToElement(configuration, RuntimeInteropJsonContext.Default.RuntimeConfiguration);
        RuntimeId = await _module.InvokeAsync<string>("openFacade", RuntimeProtocol, _ownerId, json, json.GetProperty("extensions"), retry, Server,
            Server ? _options.MaximumServerResultSize : null).ConfigureAwait(false);
        _serialization.SetReferenceRuntime(RuntimeId);
    }

    /// <summary>Creates an owned primitive chart. Component lifecycle orchestration uses this same seam.</summary>
    public async ValueTask<EChartInstance> CreateInstanceAsync(ElementReference element, ChartInitOptions? initOptions = null,
        string? theme = null, CancellationToken cancellationToken = default) =>
        await CreateCoreAsync(element, initOptions, theme, null, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Native chart allocation returned no handle.");

    internal ValueTask<EChartInstance?> TryCreateObservedInstanceAsync(ElementReference element, ChartInitOptions initOptions,
        string? theme, string observation, CancellationToken cancellationToken) =>
        CreateCoreAsync(element, initOptions, theme, observation, cancellationToken);

    internal ValueTask SetAutoResizeAsync(string observation, bool autoResize) =>
        _module!.InvokeVoidAsync("setAutoResize", _ownerId, observation, autoResize);

    internal ValueTask<bool> CheckChartSizeAsync(string observation) => _module!.InvokeAsync<bool>("checkChartSize", _ownerId, observation);

    internal ValueTask<bool> ObserveChartAsync(
        string id,
        ElementReference element,
        bool autoResize,
        int generation,
        DotNetObjectReference<ChartLifecycle> callback) =>
        _module!.InvokeAsync<bool>("observeChart", _ownerId, id, element, autoResize, generation, callback, Server);

    internal async ValueTask ReleaseObservationAsync(string id)
    {
        try
        {
            if (_module is not null)
                await _module.InvokeVoidAsync("releaseObservation", _ownerId, id);
        }
        catch (JSDisconnectedException)
        {
            // Browser MutationObserver owns DOM cleanup after circuit loss.
        }
    }

    private async ValueTask<EChartInstance?> CreateCoreAsync(ElementReference element, ChartInitOptions? initOptions,
        object? theme, string? observation, CancellationToken cancellationToken)
    {
        await EnsureInitializedAsync(false, cancellationToken).ConfigureAwait(false);
        var prepared = OptionSerializer.Serialize(initOptions ?? new ChartInitOptions(), Serialization);
        if (prepared.Bindings.Count != 0)
            throw new NotSupportedException("Init options cannot contain bindings in the primitive runtime.");

        BeginHandleUse();

        // The export readiness travels with the allocation: one round trip per chart, and the charts of a dashboard allocate concurrently.
        var readiness = DotNetObjectReference.Create(new EChartInstance.ExportReadiness());
        EChartInstance? instance = null;
        try
        {
            // Do not cancel an allocation after dispatch: obtain its ID so cancellation can release it.
            var id = await _module!.InvokeAsync<string?>("createChart", _ownerId, element, theme, prepared.Json, observation, readiness)
                .ConfigureAwait(false);
            if (id is null)
            {
                cancellationToken.ThrowIfCancellationRequested();
                return null;
            }

            lock (_gate)
            {
                if (_disposal is null && !cancellationToken.IsCancellationRequested)
                {
                    instance = new EChartInstance(id, this, Serialization) { Logger = InstanceLogger };
                    instance.UseExportReference(readiness);
                    _instances.Add(id, instance);
                    return instance;
                }
            }

            await _module!.InvokeVoidAsync("disposeChart", _ownerId, id).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            throw new ObjectDisposedException(nameof(EChartsRuntime));
        }
        finally
        {
            if (instance is null)
                readiness.Dispose();

            EndHandleUse();
        }
    }

    private void BeginHandleUse()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
            _handleUses++;
        }
    }

    private void EndHandleUse()
    {
        TaskCompletionSource? ended;
        lock (_gate)
        {
            if (--_handleUses != 0)
                return;

            ended = _handleUsesEnded;
        }

        ended?.TrySetResult();
    }

    private Task HandleUsesEndedAsync()
    {
        lock (_gate)
            return _handleUses == 0 ? Task.CompletedTask : (_handleUsesEnded ??= new(TaskCreationOptions.RunContinuationsAsynchronously)).Task;
    }

    async ValueTask IChartCommandTransport.SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken cancellationToken)
        => await SetOptionCoreAsync(id, option, update, null, cancellationToken).ConfigureAwait(false);

    ValueTask IChartRevisionTransport.SetOptionAsync(
        string id,
        PreparedOption option,
        JsonElement update,
        ChartRevision revision,
        CancellationToken cancellationToken) =>
        SetOptionCoreAsync(id, option, update, revision, cancellationToken);

    private async ValueTask SetOptionCoreAsync(
        string id,
        PreparedOption option,
        JsonElement update,
        ChartRevision? revision,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
            if (!_instances.ContainsKey(id))
                throw new ObjectDisposedException(nameof(EChartInstance));
        }

        // Options go as UTF-8 bytes (a Uint8Array in the browser), so Blazor does not revive every JSON node; bindings are small JSON.
        JsonElement? bindings = option.Bindings.Count == 0 ? null : MethodJson.Create(w =>
        {
            w.WriteStartArray();
            foreach (var binding in option.Bindings)
                JsonSerializer.Serialize(w, binding, EChartsTransportJsonContext.Default.JsBinding);

            w.WriteEndArray();
        });
        await InvokeChartAsync("setOption", cancellationToken, [_ownerId, id, option.Utf8, bindings, update,
            revision?.Generation, revision?.Revision, revision?.Sequence], ByteArrayGates.GetValue(_js, _ => new object())).ConfigureAwait(false);
    }

    // JSRuntime numbers byte[] arguments with an unsynchronized counter and sends their bytes as separate messages. Calls with one are
    // initiated one at a time per JSRuntime (a circuit), across its facades; the serialization up to BeginInvokeJS is synchronous.
    private static readonly ConditionalWeakTable<IJSRuntime, object> ByteArrayGates = [];

    // A dispatched chart command keeps its queue slot until the browser replies; only a lost reply ends it early.
    private async ValueTask InvokeChartAsync(string identifier, CancellationToken cancellationToken, object?[] args, object? gate = null)
    {
        ValueTask pending;
        if (gate is null)
            pending = Start();
        else
            lock (gate)
                pending = Start();

        if (cancellationToken.CanBeCanceled)
            await pending.ConfigureAwait(false);
        else
            await WithReplyTimeoutAsync(identifier, pending).ConfigureAwait(false);

        ValueTask Start() =>
            cancellationToken.CanBeCanceled
                ? _module!.InvokeVoidAsync(identifier, cancellationToken, args)
                : _module!.InvokeVoidAsync(identifier, args);
    }

    ValueTask IChartRecreationTransport.SetThemeAsync(string id, string? theme, ChartRevision revision, CancellationToken cancellationToken) =>
        InvokeChartAsync("setTheme", cancellationToken, [_ownerId, id, theme, revision.Generation, revision.Revision, revision.Sequence]);

    ValueTask IChartEventTransport.SubscribeAsync(string id, ChartSubscription subscription, string name, JsonElement query) =>
        _module!.InvokeVoidAsync("subscribe", _ownerId, id, subscription.Id, name, query, subscription.Reference, subscription.ThrottleMilliseconds);

    async ValueTask IChartEventTransport.UnsubscribeAsync(string id, string subscription)
    {
        try
        {
            if (_module is not null)
                await _module.InvokeVoidAsync("unsubscribe", _ownerId, id, subscription).ConfigureAwait(false);
        }
        catch (JSDisconnectedException)
        {
        }
    }

    ValueTask IChartEventTransport.DispatchActionAsync(string id, JsonElement payload, JsonElement settings, ChartRevision revision) =>
        _module!.InvokeVoidAsync("dispatchAction", _ownerId, id, payload, settings, revision.Generation, revision.Revision, revision.Sequence);

    ValueTask IChartEventTransport.DispatchBoundActionAsync(string id, PreparedOption payload, JsonElement settings, ChartRevision revision) =>
        _module!.InvokeVoidAsync(
            "dispatchBoundAction",
            _ownerId,
            id,
            JsonSerializer.SerializeToElement(payload, EChartsTransportJsonContext.Default.PreparedOption),
            settings,
            revision.Generation,
            revision.Revision,
            revision.Sequence);

    ValueTask IChartRecreationTransport.RecreateAsync(
        string id,
        JsonElement init,
        string? theme,
        ChartRevision revision,
        CancellationToken cancellationToken) =>
        InvokeChartAsync("recreateChart", cancellationToken, [_ownerId, id, init, theme, revision.Generation, revision.Revision, revision.Sequence]);

    async ValueTask IChartCommandTransport.DisposeAsync(string id)
    {
        lock (_gate)
        {
            if (!_instances.Remove(id))
                return;
        }

        try
        {
            if (_module is not null)
                await _module.InvokeVoidAsync("disposeChart", _ownerId, id).ConfigureAwait(false);
        }
        catch (JSDisconnectedException)
        {
        }
    }

    /// <summary>Starts releasing this facade's handles without waiting, for code that disposes a service scope synchronously.
    /// Prefer <see cref="DisposeAsync"/>, which completes when the browser has released them.</summary>
    public void Dispose() => _ = DisposeAsync().AsTask().ContinueWith(static disposal => _ = disposal.Exception, CancellationToken.None,
        TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);

    /// <summary>Releases this facade's chart and interop handles, preserving the page runtime.</summary>
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource completion;
        lock (_gate)
        {
            if (_disposal is not null)
                return new(_disposal);

            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _disposal = completion.Task;
        }

        _ = ReleaseAsync(completion);
        return new(completion.Task);
    }

    private async Task ReleaseAsync(TaskCompletionSource completion)
    {
        var failures = new List<Exception>();
        try
        {
            if (_initialization is not null)
            {
                try
                {
                    await _initialization.ConfigureAwait(false);
                }
                catch
                {
                    // Release any module acquired before failure.
                }
            }

            await HandleUsesEndedAsync().ConfigureAwait(false);
            EChartInstance[] instances;
            lock (_gate)
                instances = _instances.Values.ToArray();

            foreach (var instance in instances)
                try
                {
                    await instance.DisposeAsync().ConfigureAwait(false);
                }
                catch (Exception error)
                {
                    failures.Add(error);
                }

            if (_module is not null)
            {
                try
                {
                    await _module.InvokeVoidAsync("releaseFacade", _ownerId).ConfigureAwait(false);
                }
                catch (JSDisconnectedException)
                {
                }
                catch (Exception error)
                {
                    failures.Add(error);
                }

                try
                {
                    await ReleaseModuleWhenUnusedAsync().ConfigureAwait(false);
                }
                catch (JSDisconnectedException)
                {
                }
                catch (Exception error)
                {
                    failures.Add(error);
                }
            }

            if (failures.Count != 0)
                throw new AggregateException(failures);

            completion.SetResult();
        }
        catch (Exception error)
        {
            completion.SetException(error);
        }
    }
}
