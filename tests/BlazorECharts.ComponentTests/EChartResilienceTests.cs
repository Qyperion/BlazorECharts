using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using Bunit;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.ComponentTests;

/// <summary>Backpressure, hidden containers and the error channel of the EChart component.</summary>
public sealed class EChartResilienceTests : BunitContext
{
    private readonly BrowserInterop _browser = new();
    private readonly LogSink _logs = new();

    public EChartResilienceTests()
    {
        Services.AddSingleton<IJSRuntime>(_browser);
        Services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Debug).AddProvider(_logs));
        Services.AddECharts();
        SetRendererInfo(new RendererInfo("Server", true));
        _browser.Renderer = Renderer.Dispatcher;
    }

    [Fact]
    public async Task SeventyRendersWithBlockedTransport_ApplyTheLatestOptionsWithoutErrors()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(-1)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.Application = new(TaskCreationOptions.RunContinuationsAsynchronously);

        // Act
        for (var i = 0; i < 70; i++)
            component.Render(p => p.Add(x => x.Options, Titled(i)));

        // Assert
        Assert.Empty(errors);
        Assert.Equal(ChartState.Ready, component.Instance.State);

        // Act
        await component.InvokeAsync(() => _browser.Application.SetResult());

        // The retry runs on the renderer from a transport thread: poll without blocking the bUnit dispatcher.
        await Until(() => _browser.Options[^1].GetProperty("title").GetProperty("text").GetString() == "69");

        // Assert
        Assert.Equal("69", _browser.Options[^1].GetProperty("title").GetProperty("text").GetString());
        Assert.Empty(errors);
        Assert.True(_browser.Options.Count <= 72);
    }

    [Fact]
    public async Task FullQueueDuringInitOptionsChange_DoesNotDestroyTheChart()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(-1)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.Application = new(TaskCreationOptions.RunContinuationsAsynchronously);
        for (var i = 0; i < 65; i++)
            component.Render(p => p.Add(x => x.Options, Titled(i)));

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }));

        // Assert
        Assert.Empty(errors);
        Assert.Equal(ChartState.Ready, component.Instance.State);

        // Act
        await component.InvokeAsync(() => _browser.Application.SetResult());
        await Until(() => _browser.Calls.Contains("recreateChart"));

        // Assert
        Assert.Contains("recreateChart", _browser.Calls);
        Assert.Empty(errors);
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Equal(0, _browser.Calls.Count(c => c == "disposeChart"));
    }

    [Fact]
    public async Task RecreateInHiddenContainer_KeepsTheChartAndRetriesWhenShown()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        var instance = component.Instance.Instance!;
        _browser.Hidden = true;

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }));
        await Until(() => _browser.Calls.Contains("checkChartSize"));

        // Assert
        Assert.Contains("checkChartSize", _browser.Calls);
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Same(instance, component.Instance.Instance);
        Assert.Empty(errors);

        // Act
        await instance.SetOptionAsync(Titled(1));
        _browser.Hidden = false;
        await component.InvokeAsync(() => _browser.Lifecycle!.Value.ContainerReady(component.Instance.Generation));
        await Until(() => _browser.Calls.Count(c => c == "recreateChart") == 2);

        // Assert
        Assert.Equal(2, _browser.Calls.Count(c => c == "recreateChart"));

        // Act
        await instance.SetOptionAsync(Titled(2));

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Empty(errors);
        Assert.Equal(2, instance.AcceptedRevision.Generation);
    }

    [Fact]
    public async Task NewOptionsWhileHidden_ApplyBeforeTheContainerIsShown()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.Hidden = true;
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }));
        await Until(() => _browser.Calls.Contains("checkChartSize"));

        // Act
        component.Render(p => p.Add(x => x.Options, Titled(1)));
        await Until(() => Title(_browser.Options[^1]) == "1");

        // Assert
        Assert.Equal("1", Title(_browser.Options[^1]));
        Assert.Equal(1, _browser.Calls.Count(c => c == "recreateChart"));

        // Act
        _browser.Hidden = false;
        await component.InvokeAsync(() => _browser.Lifecycle!.Value.ContainerReady(component.Instance.Generation));
        await Until(() => _browser.Calls.Count(c => c == "recreateChart") == 2);

        // Assert
        Assert.Equal(2, _browser.Calls.Count(c => c == "recreateChart"));
        Assert.Equal("1", Title(_browser.Options[^1]));
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Empty(errors);
    }

    [Fact]
    public async Task InvalidInitOptionsWaitingForAQueueSlot_AreReported_AndLaterParametersApply()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(-1)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.Application = new(TaskCreationOptions.RunContinuationsAsynchronously);

        // One command in flight and 64 queued: the next parameters wait for a free slot.
        for (var i = 0; i < 66; i++)
            component.Render(p => p.Add(x => x.Options, Titled(i)));

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { DevicePixelRatio = double.NaN }));

        // Assert
        Assert.Empty(errors);

        // Act
        await component.InvokeAsync(() => _browser.Application.SetResult());
        await Until(() => errors.Count != 0);

        // Assert
        var error = Assert.Single(errors);
        Assert.Equal(("ChartUpdateFailed", "recreate"), (error.Code, error.Operation));
        Assert.IsType<OptionSerializationException>(error.Exception);
        Assert.Equal(ChartState.Ready, component.Instance.State);

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }).Add(x => x.Options, Titled(100)));
        await Until(() => _browser.Calls.Contains("recreateChart") && Title(_browser.Options[^1]) == "100");

        // Assert
        Assert.Contains("recreateChart", _browser.Calls);
        Assert.Equal("100", Title(_browser.Options[^1]));
        Assert.Single(errors);
    }

    [Fact]
    public async Task InvalidInitOptionsWaitingForAHiddenContainer_AreReported_AndLaterParametersApply()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.Hidden = true;
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }));
        await Until(() => _browser.Calls.Contains("checkChartSize"));

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { DevicePixelRatio = double.NaN }));

        // Assert
        Assert.Empty(errors);

        // Act
        _browser.Hidden = false;
        await component.InvokeAsync(() => _browser.Lifecycle!.Value.ContainerReady(component.Instance.Generation));
        await Until(() => errors.Count != 0);

        // Assert
        var error = Assert.Single(errors);
        Assert.Equal(("ChartUpdateFailed", "recreate"), (error.Code, error.Operation));
        Assert.IsType<OptionSerializationException>(error.Exception);

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "canvas" }));
        await Until(() => _browser.Calls.Count(c => c == "recreateChart") == 2);

        // Assert
        Assert.Equal(2, _browser.Calls.Count(c => c == "recreateChart"));
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Single(errors);
    }

    [Fact]
    public async Task ParameterOfTheWrongType_UnderAnErrorBoundary_DisposesTheChartWithoutAnotherError()
    {
        // Act
        var boundary = Render<ErrorBoundary>(p => p
            .Add(x => x.ChildContent, builder =>
            {
                builder.OpenComponent<EChart>(0);
                builder.AddAttribute(1, nameof(EChart.Options), "not chart options");
                builder.CloseComponent();
            })
            .Add(x => x.ErrorContent, error => builder => builder.AddContent(0, $"caught: {error.Message}")));
        boundary.WaitForAssertion(() => Assert.Contains("caught:", boundary.Markup, StringComparison.Ordinal));

        // Assert
        Assert.Contains(nameof(EChart.Options), boundary.Markup, StringComparison.Ordinal);
        await Task.Delay(100);
        if (Renderer.UnhandledException.IsCompleted)
            Assert.Fail((await Renderer.UnhandledException).ToString());

        Assert.Empty(_browser.Calls);

        // Arrange
        var chart = new EChart();
        Assert.Equal((ChartState.NotInitialized, 0), (chart.State, chart.Generation));

        // Act
        await chart.DisposeAsync();

        // Assert
        Assert.Equal(ChartState.Disposed, chart.State);
    }

    [Fact]
    public async Task LostDeclarativeUpdateReply_ReportsResultTimeout_AndLaterOptionsApply()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.TimeOutApplication = true;

        // Act
        component.Render(p => p.Add(x => x.Options, Titled(1)));
        await Until(() => errors.Count != 0);

        // Assert
        var error = Assert.Single(errors);
        Assert.Equal(("ChartUpdateFailed", "setOption", "ResultTimeout"), (error.Code, error.Operation, error.DetailCode));
        Assert.IsType<TimeoutException>(error.Exception);
        Assert.Equal(ChartState.Ready, component.Instance.State);

        // Act
        component.Render(p => p.Add(x => x.Options, Titled(2)));
        await Until(() => Title(_browser.Options[^1]) == "2");

        // Assert
        Assert.Equal("2", Title(_browser.Options[^1]));
        Assert.Single(errors);
    }

    [Fact]
    public async Task LostInitialApplicationReply_FailsInitializationWithResultTimeout()
    {
        // Arrange
        var errors = new List<EChartsError>();
        _browser.TimeOutApplication = true;

        // Act
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Assert
        var error = Assert.Single(errors);
        Assert.Equal(("ChartInitializationFailed", "initialize", "ResultTimeout"), (error.Code, error.Operation, error.DetailCode));

        // Act
        await component.Instance.InitializeAsync();

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
    }

    [Fact]
    public async Task BrowserErrorFlood_IsTruncatedAndRateLimited()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        var lifecycle = _browser.Lifecycle!.Value;
        var generation = component.Instance.Generation;
        var message = new string('x', 100_000);

        // Act
        for (var i = 0; i < 50; i++)
            await component.InvokeAsync(() => lifecycle.BrowserError(generation, "ChartResizeFailed", message));

        await Until(() => errors.Count != 0);
        for (var i = 0; i < 50; i++)
            await component.InvokeAsync(
                () => lifecycle.BrowserError(generation, $"CallbackFailed{(char)('A' + i % 26)}{(char)('A' + i / 26)}", message));

        await Until(() => errors.Count >= 5);
        await Task.Delay(100);

        // Assert
        Assert.Equal(5, errors.Count);
        Assert.Equal("ChartResizeFailed", errors[0].Code);
        Assert.All(errors, error => Assert.InRange(error.Message.Length, 1, 1024));
    }

    [Fact]
    public async Task BrowserErrorWithoutOnError_IsLoggedAtWarning()
    {
        // Arrange
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));

        // Act
        await component.InvokeAsync(
            () => _browser.Lifecycle!.Value.BrowserError(component.Instance.Generation, "ChartResizeFailed", "resize failed"));
        await Until(() => _logs.Entries.Count(e => e.Level >= LogLevel.Warning) != 0);

        // Assert
        var entry = Assert.Single(_logs.Entries, e => e.Level >= LogLevel.Warning);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Contains("ChartResizeFailed", entry.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void FailureWithoutOnError_IsLoggedAsError()
    {
        // Arrange
        _browser.FailImport = true;

        // Act
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Assert
        var entry = Assert.Single(_logs.Entries, e => e.Level == LogLevel.Error);
        Assert.Contains("ChartInitializationFailed", entry.Message, StringComparison.Ordinal);
        Assert.NotNull(entry.Exception);
    }

    [Fact]
    public void FailureWithOnError_IsLoggedAtDebug()
    {
        // Arrange
        _browser.FailImport = true;

        // Act
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, _ => { }));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Assert
        Assert.DoesNotContain(_logs.Entries, e => e.Level >= LogLevel.Warning);
        Assert.Contains(
            _logs.Entries,
            e => e.Level == LogLevel.Debug && e.Message.Contains("ChartInitializationFailed", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ThrowingOnErrorHandler_ReachesTheRenderer()
    {
        // bUnit rethrows an exception that reached the renderer from the next render, or exposes it as UnhandledException.

        // Arrange
        _browser.FailImport = true;

        // Act
        Exception unhandled;
        try
        {
            Render<EChart>(p => p
                .Add(x => x.Options, new ChartOptions())
                .Add(x => x.OnError, (EChartsError _) => throw new InvalidOperationException("handler bug")));
            unhandled = await Renderer.UnhandledException.WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (InvalidOperationException error)
        {
            unhandled = error;
        }

        // Assert
        Assert.Equal("handler bug", unhandled.Message);
    }

    [Fact]
    public async Task CommandQueuedDuringFailedInitialization_FailsWithTheCause()
    {
        // Arrange
        _browser.FailApplication = true;
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _browser.InitialApplication = gate;
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, _ => { }));
        component.WaitForAssertion(() => Assert.NotNull(component.Instance.Instance));
        var queued = component.Instance.Instance!.SetOptionAsync(Titled(1)).AsTask();

        // Act
        await component.InvokeAsync(() => gate.SetResult());
        var error = await Assert.ThrowsAnyAsync<Exception>(() => queued.WaitAsync(TimeSpan.FromSeconds(5)));

        // Assert
        Assert.IsNotType<TaskCanceledException>(error);
        Assert.Contains("setOption failed", error.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AutoResizeChange_AppliesToTheInitializedChart()
    {
        // Arrange
        var component = Render<EChart>(p => p.Add(x => x.Options, Titled(0)));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));

        // Act
        component.Render(p => p.Add(x => x.AutoResize, false));
        await Until(() => _browser.AutoResize.Count == 1);
        component.Render(p => p.Add(x => x.AutoResize, false).Add(x => x.Options, Titled(1)));
        component.Render(p => p.Add(x => x.AutoResize, true));
        await Until(() => _browser.AutoResize.Count == 2);

        // Assert
        Assert.Equal([false, true], _browser.AutoResize);
    }

    [Fact]
    public async Task PublicMethods_CalledOffTheRenderer_RunOnTheDispatcher()
    {
        // Arrange
        _browser.FailImport = true;
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, _ => { }));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));
        _browser.FailImport = false;

        // Act
        await Task.Run(() => component.Instance.InitializeAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);

        // Act
        await Task.Run(() => component.Instance.UpdateAsync().AsTask()).WaitAsync(TimeSpan.FromSeconds(5));

        // Assert
        Assert.True(_browser.OffDispatcherCalls == 0, $"{_browser.OffDispatcherCalls} interop calls ran off the renderer dispatcher.");
    }

    private static async Task Until(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++)
            await Task.Delay(25);
    }

    private static string? Title(JsonElement option) => option.GetProperty("title").GetProperty("text").GetString();

    private static ChartOptions Titled(int i) =>
        new() { Title = new TitleOption { Text = i.ToString(System.Globalization.CultureInfo.InvariantCulture) } };

    private sealed class BrowserInterop : IJSRuntime, IJSObjectReference
    {
        public List<JsonElement> Options { get; } = [];
        public List<string> Calls { get; } = [];

        public TaskCompletionSource? Application;
        public TaskCompletionSource? InitialApplication;
        public bool Hidden;
        public bool FailImport;
        public bool FailApplication;
        public bool TimeOutApplication;
        public DotNetObjectReference<ChartLifecycle>? Lifecycle;

        public List<bool> AutoResize { get; } = [];

        public Dispatcher? Renderer;
        public int OffDispatcherCalls;
        private int _nextId;

        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);

        public async ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken token, object?[]? args)
        {
            Calls.Add(identifier);
            if (identifier is "import" or "openFacade" && Renderer is { } renderer && !renderer.CheckAccess())
                Interlocked.Increment(ref OffDispatcherCalls);

            if (identifier == "setAutoResize")
                AutoResize.Add((bool)args![2]!);

            if (identifier == "import" && FailImport)
                throw new JSException("[RuntimeLoadFailed] import failed");

            if (identifier == "observeChart")
                Lifecycle = (DotNetObjectReference<ChartLifecycle>)args![5]!;

            if (identifier == "recreateChart" && Hidden)
                throw new JSException("[ChartContainerNotReady] Cannot recreate a hidden or removed chart.");

            if (identifier == "setOption")
            {
                Options.Add(JsonDocument.Parse((byte[])args![2]!).RootElement.Clone());

                // JSRuntime ends a call whose reply never came after its default timeout with a cancellation.
                if (TimeOutApplication)
                {
                    TimeOutApplication = false;
                    throw new TaskCanceledException();
                }

                if (InitialApplication is not null)
                {
                    var gate = InitialApplication;
                    InitialApplication = null;
                    await gate.Task;
                    if (FailApplication)
                        throw new JSException("setOption failed");
                }
                else if (FailApplication)
                    throw new JSException("setOption failed");

                if (Application is not null)
                    await Application.Task;
            }

            object? result = identifier switch
            {
                "import" => this,
                "openFacade" => "page:1",
                "observeChart" => true,
                "checkChartSize" => !Hidden,
                "createChart" => $"chart:{++_nextId}",
                _ => default(T),
            };
            return (T)result!;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed record LogEntry(LogLevel Level, string Message, Exception? Exception);

    private sealed class LogSink : ILoggerProvider
    {
        public List<LogEntry> Entries { get; } = [];

        public ILogger CreateLogger(string categoryName) =>
            categoryName == typeof(EChart).FullName ? new Logger(this) : Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance;

        public void Dispose() { }

        private sealed class Logger(LogSink sink) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (sink.Entries)
                    sink.Entries.Add(new(logLevel, formatter(state, exception), exception));
            }
        }
    }
}
