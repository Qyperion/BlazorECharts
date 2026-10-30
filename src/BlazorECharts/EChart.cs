using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.JSInterop;

namespace BlazorECharts;

/// <summary>An interactive ECharts container. The host selects the Blazor render mode.</summary>
public sealed class EChart : ComponentBase, IAsyncDisposable
{
    private ElementReference _element;
    private readonly ChartLifecycle _lifecycle;

    private sealed class Resources(int generation)
    {
        internal readonly int Generation = generation;
        internal EChartInstance? Allocated;
        internal EChartInstance? Published;
        internal string? Observation;
        internal DotNetObjectReference<ChartLifecycle>? Callback;
        internal Task? Cleanup;
        internal bool Retiring;

        // Parameters wait for a free queue slot or for a hidden container to be shown.
        internal bool Deferred;
        internal bool AwaitingContainer;

        internal ChartOptions? AcceptedTyped;
        internal JsonElement? AcceptedRaw;
        internal string? AcceptedTheme;
        internal string? AcceptedInit;
        internal bool AcceptedAutoResize;
    }

    private Resources? _resources;
    private Task? _retirement;
    private Task? _initialization;
    private Task? _disposal;
    private Task? _allocation;
    private bool _rendered;
    private TaskCompletionSource _inputAvailable = new(TaskCreationOptions.RunContinuationsAsynchronously);

    [Inject] private EChartsRuntime Runtime { get; set; } = default!;
    [Inject] private IServiceProvider ServiceProvider { get; set; } = default!;

    private ILogger? _logger;

    private ILogger Logger => _logger ??= ServiceProvider.GetService<ILogger<EChart>>() ?? NullLogger<EChart>.Instance;

    /// <summary>Typed options. A new reference applies automatically; mutations require UpdateAsync. Mutually exclusive
    /// with RawOptions.</summary>
    [Parameter] public ChartOptions? Options { get; set; }

    /// <summary>A JSON object applied when its identity changes. Mutually exclusive with Options.</summary>
    [Parameter] public JsonElement? RawOptions { get; set; }

    /// <summary>Native initialization options.</summary>
    [Parameter] public ChartInitOptions InitOptions { get; set; } = new();

    /// <summary>Native setOption settings captured with each accepted parameter update.</summary>
    [Parameter] public SetOptionOptions UpdateOptions { get; set; } = new();

    /// <summary>The registered theme name used during initialization.</summary>
    [Parameter] public string? Theme { get; set; }

    /// <summary>Whether a ResizeObserver resizes the initialized chart; a change applies to the current chart. Initial
    /// sizing is always observed.</summary>
    [Parameter] public bool AutoResize { get; set; } = true;

    /// <summary>CSS classes applied to the chart container.</summary>
    [Parameter] public string? Class { get; set; }

    /// <summary>CSS style applied to the chart container. Set a nonzero height.</summary>
    [Parameter] public string? Style { get; set; }

    /// <summary>Other HTML attributes of the chart container, such as <c>id</c>, <c>data-*</c> or
    /// <c>aria-describedby</c>.</summary>
    /// <remarks><c>class</c> and <c>style</c> bind to <see cref="Class"/> and <see cref="Style"/>;
    /// <c>data-chart-state</c> is reserved.
    /// When <c>ChartOptions.Aria</c> enables labels, ECharts sets <c>role</c> and <c>aria-label</c> on the container
    /// and overwrites attributes of those names.</remarks>
    [Parameter(CaptureUnmatchedValues = true)] public IReadOnlyDictionary<string, object>? AdditionalAttributes { get; set; }

    /// <summary>Invoked once for a successfully initialized generation, after initial setOption. Does not imply stable
    /// layout.</summary>
    [Parameter] public EventCallback<EChartInstance> OnReady { get; set; }

    /// <summary>Receives initialization and browser operation failures. Explicit awaited calls also reject.</summary>
    [Parameter] public EventCallback<EChartsError> OnError { get; set; }

    /// <summary>Gets the component's current lifecycle state.</summary>
    public ChartState State => _lifecycle.State;

    internal int Generation => _lifecycle.Generation;

    /// <summary>Gets the current native handle, or null before allocation or after cleanup.</summary>
    /// <remarks>The component owns this handle and disposes it with itself. Disposing it elsewhere, directly or through
    /// <see cref="EChartsRuntime.DisposeChartAsync(EChartInstance, CancellationToken)"/>, moves the component to
    /// <see cref="ChartState.Failed"/> with a <c>ChartDisposed</c> error; <see cref="InitializeAsync"/> creates a new
    /// handle.</remarks>
    public EChartInstance? Instance => _resources?.Published;

    // Disposal and State must work even when the renderer rejected the parameters before OnInitialized.
    /// <summary>Creates the component; the renderer supplies its parameters.</summary>
    public EChart() => _lifecycle = new((error, level) => NotifyErrorAsync(error, level), () => DisposeAsync().AsTask());

    // Written in C# rather than Razor: Razor-generated code names the absolute source path, which the PDB embeds.
    /// <inheritdoc />
    protected override void BuildRenderTree(RenderTreeBuilder builder)
    {
        builder.OpenElement(0, "div");
        builder.AddMultipleAttributes(1, AdditionalAttributes);
        builder.AddAttribute(2, "class", Class);
        builder.AddAttribute(3, "style", Style);
        builder.AddAttribute(4, "data-chart-state", State);
        builder.AddElementReferenceCapture(5, element => _element = element);
        builder.CloseElement();
    }

    /// <inheritdoc />
    protected override void OnParametersSet()
    {
        if (Options is not null && RawOptions is not null)
            throw new InvalidOperationException("EChart.Options and EChart.RawOptions are mutually exclusive. Supply only one input.");

        if (RawOptions is { ValueKind: not JsonValueKind.Object })
            throw new InvalidOperationException("EChart.RawOptions must be a JSON object.");

        ArgumentNullException.ThrowIfNull(InitOptions);
        ArgumentNullException.ThrowIfNull(UpdateOptions);
        if (HasInput)
            _inputAvailable.TrySetResult();
        else if (_inputAvailable.Task.IsCompleted)
            _inputAvailable = new(TaskCreationOptions.RunContinuationsAsynchronously);

        if (Instance is not null && State is ChartState.Initializing or ChartState.Ready)
            AcceptParameters();
    }

    /// <inheritdoc />
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        _rendered = RendererInfo.IsInteractive;
        if (_rendered && State == ChartState.NotInitialized && HasInput)
        {
            var attemptGeneration = Generation + 1;
            try
            {
                await InitializeAsync();
            }
            catch when (_lifecycle.FailedGeneration >= attemptGeneration || _disposal is not null)
            {
                // Reported by that attempt, even if OnError retried it.
            }
        }
    }

    private bool HasInput => Options is not null || RawOptions is not null;

    /// <summary>Waits for initialization, or explicitly retries a failed generation. Cancellation stops this waiter
    /// only.</summary>
    /// <remarks>May be called from any thread, for example a retry timer: the work runs on the component's dispatcher.</remarks>
    public ValueTask InitializeAsync(CancellationToken cancellationToken = default) =>
        new(InvokeAsync(() => InitializeOnRendererAsync(cancellationToken).AsTask()));

    private ValueTask InitializeOnRendererAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposal is not null, this);
        cancellationToken.ThrowIfCancellationRequested();
        if (_retirement is { IsCompleted: false })
            return new(RetryAfterCleanupAsync(_retirement, cancellationToken));

        if (State == ChartState.Ready)
            return ValueTask.CompletedTask;

        if (_rendered && HasInput && State is ChartState.NotInitialized or ChartState.Failed)
        {
            var generation = _lifecycle.Begin();
            var allocation = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            _allocation = allocation.Task;
            _resources = new(generation);
            _initialization = InitializeCoreAsync(_resources, _lifecycle.Token, allocation);
        }

        return new((_initialization ?? _lifecycle.Ready).WaitAsync(cancellationToken));
    }

    private async Task RetryAfterCleanupAsync(Task retirement, CancellationToken cancellationToken)
    {
        await retirement.WaitAsync(cancellationToken);
        await InitializeAsync(cancellationToken);
    }

    private async Task InitializeCoreAsync(Resources owner, CancellationToken cancellationToken, TaskCompletionSource allocation)
    {
        var generation = owner.Generation;
        try
        {
            await InvokeAsync(StateHasChanged);
            Runtime.UseAssets(Assets);
            await Runtime.InitializeAsync(cancellationToken);
            await WaitForInputAsync(cancellationToken);

            owner.Observation = Guid.NewGuid().ToString("N");
            owner.Callback = DotNetObjectReference.Create(_lifecycle);
            owner.AcceptedAutoResize = AutoResize;
            if (await Runtime.ObserveChartAsync(owner.Observation, _element, AutoResize, generation, owner.Callback))
                await _lifecycle.ContainerReady(generation);

            EChartInstance? instance;
            while (true)
            {
                await _lifecycle.Size.WaitAsync(cancellationToken);
                await WaitForInputAsync(cancellationToken);
                owner.AcceptedInit = PrepareInit().GetRawText();
                owner.AcceptedTheme = Theme;
                instance = await Runtime.TryCreateObservedInstanceAsync(_element, InitOptions, Theme, owner.Observation, cancellationToken);
                if (instance is not null)
                    break;

                // Size may disappear during a Server round trip. Re-arm and recheck atomically in JS.
                _lifecycle.ResetSize();
                if (await Runtime.CheckChartSizeAsync(owner.Observation))
                    await _lifecycle.ContainerReady(generation);
            }

            owner.Allocated = instance;
            instance.Disposing = () => _ = ObserveExternalDisposalAsync(owner);
            instance.WaitForReadiness(_lifecycle.Ready, generation);
            await WaitForInputAsync(cancellationToken);

            // Initial application bypasses the public readiness wait and uses the same command transport.
            owner.AcceptedTyped = Options;
            owner.AcceptedRaw = RawOptions;
            var initial = Options is not null
                ? instance.SetInitialOptionAsync(Options, UpdateOptions, cancellationToken)
                : instance.SetInitialOptionAsync(RawOptions!.Value, UpdateOptions, cancellationToken);

            // Publish only after reserving the first queue slot. Public commands must never block the initial apply on Ready.
            owner.Published = instance;
            await initial;
            cancellationToken.ThrowIfCancellationRequested();
            if (!_lifecycle.IsCurrent(generation))
                throw new OperationCanceledException(cancellationToken);

            _lifecycle.Complete(generation, instance);
            AcceptParameters();
        }
        catch (Exception exception)
        {
            var affectedChart = owner.Allocated?.Id;
            owner.Allocated?.FailPendingCommands(exception);
            try
            {
                await CleanupAsync(owner);
            }
            catch (Exception cleanup)
            {
                exception = new AggregateException(exception, cleanup);
            }

            allocation.TrySetResult();
            if (!_lifecycle.IsCurrent(generation))
                throw;

            _lifecycle.Fail(generation, exception);
            await InvokeAsync(StateHasChanged);
            await NotifyErrorAsync(
                new(exception is JSDisconnectedException ? "CircuitDisconnected" : "ChartInitializationFailed", exception.Message, exception)
                {
                    Operation = "initialize",
                    ChartId = affectedChart,
                });
            throw;
        }
        finally
        {
            allocation.TrySetResult();
        }

        if (_lifecycle.IsCurrent(generation))
        {
            await InvokeAsync(StateHasChanged);
            await OnReady.InvokeAsync(owner.Published);
        }
    }

    private async Task WaitForInputAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        while (!HasInput)
            await _inputAvailable.Task.WaitAsync(cancellationToken);
    }

    private Task NotifyErrorAsync(EChartsError error) => NotifyErrorAsync(error, LogLevel.Error);

    // Browser-reported failures without a .NET caller log at Warning; the rest at Error.
    private Task NotifyErrorAsync(EChartsError error, LogLevel level) => InvokeAsync(async () =>
    {
        error = error with { ChartId = error.ChartId ?? Instance?.Id, DetailCode = error.DetailCode ?? EChartsError.CodeOf(error.Exception) };
        if (!OnError.HasDelegate)
        {
            Logger.Log(
                level,
                error.Exception,
                "EChart {Code} during {Operation} (chart {ChartId}): {Message} Handle EChart.OnError to report it in the application.",
                error.Code,
                error.Operation,
                error.ChartId,
                error.Message);
            return;
        }

        Logger.LogDebug(
            error.Exception,
            "EChart {Code} during {Operation} (chart {ChartId}): {Message}",
            error.Code,
            error.Operation,
            error.ChartId,
            error.Message);

        // A failing OnError handler is an application bug: report it to the renderer instead of swallowing it.
        try
        {
            await OnError.InvokeAsync(error);
        }
        catch (Exception handler)
        {
            await DispatchExceptionAsync(handler);
        }
    });

    private JsonElement PrepareInit()
    {
        var prepared = OptionSerializer.Serialize(InitOptions, Runtime.Serialization);
        if (prepared.Bindings.Count != 0)
            throw new NotSupportedException("Init options cannot contain bindings in the primitive runtime.");

        return prepared.Json;
    }

    private void AcceptParameters()
    {
        var owner = _resources;
        var instance = owner?.Published;
        if (owner is null || instance is null || owner.Retiring)
            return;

        var typed = Options;
        var raw = RawOptions;
        var settings = UpdateOptions;
        var theme = Theme;
        if (AutoResize != owner.AcceptedAutoResize && owner.Observation is { } observation)
        {
            owner.AcceptedAutoResize = AutoResize;
            _ = SetAutoResizeAsync(owner, observation, AutoResize);
        }

        if (owner.Deferred)
            return;

        // A hidden container postpones only the recreation: new options still apply to the current chart.
        if (!(owner.AwaitingContainer && theme == owner.AcceptedTheme && owner.AcceptedInit is null))
        {
            // Init DTOs are small and may be mutated. Chart option graphs are compared only by identity.
            var init = PrepareInit();
            var initText = init.GetRawText();
            if (initText != owner.AcceptedInit || theme != owner.AcceptedTheme)
            {
                var recreate = initText != owner.AcceptedInit;

                // Accept before queuing: a browser rejection may be observed synchronously and reset the accepted init.
                var (acceptedInit, acceptedTheme) = (owner.AcceptedInit, owner.AcceptedTheme);
                (owner.AcceptedInit, owner.AcceptedTheme) = (initText, theme);
                if (!TryAcceptUpdate(owner, instance, () => instance.ConfigureAsync(init, theme, recreate), recreate ? "recreate" : "setTheme"))
                {
                    (owner.AcceptedInit, owner.AcceptedTheme) = (acceptedInit, acceptedTheme);
                    return;
                }
            }
        }

        if ((typed is not null || raw is not null) && (!ReferenceEquals(typed, owner.AcceptedTyped) || !Nullable.Equals(raw, owner.AcceptedRaw)))
        {
            if (TryAcceptUpdate(owner, instance, () => instance.SetDeclarativeOptionAsync(typed, raw, settings), "setOption"))
            {
                owner.AcceptedTyped = typed;
                owner.AcceptedRaw = raw;
            }
        }
    }

    private bool TryAcceptUpdate(Resources owner, EChartInstance instance, Func<ValueTask> accept, string name)
    {
        try
        {
            _ = ObserveUpdateAsync(owner, accept(), name);
            return true;
        }
        catch (ChartQueueFullException)
        {
            _ = AcceptWhenQueuedAsync(owner, instance);
            return false;
        }
        catch (Exception exception)
        {
            _ = ObserveUpdateAsync(owner, ValueTask.FromException(exception), name);
            return false;
        }
    }

    private async Task SetAutoResizeAsync(Resources owner, string observation, bool autoResize)
    {
        try
        {
            await Runtime.SetAutoResizeAsync(observation, autoResize);
        }
        catch (JSDisconnectedException)
        {
            // The browser keeps its observers; the circuit is gone.
        }
        catch (Exception exception) when (ReferenceEquals(_resources, owner) && _disposal is null)
        {
            await NotifyErrorAsync(new("ChartUpdateFailed", exception.Message, exception) { Operation = "resize", ChartId = owner.Allocated?.Id });
        }
    }

    // Backpressure: the latest parameters wait for a free queue slot instead of failing; intermediate renders are skipped.
    private async Task AcceptWhenQueuedAsync(Resources owner, EChartInstance instance)
    {
        if (owner.Deferred)
            return;

        owner.Deferred = true;
        var resumed = false;
        try
        {
            await instance.WaitForCommandSlotAsync().ConfigureAwait(false);
            await InvokeAsync(async () =>
            {
                resumed = true;
                owner.Deferred = false;
                await AcceptLaterAsync(owner);
            });
        }
        catch (ObjectDisposedException)
        {
            // The renderer went away together with the component.
        }
        catch (Exception exception)
        {
            await ReportLaterAsync(owner, exception);
        }
        finally
        {
            if (!resumed)
                owner.Deferred = false;
        }
    }

    // A hidden container rejects recreation before any change: keep the chart and recreate once it has a size again.
    private async Task RecreateWhenVisibleAsync(Resources owner)
    {
        if (owner.AwaitingContainer || owner.Observation is null)
            return;

        owner.AwaitingContainer = true;
        var resumed = false;
        try
        {
            _lifecycle.ResetSize();
            if (await Runtime.CheckChartSizeAsync(owner.Observation))
                await _lifecycle.ContainerReady(owner.Generation);

            await _lifecycle.Size.WaitAsync(_lifecycle.Token);
            await InvokeAsync(async () =>
            {
                resumed = true;
                owner.AwaitingContainer = false;
                await AcceptLaterAsync(owner);
            });
        }
        catch (Exception exception) when (exception is OperationCanceledException or ObjectDisposedException or JSDisconnectedException)
        {
        }
        catch (Exception exception)
        {
            await ReportLaterAsync(owner, exception);
        }
        finally
        {
            if (!resumed)
                owner.AwaitingContainer = false;
        }
    }

    // Parameters accepted after a wait have no render to throw from: their failures go to OnError.
    private async Task AcceptLaterAsync(Resources owner)
    {
        if (_disposal is not null || !ReferenceEquals(_resources, owner) || !_lifecycle.IsCurrent(owner.Generation))
            return;

        // Only the init options can fail here; queued updates report their own failures.
        try
        {
            AcceptParameters();
        }
        catch (Exception exception)
        {
            await ReportLaterAsync(owner, exception);
        }
    }

    private async Task ReportLaterAsync(Resources owner, Exception exception)
    {
        try
        {
            await InvokeAsync(async () =>
            {
                if (_disposal is not null || !ReferenceEquals(_resources, owner) || !_lifecycle.IsCurrent(owner.Generation))
                    return;

                await NotifyErrorAsync(
                    new("ChartUpdateFailed", exception.Message, exception) { Operation = "recreate", ChartId = owner.Allocated?.Id });
            });
        }
        catch (ObjectDisposedException)
        {
            // The renderer went away together with the component.
        }
    }

    private async Task ObserveUpdateAsync(Resources owner, ValueTask operation, string name)
    {
        try
        {
            await operation;
        }
        catch (OperationCanceledException)
        {
            // Superseded declarative work or disposal has an observable cancelled task.
        }
        catch (Exception exception)
        {
            await InvokeAsync(async () =>
            {
                if (_disposal is not null || !ReferenceEquals(_resources, owner) || !_lifecycle.IsCurrent(owner.Generation) || owner.Retiring)
                    return;

                var chartId = owner.Allocated?.Id;
                if (name == "recreate" && EChartsError.CodeOf(exception) == "ChartContainerNotReady")
                {
                    Logger.LogDebug(exception, "EChart recreation waits for its hidden container (chart {ChartId}).", chartId);
                    owner.AcceptedInit = null;
                    _ = RecreateWhenVisibleAsync(owner);
                    return;
                }

                if (name == "recreate")
                {
                    owner.Retiring = true;
                    var retirement = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    _retirement = retirement.Task;
                    try
                    {
                        try
                        {
                            await CleanupAsync(owner);
                        }
                        catch (Exception cleanup)
                        {
                            exception = new AggregateException(exception, cleanup);
                        }

                        if (_disposal is not null || !_lifecycle.IsCurrent(owner.Generation))
                            return;

                        // Failed becomes retryable only after this owner's cleanup has settled.
                        _lifecycle.Fail(owner.Generation, exception);
                    }
                    finally
                    {
                        retirement.TrySetResult();
                    }

                    if (_disposal is not null)
                        return;

                    await InvokeAsync(StateHasChanged);
                }

                await NotifyErrorAsync(new("ChartUpdateFailed", exception.Message, exception) { Operation = name, ChartId = chartId });
            });
        }
    }

    private async Task ObserveExternalDisposalAsync(Resources owner)
    {
        try
        {
            await InvokeAsync(async () =>
            {
                // The component's own cleanup starts before it disposes the handle.
                if (owner.Cleanup is not null
                    || owner.Retiring
                    || _disposal is not null
                    || !ReferenceEquals(_resources, owner)
                    || State != ChartState.Ready)
                    return;

                owner.Retiring = true;
                var chartId = owner.Allocated?.Id;
                const string message = "The chart handle was disposed outside its EChart component.";
                Exception exception = new ObjectDisposedException(nameof(EChartInstance), message);

                var retirement = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                _retirement = retirement.Task;
                try
                {
                    try
                    {
                        await CleanupAsync(owner);
                    }
                    catch (Exception cleanup)
                    {
                        exception = new AggregateException(exception, cleanup);
                    }

                    if (_disposal is not null || !_lifecycle.IsCurrent(owner.Generation))
                        return;

                    _lifecycle.Fail(owner.Generation, exception);
                }
                finally
                {
                    retirement.TrySetResult();
                }

                if (_disposal is not null)
                    return;

                StateHasChanged();
                await NotifyErrorAsync(new("ChartDisposed", message, exception) { Operation = "dispose", ChartId = chartId });
            });
        }
        catch (ObjectDisposedException)
        {
            // The renderer went away together with the component.
        }
    }

    /// <summary>Explicitly applies the current typed/raw input, including mutations of the same object. Completion is
    /// not layout stability.</summary>
    /// <remarks>May be called from any thread: the work runs on the component's dispatcher.</remarks>
    public ValueTask UpdateAsync(CancellationToken cancellationToken = default) =>
        new(InvokeAsync(() => UpdateOnRendererAsync(cancellationToken).AsTask()));

    private async ValueTask UpdateOnRendererAsync(CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(_disposal is not null, this);
        if (!HasInput)
            throw new InvalidOperationException("UpdateAsync requires Options or RawOptions.");

        // Before allocation the initial apply consumes the latest configuration once.
        if (Instance is null)
        {
            await InitializeAsync(cancellationToken);
            return;
        }

        // Capture before the first asynchronous queue wait. All mutating paths use the same instance queue.
        try
        {
            if (Options is not null)
                await Instance!.SetOptionAsync(Options, UpdateOptions, cancellationToken);
            else
                await Instance!.SetOptionAsync(RawOptions!.Value, UpdateOptions, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            await NotifyErrorAsync(new("ChartUpdateFailed", exception.Message, exception) { Operation = "setOption" });
            throw;
        }
    }

    /// <summary>Cancels pending work and releases only this component's handles. Repeated calls share one completion.</summary>
    public ValueTask DisposeAsync()
    {
        if (_disposal is not null)
            return new(_disposal);

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _disposal = completion.Task;
        _lifecycle.Disposing();
        _ = DisposeCoreAsync(completion);
        return new(completion.Task);
    }

    private async Task DisposeCoreAsync(TaskCompletionSource completion)
    {
        try
        {
            // Initialization observes cancellation without waiting for a shared runtime import to finish.
            if (_allocation is not null)
                await _allocation;

            if (_resources is { } owner)
                await CleanupAsync(owner);

            _lifecycle.Disposed();
            _lifecycle.Dispose();
            completion.SetResult();
        }
        catch (Exception error)
        {
            _lifecycle.Disposed();
            completion.SetException(error);
        }
    }

    private Task CleanupAsync(Resources owner)
    {
        if (owner.Cleanup is not null)
            return owner.Cleanup;

        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        owner.Cleanup = completion.Task;
        _ = CleanupCoreAsync(owner, completion);
        return completion.Task;
    }

    private async Task CleanupCoreAsync(Resources owner, TaskCompletionSource completion)
    {
        try
        {
            try
            {
                if (owner.Allocated is not null)
                    await owner.Allocated.DisposeAsync();
            }
            finally
            {
                try
                {
                    if (owner.Observation is not null)
                        await Runtime.ReleaseObservationAsync(owner.Observation);
                }
                finally
                {
                    owner.Callback?.Dispose();
                }
            }

            completion.TrySetResult();
        }
        catch (Exception error)
        {
            completion.TrySetException(error);
        }
        finally
        {
            if (ReferenceEquals(_resources, owner))
                _resources = null;
        }
    }
}
