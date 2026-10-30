using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Bunit;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.ComponentTests;

public sealed class EChartLifecycleTests : BunitContext
{
    private readonly BrowserInterop _browser = new();

    public EChartLifecycleTests()
    {
        Services.AddSingleton<IJSRuntime>(_browser);
        Services.AddECharts();
        SetRendererInfo(new RendererInfo("Server", true));
    }

    [Fact]
    public void Prerender_DoesNotInvokeJavaScript()
    {
        // Arrange
        SetRendererInfo(new RendererInfo("Static", false));

        // Act
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));

        // Assert
        Assert.Equal(ChartState.NotInitialized, component.Instance.State);
        Assert.Empty(_browser.Calls);
        Assert.Equal("NotInitialized", component.Find("div").GetAttribute("data-chart-state"));
    }

    [Fact]
    public void UnmatchedAttributes_ReachTheContainer_ParametersAndStateWin()
    {
        // Arrange
        SetRendererInfo(new RendererInfo("Static", false));

        // Act
        var component = Render<EChart>(p => p
            .AddUnmatched("id", "sales")
            .AddUnmatched("aria-describedby", "summary")
            .AddUnmatched("data-chart-state", "forged")
            .Add(x => x.Class, "chart")
            .Add(x => x.Style, "height:300px"));

        // Assert
        var element = component.Find("div");
        Assert.Equal("sales", element.GetAttribute("id"));
        Assert.Equal("summary", element.GetAttribute("aria-describedby"));
        Assert.Equal("chart", element.GetAttribute("class"));
        Assert.Equal("height:300px", element.GetAttribute("style"));
        Assert.Equal("NotInitialized", element.GetAttribute("data-chart-state"));
    }

    [Fact]
    public void NullInputThenOptions_InitializesOnce()
    {
        // Arrange
        var ready = 0;

        // Act
        var component = Render<EChart>(p => p.Add(x => x.OnReady, _ => ready++));

        // Assert
        Assert.Empty(_browser.Calls);

        // Act
        component.Render(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        component.Render();

        // Assert
        Assert.Equal(1, ready);
        Assert.Equal(1, _browser.Calls.Count(x => x == "createChart"));
        Assert.False(_browser.LastOption.GetProperty("json").GetProperty("animation").GetBoolean());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task HandleDisposedOutsideTheComponent_FailsAndRetries(bool throughRuntime)
    {
        // Arrange
        var errors = new List<EChartsError>();
        var reported = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var component = Render<EChart>(p => p
            .Add(x => x.Options, new ChartOptions())
            .Add(x => x.OnError, e =>
            {
                errors.Add(e);
                reported.TrySetResult();
            }));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        var handle = component.Instance.Instance!;

        // Act
        if (throughRuntime)
            await Services.GetRequiredService<EChartsRuntime>().DisposeChartAsync(handle);
        else
            await handle.DisposeAsync();

        await reported.Task.WaitAsync(TimeSpan.FromSeconds(10));

        // Assert
        Assert.Equal(ChartState.Failed, component.Instance.State);
        Assert.Null(component.Instance.Instance);
        var error = Assert.Single(errors);
        Assert.Equal("ChartDisposed", error.Code);
        Assert.Equal(handle.Id, error.ChartId);

        // Act
        await component.InvokeAsync(() => component.Instance.InitializeAsync().AsTask());

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.NotSame(handle, component.Instance.Instance);
    }

    [Fact]
    public void TypedAndRawTogether_Rejects()
    {
        // Arrange
        using var raw = JsonDocument.Parse("{}");

        // Act
        var error = Assert.Throws<InvalidOperationException>(() => Render<EChart>(p => p
            .Add(x => x.Options, new ChartOptions())
            .Add(x => x.RawOptions, raw.RootElement)));

        // Assert
        Assert.Contains("RawOptions", error.Message);
        Assert.Contains("Options", error.Message);
        Assert.Empty(_browser.Calls);
    }

    [Fact]
    public async Task InitFailure_ExplicitRetryCreatesNewGeneration()
    {
        // Arrange
        _browser.FailImport = true;
        var errors = new List<EChartsError>();
        var ready = 0;

        // Act
        var component = Render<EChart>(p => p
            .Add(x => x.Options, new ChartOptions())
            .Add(x => x.OnError, errors.Add)
            .Add(x => x.OnReady, _ => ready++));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Assert
        var error = Assert.Single(errors);
        Assert.Equal("ChartInitializationFailed", error.Code);
        Assert.Equal("RuntimeLoadFailed", error.DetailCode);

        // Act
        _browser.FailImport = false;
        await component.InvokeAsync(() => component.Instance.InitializeAsync().AsTask());

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Equal(1, ready);
        Assert.Equal(2, component.Instance.Generation);
    }

    [Fact]
    public async Task FailedExplicitCall_RejectsAndNotifies()
    {
        // Arrange
        var errors = new List<EChartsError>();
        _browser.FailImport = true;
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Act
        await Assert.ThrowsAsync<JSException>(() => component.InvokeAsync(() => component.Instance.InitializeAsync().AsTask()));

        // Assert
        Assert.Equal(2, errors.Count);
        Assert.Equal(ChartState.Failed, component.Instance.State);
    }

    [Fact]
    public async Task DisposeDuringImport_NoLateChartOrReady()
    {
        // Arrange
        _browser.Import = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var ready = 0;
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnReady, _ => ready++));
        component.WaitForAssertion(() => Assert.Contains("import", _browser.Calls));
        var pendingInitialization = component.Instance.InitializeAsync().AsTask();

        // Act
        await component.InvokeAsync(() => component.Instance.DisposeAsync().AsTask());
        _browser.Import.SetResult(_browser);
        await Services.GetRequiredService<EChartsRuntime>().InitializeAsync();

        // Assert
        Assert.Equal(ChartState.Disposed, component.Instance.State);
        Assert.DoesNotContain("createChart", _browser.Calls);
        Assert.DoesNotContain("observeChart", _browser.Calls);
        Assert.Equal(0, ready);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pendingInitialization);
    }

    [Fact]
    public async Task InputWithdrawnDuringImport_WaitsForValidInputInSameGeneration()
    {
        // Arrange
        _browser.Import = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, errors.Add));

        // Act
        component.Render(p => p.Add(x => x.Options, null));
        _browser.Import.SetResult(_browser);
        await Services.GetRequiredService<EChartsRuntime>().InitializeAsync();
        await component.InvokeAsync(() => Task.CompletedTask);

        // Assert
        Assert.Empty(errors);
        Assert.DoesNotContain("createChart", _browser.Calls);
        Assert.Equal(ChartState.Initializing, component.Instance.State);

        // Act
        component.Render(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));

        // Assert
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        Assert.Equal(1, component.Instance.Generation);
        Assert.Equal(1, _browser.Calls.Count(x => x == "createChart"));
        Assert.Empty(errors);
    }

    [Fact]
    public async Task RepeatedDispose_IsIdempotent()
    {
        // Arrange
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        var instance = component.Instance.Instance!;

        // Act
        await component.InvokeAsync(() => component.Instance.DisposeAsync().AsTask());
        await component.Instance.DisposeAsync();
        await instance.DisposeAsync();

        // Assert
        Assert.Equal(ChartState.Disposed, component.Instance.State);
        Assert.Equal(1, _browser.Calls.Count(x => x == "disposeChart"));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => instance.SetOptionAsync(new ChartOptions()).AsTask());
        await Assert.ThrowsAsync<ObjectDisposedException>(() => component.Instance.InitializeAsync().AsTask());
    }

    [Fact]
    public void RawInput_UsesExistingTransport()
    {
        // Arrange
        using var raw = JsonDocument.Parse("""{"animation":false,"series":[]}""");

        // Act
        var component = Render<EChart>(p => p.Add(x => x.RawOptions, raw.RootElement));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));

        // Assert
        Assert.False(_browser.LastOption.GetProperty("json").GetProperty("animation").GetBoolean());
        Assert.Equal(0, _browser.LastOption.GetProperty("json").GetProperty("series").GetArrayLength());
    }

    [Fact]
    public void InitialApplicationFailure_ReleasesHandleAndObservation()
    {
        // Arrange
        _browser.FailApplication = true;
        var errors = new List<EChartsError>();

        // Act
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Assert
        Assert.Null(component.Instance.Instance);
        Assert.Equal("chart:1", Assert.Single(errors).ChartId);
        Assert.Equal(1, _browser.Calls.Count(x => x == "disposeChart"));
        Assert.Equal(1, _browser.Calls.Count(x => x == "releaseObservation"));
    }

    [Fact]
    public async Task DisposeDuringNativeAllocation_ReleasesLateHandle()
    {
        // Arrange
        _browser.Allocation = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var ready = 0;
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnReady, _ => ready++));
        component.WaitForAssertion(() => Assert.Contains("createChart", _browser.Calls));

        // Act
        var disposal = component.InvokeAsync(() => component.Instance.DisposeAsync().AsTask());
        _browser.Allocation.SetResult("chart:late");
        await disposal.WaitAsync(TimeSpan.FromSeconds(2));

        // Assert
        Assert.Equal(ChartState.Disposed, component.Instance.State);
        Assert.Equal(0, ready);
        Assert.DoesNotContain("setOption", _browser.Calls);
        Assert.Equal(1, _browser.Calls.Count(x => x == "disposeChart"));
        Assert.Equal(1, _browser.Calls.Count(x => x == "releaseObservation"));
    }

    [Fact]
    public async Task InstanceOperations_WaitForInitialApplication()
    {
        // Arrange
        _browser.InitialApplication = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));
        component.WaitForAssertion(() => Assert.NotNull(component.Instance.Instance));
        var instance = component.Instance.Instance!;

        // Act
        var update = instance.SetOptionAsync(new ChartOptions { Animation = false }).AsTask();

        // Assert
        Assert.False(update.IsCompleted);
        Assert.Equal(1, _browser.Calls.Count(x => x == "setOption"));

        // Act
        _browser.InitialApplication.SetResult();
        await update.WaitAsync(TimeSpan.FromSeconds(2));

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Equal(2, _browser.Calls.Count(x => x == "setOption"));
    }

    [Fact]
    public async Task CancelledWaiter_DoesNotCancelInitialization()
    {
        // Arrange
        _browser.Import = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));
        using var cancellation = new CancellationTokenSource();

        // Act
        var waiting = component.Instance.InitializeAsync(cancellation.Token).AsTask();
        cancellation.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);

        // Act
        _browser.Import.SetResult(_browser);

        // Assert
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        Assert.Equal(1, _browser.Calls.Count(x => x == "createChart"));
    }

    [Fact]
    public async Task OnError_MayExplicitlyRetryWithoutFaultingRenderer()
    {
        // Arrange
        _browser.Import = new(TaskCreationOptions.RunContinuationsAsynchronously);
        EChart? chart = null;
        var component = Render<EChart>(p => p
            .Add(x => x.Options, new ChartOptions())
            .Add(x => x.OnError, async _ =>
            {
                _browser.Import = null;
                await chart!.InitializeAsync();
            }));
        chart = component.Instance;
        var initialImport = _browser.Import;

        // Act
        initialImport!.SetException(new JSException("transient import failure"));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, chart.State));

        // The old automatic attempt must not report an already handled failure to Blazor's renderer.
        await component.InvokeAsync(() => Task.CompletedTask);

        // Assert
        Assert.False(Renderer.UnhandledException.IsCompleted);
        Assert.Equal(2, chart.Generation);
    }

    [Fact]
    public async Task OnReady_MayDisposeItsOwnComponent()
    {
        // Arrange
        _browser.Import = new(TaskCreationOptions.RunContinuationsAsynchronously);
        EChart? chart = null;
        var notification = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var component = Render<EChart>(p => p
            .Add(x => x.Options, new ChartOptions())
            .Add(x => x.OnReady, async _ =>
            {
                await chart!.DisposeAsync();
                notification.SetResult();
            }));
        chart = component.Instance;

        // Act
        _browser.Import.SetResult(_browser);
        await notification.Task.WaitAsync(TimeSpan.FromSeconds(2));

        // Assert
        Assert.Equal(ChartState.Disposed, chart.State);
        Assert.Equal(1, _browser.Calls.Count(x => x == "disposeChart"));
    }

    [Fact]
    public void DisconnectedCircuit_FailureUsesErrorChannel()
    {
        // Arrange
        _browser.Disconnected = true;
        var errors = new List<EChartsError>();

        // Act
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));

        // Assert
        Assert.Equal("CircuitDisconnected", Assert.Single(errors).Code);
    }

    private sealed class BrowserInterop : IJSRuntime, IJSObjectReference
    {
        public readonly List<string> Calls = [];
        public bool FailImport;
        public bool Disconnected;
        public bool FailApplication;
        public JsonElement LastOption;
        public TaskCompletionSource<IJSObjectReference>? Import;
        public TaskCompletionSource? InitialApplication;
        public TaskCompletionSource<string>? Allocation;

        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);

        public async ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            Calls.Add(identifier);
            if (Disconnected)
                throw new JSDisconnectedException("Circuit disconnected");

            if (identifier == "import")
            {
                if (FailImport)
                    throw new JSException("[RuntimeLoadFailed] offline");

                return (T)(object)(Import is null ? this : await Import.Task);
            }

            object? result = identifier switch
            {
                "openFacade" => "page:1",
                "observeChart" => true,
                "createChart" => Allocation is null ? "chart:1" : await Allocation.Task,
                _ => default(T),
            };
            if (identifier == "setOption")
            {
                LastOption = JsonDocument.Parse(
                    "{\"json\":"
                    + System.Text.Encoding.UTF8.GetString((byte[])args![2]!)
                    + ",\"bindings\":"
                    + (args[3] is JsonElement bindings ? bindings.GetRawText() : "[]")
                    + "}").RootElement.Clone();
                if (FailApplication)
                    throw new JSException("setOption failed");

                if (InitialApplication is not null)
                    await InitialApplication.Task.WaitAsync(cancellationToken);
            }

            return (T)result!;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
