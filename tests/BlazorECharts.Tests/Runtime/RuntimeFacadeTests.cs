using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class RuntimeFacadeTests
{
    [Fact]
    public async Task CancelledAllocation_ReleasesAllocatedChart()
    {
        // Arrange
        var js = new BrowserBridge();
        js.Module.CreationGate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new());
        using var cancellation = new CancellationTokenSource();

        // Act
        var creating = runtime.CreateInstanceAsync(default, cancellationToken: cancellation.Token).AsTask();
        await js.Module.Created(1).WaitAsync(TimeSpan.FromSeconds(3));
        cancellation.Cancel();
        js.Module.CreationGate.SetResult();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => creating);
        Assert.Equal(1, js.Module.ChartDisposals);
    }

    [Fact]
    public async Task ConcurrentCreations_DoNotWaitForEachOther_AndRegisterExportReadinessWithTheAllocation()
    {
        // Arrange
        var js = new BrowserBridge();
        js.Module.CreationGate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new());

        // Act
        var creating = Enumerable.Range(0, 3).Select(_ => runtime.CreateInstanceAsync(default).AsTask()).ToArray();

        // Creations that wait for each other never reach three dispatches; release them anyway so that disposal ends.
        try
        {
            await js.Module.Created(3).WaitAsync(TimeSpan.FromSeconds(3));
        }
        finally
        {
            js.Module.CreationGate.SetResult();
        }

        var charts = await Task.WhenAll(creating);

        // Assert
        Assert.Equal(3, charts.Select(c => c.Id).Distinct().Count());
        Assert.All(js.Module.CreateArguments, args => Assert.IsType<DotNetObjectReference<EChartInstance.ExportReadiness>>(args[5]));
        Assert.DoesNotContain("registerExportReadiness", js.Module.Calls);
    }

    [Fact]
    public async Task Disposal_WaitsForAnAllocationInFlight_AndReleasesIt()
    {
        // Arrange
        var js = new BrowserBridge();
        js.Module.CreationGate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var runtime = new EChartsRuntime(js, new TestNavigation(), new());

        // Act
        var creating = runtime.CreateInstanceAsync(default).AsTask();
        await js.Module.Created(1).WaitAsync(TimeSpan.FromSeconds(3));
        var disposing = runtime.DisposeAsync().AsTask();
        bool waited;
        try
        {
            await Task.Delay(50);
            waited = !disposing.IsCompleted && js.Module.FacadeReleases == 0;
        }
        finally
        {
            js.Module.CreationGate.SetResult();
        }

        // Assert
        Assert.True(waited);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => creating);
        await disposing;
        Assert.Equal(1, js.Module.ChartDisposals);
        Assert.Equal(["createChart", "disposeChart", "releaseFacade"], js.Module.Calls.Where(c => c != "openFacade"));
    }

    [Fact]
    public async Task Facade_ConcurrentInitializationAndDisposalOwnOnlyTheirHandles()
    {
        // Arrange
        var js = new BrowserBridge();
        var services = new ServiceCollection();
        services.AddSingleton<IJSRuntime>(js);
        services.AddSingleton<NavigationManager>(new TestNavigation());
        services.AddECharts();
        await using var provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var runtime = scope.ServiceProvider.GetRequiredService<EChartsRuntime>();

        // Act
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => runtime.InitializeAsync().AsTask()));

        // Assert
        Assert.Single(js.Imports);
        Assert.Equal("https://example.test/charts-test/_content/BlazorECharts/js/runtime-loader.js", js.Imports[0]);

        // Act
        var instance = await runtime.CreateInstanceAsync(default(ElementReference));
        await runtime.DisposeAsync();

        // Assert
        Assert.True(instance.IsDisposed);
        Assert.Equal(1, js.Module.ChartDisposals);
        Assert.Equal(1, js.Module.FacadeReleases);
        Assert.Equal(1, js.Module.Disposals);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => runtime.InitializeAsync().AsTask());
    }

    [Fact]
    public async Task FailedStableLoaderUrl_FallsBackToAFacadeUrl_AndRetryAddsTheAttempt()
    {
        // Arrange
        var js = new BrowserBridge { FailingImports = 3 };
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new());

        // Act & Assert
        await Assert.ThrowsAsync<JSException>(() => runtime.InitializeAsync().AsTask());
        await Assert.ThrowsAsync<JSException>(() => runtime.InitializeAsync().AsTask());

        // Act
        await runtime.InitializeAsync();

        // Assert
        const string loader = "https://example.test/charts-test/_content/BlazorECharts/js/runtime-loader.js";
        Assert.Equal(loader, js.Imports[0]);
        Assert.Matches("^" + System.Text.RegularExpressions.Regex.Escape(loader) + @"\?__blazorecharts_facade=[0-9a-f]{32}$", js.Imports[1]);
        Assert.Matches(@"\?__blazorecharts_facade=[0-9a-f]{32}&__blazorecharts_retry=1$", js.Imports[2]);
        Assert.Matches(@"\?__blazorecharts_facade=[0-9a-f]{32}&__blazorecharts_retry=2$", js.Imports[3]);
    }

    [Fact]
    public async Task Options_AreFrozenAtFirstUse()
    {
        // Arrange
        var options = new EChartsRuntimeOptions();
        await using var runtime = new EChartsRuntime(new BrowserBridge(), new TestNavigation(), options);

        // Act
        await runtime.InitializeAsync();

        // Assert
        Assert.Throws<InvalidOperationException>(() => options.Provider = EChartsRuntimeProvider.Custom);
        Assert.Throws<InvalidOperationException>(() => options.ModuleUrl = "provider.js");
    }

    [Fact]
    public void Options_RejectInvalidValuesWhenSet()
    {
        // Arrange
        var options = new EChartsRuntimeOptions();

        // Act & Assert
        Assert.Equal(EChartsRuntimeProvider.Local, options.Provider);
        Assert.Throws<ArgumentOutOfRangeException>(() => options.Provider = (EChartsRuntimeProvider)7);
        Assert.Throws<ArgumentException>(() => options.Version = " ");
        Assert.Throws<ArgumentException>(() => options.ModuleUrl = "");
        Assert.Throws<ArgumentException>(() => options.ExportName = " ");

        // Act
        options.Provider = EChartsRuntimeProvider.Module;
        options.ModuleUrl = "https://cdn.example/echarts.mjs";
        options.ModuleUrl = null;

        // Assert
        Assert.Equal(EChartsRuntimeProvider.Module, options.Provider);
    }

    [Fact]
    public async Task InteropTimeout_CanBeExplicitlyRetried()
    {
        // Arrange
        var js = new BrowserBridge { PendingImport = Task.FromCanceled<IJSObjectReference>(new CancellationToken(true)) };
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new EChartsRuntimeOptions());

        // Act & Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runtime.InitializeAsync().AsTask());

        // Act
        js.PendingImport = null;
        await runtime.InitializeAsync();

        // Assert
        Assert.Equal(2, js.Imports.Count);
        Assert.Equal("page", runtime.RuntimeId);
    }

    [Fact]
    public async Task CancelledWait_DoesNotCancelSharedInitializationOrLeakLateModule()
    {
        // Arrange
        var gate = new TaskCompletionSource<IJSObjectReference>(TaskCreationOptions.RunContinuationsAsynchronously);
        var js = new BrowserBridge { PendingImport = gate.Task };
        var runtime = new EChartsRuntime(js, new TestNavigation(), new EChartsRuntimeOptions());
        using var cancellation = new CancellationTokenSource();

        // Act
        var initialization = runtime.InitializeAsync(cancellation.Token).AsTask();
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => initialization);

        // Act
        var disposal = runtime.DisposeAsync().AsTask();
        gate.SetResult(js.Module);
        await disposal;

        // Assert
        Assert.Equal(1, js.Module.FacadeReleases);
        Assert.Equal(1, js.Module.Disposals);
        Assert.Single(js.Imports);
    }

    [Fact]
    public async Task FirstImport_UsesTheFingerprintedLoaderOfTheHostAssets()
    {
        // Arrange
        var js = new BrowserBridge { FailingImports = 1 };
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new());
        runtime.UseAssets(new ResourceAssetCollection([new ResourceAsset("_content/BlazorECharts/js/runtime-loader.abc123.js",
            [new ResourceAssetProperty("label", "_content/BlazorECharts/js/runtime-loader.js")])]));

        // Act
        await runtime.InitializeAsync();

        // Assert
        const string loader = "https://example.test/charts-test/_content/BlazorECharts/js/runtime-loader.abc123.js";
        Assert.Equal(loader, js.Imports[0]);
        Assert.StartsWith(loader + "?__blazorecharts_facade=", js.Imports[1], StringComparison.Ordinal);
    }

    [Fact]
    public async Task FirstImport_WithoutFingerprintedAssets_UsesTheStableLoaderUrl()
    {
        // Arrange
        var js = new BrowserBridge();
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new());
        runtime.UseAssets(ResourceAssetCollection.Empty);

        // Act
        await runtime.InitializeAsync();

        // Assert
        Assert.Equal("https://example.test/charts-test/_content/BlazorECharts/js/runtime-loader.js", Assert.Single(js.Imports));
    }

    [Fact]
    public async Task OpenFacade_SendsTheRuntimeProtocolFirst_AndTheBuiltLoaderDeclaresIt()
    {
        // Arrange
        var js = new BrowserBridge();
        await using var runtime = new EChartsRuntime(js, new TestNavigation(), new());

        // Act
        await runtime.InitializeAsync();

        // Assert
        Assert.Equal(EChartsRuntime.RuntimeProtocol, js.Module.FacadeArguments![0]);
        Assert.IsType<string>(js.Module.FacadeArguments[1]);

        // Arrange
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (!File.Exists(Path.Combine(directory!.FullName, "BlazorECharts.slnx")))
            directory = directory.Parent;

        var bundle = File.ReadAllText(Path.Combine(directory.FullName, "src/BlazorECharts/wwwroot/js/runtime-loader.js"));

        // Assert
        Assert.Contains($"BlazorECharts.page-runtime.v{EChartsRuntime.RuntimeProtocol}\"", bundle, StringComparison.Ordinal);
    }

    private sealed class TestNavigation : NavigationManager
    {
        public TestNavigation() => Initialize("https://example.test/charts-test/", "https://example.test/charts-test/runtime");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class BrowserBridge : IJSRuntime
    {
        public readonly List<string> Imports = [];
        public readonly ModuleBridge Module = new();
        public Task<IJSObjectReference>? PendingImport;
        public int FailingImports;

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public async ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            Assert.Equal("import", identifier);
            Imports.Add((string)args![0]!);
            if (FailingImports-- > 0)
                throw new JSException("Failed to fetch dynamically imported module.");

            return (TValue)(object)(PendingImport is null ? Module : await PendingImport);
        }
    }

    private sealed class ModuleBridge : IJSObjectReference
    {
        public int Disposals;
        public int ChartDisposals;
        public int FacadeReleases;
        public object?[]? FacadeArguments;
        public TaskCompletionSource? CreationGate;
        public readonly List<string> Calls = [];
        public readonly List<object?[]> CreateArguments = [];
        private readonly object _gate = new();
        private readonly List<(int Count, TaskCompletionSource Reached)> _created = [];
        private int _charts;

        public Task Created(int count)
        {
            lock (_gate)
            {
                if (CreateArguments.Count >= count)
                    return Task.CompletedTask;

                var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                _created.Add((count, reached));
                return reached.Task;
            }
        }

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            object? result = null;
            lock (_gate)
                Calls.Add(identifier);

            switch (identifier)
            {
                case "openFacade":
                    FacadeArguments = args;
                    result = "page";
                    break;
                case "createChart":
                    var id = "chart" + (_charts == 0 ? "" : _charts.ToString(System.Globalization.CultureInfo.InvariantCulture));
                    _charts++;
                    lock (_gate)
                    {
                        CreateArguments.Add(args!);
                        foreach (var (count, reached) in _created)
                            if (CreateArguments.Count >= count)
                                reached.TrySetResult();
                    }

                    if (CreationGate is not null)
                        return new(CreationAsync<TValue>(id));

                    result = id;
                    break;
                case "disposeChart":
                    ChartDisposals++;
                    break;
                case "releaseFacade":
                    FacadeReleases++;
                    break;
                default:
                    throw new InvalidOperationException(identifier);
            }

            return ValueTask.FromResult<TValue>(result is null ? default! : (TValue)result);
        }

        public ValueTask DisposeAsync()
        {
            Disposals++;
            return ValueTask.CompletedTask;
        }

        private async Task<TValue> CreationAsync<TValue>(string id)
        {
            await CreationGate!.Task;
            return (TValue)(object)id;
        }
    }
}
