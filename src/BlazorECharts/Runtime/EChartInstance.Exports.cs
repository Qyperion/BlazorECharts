using System.Diagnostics;
using System.Text.Json;
using BlazorECharts.Serialization;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

public partial class EChartInstance
{
    private readonly CancellationTokenSource _exportLifetime = new();
    private DotNetObjectReference<ExportReadiness>? _exportReference;

    internal DotNetObjectReference<ExportReadiness> ExportReference => _exportReference ??= DotNetObjectReference.Create(new ExportReadiness(this));

    // The facade allocates the native chart together with its readiness, before this handle exists.
    internal void UseExportReference(DotNetObjectReference<ExportReadiness> reference)
    {
        reference.Value.Attach(this);
        _exportReference = reference;
    }

    internal sealed class ExportReadiness
    {
        private readonly object _gate = new();
        private readonly Dictionary<string, CancellationTokenSource> _preparations = [];

        // Until its handle attaches, the chart has no accepted revision to wait for, like a chart without a readiness.
        private EChartInstance? _chart;

        internal ExportReadiness() { }

        internal ExportReadiness(EChartInstance chart) => _chart = chart;

        internal void Attach(EChartInstance chart) => Volatile.Write(ref _chart, chart);

        [JSInvokable]
        public async Task<long> Prepare(string operation, double timeout)
        {
            if (Volatile.Read(ref _chart) is not { } chart)
                return 0;

            using var deadline = new CancellationTokenSource(TimeSpan.FromMilliseconds(Math.Clamp(timeout, 0, int.MaxValue)));
            using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token, chart._exportLifetime.Token);
            lock (_gate)
                _preparations.Add(operation, lifetime);

            try
            {
                long sequence = 0;
                await chart._commands.Enqueue(async (revision, token) =>
                {
                    await chart._readiness.WaitAsync(token).ConfigureAwait(false);
                    chart.EnsureActive();
                    token.ThrowIfCancellationRequested();
                    sequence = revision.Sequence;
                }, cancellationToken: lifetime.Token, renders: false).ConfigureAwait(false);
                return sequence;
            }
            finally
            {
                lock (_gate)
                    _preparations.Remove(operation);
            }
        }

        [JSInvokable]
        public void CancelPrepare(string operation)
        {
            lock (_gate)
            {
                if (_preparations.TryGetValue(operation, out var lifetime))
                    lifetime.Cancel();
            }
        }

        [JSInvokable]
        public bool Validate(long sequence) =>
            Volatile.Read(ref _chart) is not { } chart || (!chart.IsDisposed && chart._commands.AcceptedRenderingSequence <= sequence);
    }

    /// <summary>Waits for the latest accepted revision, native render work, resources and registered layout
    /// participants.</summary>
    public async ValueTask AwaitStableAsync(ChartStabilityOptions? options = null, CancellationToken cancellationToken = default) =>
        await ExportAsync("awaitStable", [], options, (_, _) => ValueTask.FromResult(true), cancellationToken).ConfigureAwait(false);

    /// <summary>Captures the latest stable chart using native getDataURL options.</summary>
    public ValueTask<string> GetDataUrlAsync(
        ChartDataUrlOptions? options = null,
        ChartStabilityOptions? stability = null,
        CancellationToken cancellationToken = default) =>
        ExportStringAsync("getDataURL", options is null ? [] : [options], stability, cancellationToken);

    /// <summary>Captures all current connected members after readiness and a synchronous membership/revision recheck.</summary>
    public ValueTask<string> GetConnectedDataUrlAsync(
        ChartConnectedDataUrlOptions? options = null,
        ChartStabilityOptions? stability = null,
        CancellationToken cancellationToken = default) => ExportStringAsync("getConnectedDataURL", [options ?? new()], stability, cancellationToken);

    /// <summary>Captures an SVG-renderer data URL after stability.</summary>
    public ValueTask<string> GetSvgDataUrlAsync(ChartStabilityOptions? stability = null, CancellationToken cancellationToken = default) =>
        ExportStringAsync("getSvgDataURL", [], stability, cancellationToken);

    /// <summary>Renders stable SVG markup. Canvas to SVG conversion is unsupported.</summary>
    public ValueTask<string> RenderToSvgStringAsync(
        ChartSvgExportOptions? options = null,
        ChartStabilityOptions? stability = null,
        CancellationToken cancellationToken = default) =>
        ExportStringAsync("renderToSVGString", options is null ? [] : [options], stability, cancellationToken);

    /// <summary>Returns an independently retained native canvas after stable rendering. Dispose the reference when
    /// finished.</summary>
    public ValueTask<EChartsObjectReference> RenderToCanvasAsync(
        ChartCanvasExportOptions? options = null,
        ChartStabilityOptions? stability = null,
        CancellationToken cancellationToken = default) =>
        ExportAsync(
            "renderToCanvas",
            options is null ? [] : [options],
            stability,
            (t, e) => ((IChartMethodTransport)t).ReadReferenceAsync(e),
            cancellationToken);

    /// <summary>Preserves the deprecated native getRenderedCanvas alias with the same stable canvas semantics.</summary>
    public ValueTask<EChartsObjectReference> GetRenderedCanvasAsync(
        ChartCanvasExportOptions? options = null,
        ChartStabilityOptions? stability = null,
        CancellationToken cancellationToken = default) =>
        ExportAsync(
            "getRenderedCanvas",
            options is null ? [] : [options],
            stability,
            (t, e) => ((IChartMethodTransport)t).ReadReferenceAsync(e),
            cancellationToken);

    private ValueTask<string> ExportStringAsync(string method, object?[] args, ChartStabilityOptions? stability, CancellationToken token) =>
        ExportAsync(
            method,
            args,
            stability,
            (_, e) => ValueTask.FromResult(
                e.GetProperty("value").GetString() is { Length: > 0 } s ? s : throw new JsonException("Native export returned an empty image.")),
            token);

    private async ValueTask<T> ExportAsync<T>(string method, object?[] arguments, ChartStabilityOptions? options,
        Func<IChartExportTransport, JsonElement, ValueTask<T>> read, CancellationToken cancellationToken)
    {
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        if (_transport is not IChartExportTransport transport)
            throw new NotSupportedException("The transport does not support stable exports.");

        var timeout = (options ?? new()).Timeout;
        var clock = Stopwatch.StartNew();
        var preparation = _serialization.CreatePreparation();
        var json = MethodJson.Create(w =>
        {
            w.WriteStartObject();
            w.WritePropertyName("args");
            w.WriteStartArray();
            for (var i = 0; i < arguments.Length; i++)
                preparation.WriteArrayItem(w, arguments[i], "$.args", i);

            w.WriteEndArray();
            w.WriteEndObject();
        });
        var prepared = new PreparedOption(json, preparation.Bindings);

        using var deadline = new CancellationTokenSource();
        deadline.CancelAfter(timeout);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _exportLifetime.Token, deadline.Token);
        var token = lifetime.Token;

        T? value = default;
        bool produced = false;
        bool abandoned = false;
        var ownership = new object();

        async Task<T> RunAsync()
        {
            while (true)
            {
                Task<JsonElement>? capture = null;
                ChartRevision dispatched = default;

                // Initiate capture in order, then release the slot so updates and resize can make progress.
                await _commands.Enqueue(async (revision, queuedToken) =>
                {
                    await _readiness.WaitAsync(queuedToken).ConfigureAwait(false);
                    EnsureActive();
                    queuedToken.ThrowIfCancellationRequested();
                    dispatched = revision;
                    capture = transport.InvokeExportAsync(Id, method, prepared, Math.Max(0, (timeout - clock.Elapsed).TotalMilliseconds), token)
                        .AsTask();
                }, cancellationToken: token, renders: false).ConfigureAwait(false);
                var envelope = await capture!.ConfigureAwait(false);
                bool retained = false;
                try
                {
                    token.ThrowIfCancellationRequested();

                    // Commands accepted in managed code during interop must also be included, even before JS dispatch.
                    if (_commands.AcceptedRenderingSequence > dispatched.Sequence)
                    {
                        if (clock.Elapsed >= timeout)
                            throw new TimeoutException("The chart stability timeout elapsed before capture.");

                        continue;
                    }

                    var result = await read(transport, envelope).ConfigureAwait(false);
                    lock (ownership)
                    {
                        if (!abandoned && !token.IsCancellationRequested && !IsDisposed)
                        {
                            value = result;
                            produced = true;
                            retained = result is IAsyncDisposable;
                        }
                    }

                    if (!produced && result is IAsyncDisposable owned)
                    {
                        retained = true;
                        await owned.DisposeAsync().ConfigureAwait(false);
                    }

                    token.ThrowIfCancellationRequested();
                    return result;
                }
                finally
                {
                    if (!retained && _transport is IChartMethodTransport methods)
                        await methods.ReleaseResultAsync(envelope).ConfigureAwait(false);
                }
            }
        }

        try
        {
            return await RunAsync().WaitAsync(token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested
            && !cancellationToken.IsCancellationRequested
            && !_exportLifetime.IsCancellationRequested)
        {
            throw new TimeoutException("The chart stability timeout elapsed before capture.");
        }
        // The browser deadline may expire before the managed one; report the same failure either way.
        catch (JSException error) when (error.Message.StartsWith("[StabilityTimeout]", StringComparison.Ordinal))
        {
            throw new TimeoutException("The chart stability timeout elapsed before capture.", error);
        }
        finally
        {
            IAsyncDisposable? release;
            lock (ownership)
            {
                abandoned = true;
                release = token.IsCancellationRequested && produced ? value as IAsyncDisposable : null;
            }

            if (release is not null)
                await release.DisposeAsync().ConfigureAwait(false);
        }
    }
}
