using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Bunit;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.ComponentTests;

public sealed class EChartUpdateTests : BunitContext
{
    private readonly BrowserInterop _browser = new();

    public EChartUpdateTests()
    {
        Services.AddSingleton<IJSRuntime>(_browser);
        Services.AddECharts();
        SetRendererInfo(new RendererInfo("Server", true));
    }

    [Fact]
    public void NewReference_AppliesWithOwnUpdateOptions()
    {
        // Arrange
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));

        // Act
        component.Render(p => p
            .Add(x => x.Options, new ChartOptions { Animation = false })
            .Add(x => x.UpdateOptions, new SetOptionOptions { NotMerge = true, Silent = true }));
        component.WaitForAssertion(() => Assert.Equal(2, _browser.Options.Count));

        // Assert
        Assert.False(_browser.Options[1].GetProperty("animation").GetBoolean());
        Assert.True(_browser.Updates[1].GetProperty("notMerge").GetBoolean());
        Assert.True(_browser.Updates[1].GetProperty("silent").GetBoolean());
    }

    [Fact]
    public async Task Order_OptionsA_Patch_RerenderA_OptionsB()
    {
        // Arrange
        var a = new ChartOptions { Animation = false };
        var component = Render<EChart>(p => p.Add(x => x.Options, a));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        using var patch = JsonDocument.Parse("{\"patch\":true}");

        // Act
        await component.Instance.Instance!.SetOptionAsync(patch.RootElement);
        component.Render(p => p.Add(x => x.Options, a));
        component.Render(p => p.Add(x => x.Options, new ChartOptions { Animation = true }));
        component.WaitForAssertion(() => Assert.Equal(3, _browser.Options.Count));

        // Assert
        Assert.True(_browser.Options[1].GetProperty("patch").GetBoolean());
        Assert.True(_browser.Options[2].GetProperty("animation").GetBoolean());
    }

    [Fact]
    public async Task InputWithdrawnDuringAllocation_InitialCommandAlwaysPrecedesReadyWaiters()
    {
        // Inline continuations make the allocation->input wait deterministic on the renderer dispatcher.

        // Arrange
        _browser.Allocation = new();
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()));
        component.WaitForAssertion(() => Assert.Contains("createChart", _browser.Calls));
        var initialization = component.Instance.InitializeAsync().AsTask();

        // Act
        component.Render(p => p.Add(x => x.Options, null));
        await component.InvokeAsync(() => _browser.Allocation.SetResult("chart:1"));

        // Assert
        Assert.Empty(_browser.Options);

        // Act
        component.Render(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        await initialization.WaitAsync(TimeSpan.FromSeconds(2));

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
        Assert.Single(_browser.Options);
        Assert.False(_browser.Options[0].GetProperty("animation").GetBoolean());
    }

    [Fact]
    public async Task TwoRecreateFailures_LateCleanupCannotDisposeRetryGeneration()
    {
        // Arrange
        _browser.Recreation = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _browser.Disposal = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var errors = new List<EChartsError>();
        var recovered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        EChart? chart = null;
        var component = Render<EChart>(p => p
            .Add(x => x.Options, new ChartOptions())
            .Add(x => x.OnError, async error =>
            {
                errors.Add(error);
                _browser.Recreation = null;
                await chart!.InitializeAsync();
                recovered.TrySetResult();
            }));
        chart = component.Instance;
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, chart.State));
        var original = chart.Instance!;

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }));
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "canvas" }));
        await component.InvokeAsync(() =>
        {
            _browser.Recreation!.SetException(new JSException("recreate failed"));
        });
        await _browser.DisposalEntered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        Task retry;
        try
        {
            retry = component.InvokeAsync(() => chart.InitializeAsync().AsTask());
            Assert.False(retry.IsCompleted);
        }
        finally
        {
            _browser.Disposal.TrySetResult();
        }

        await retry.WaitAsync(TimeSpan.FromSeconds(2));
        await recovered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await chart.Instance!.SetOptionAsync(new ChartOptions());

        // Assert
        Assert.Equal(ChartState.Ready, chart.State);
        Assert.Equal(2, chart.Generation);
        Assert.NotSame(original, chart.Instance);
        Assert.False(chart.Instance!.IsDisposed);
        Assert.Single(errors);
        Assert.Equal(1, _browser.Calls.Count(c => c == "disposeChart"));
        Assert.Equal(1, _browser.Calls.Count(c => c == "releaseObservation"));
    }

    [Fact]
    public async Task UpdateDuringInitialApply_CapturesAtAcceptance_AndCannotBeOvertaken()
    {
        // Arrange
        _browser.Application = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var options = new ChartOptions { Animation = false };
        var component = Render<EChart>(p => p.Add(x => x.Options, options));
        component.WaitForAssertion(() => Assert.Single(_browser.Options));
        options.Animation = true;

        // Act
        var update = component.InvokeAsync(() => component.Instance.UpdateAsync().AsTask());
        component.Render(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        _browser.Application.SetResult();
        await update;
        await component.Instance.Instance!.SetOptionAsync(new ChartOptions());

        // Assert
        Assert.True(_browser.Options[1].GetProperty("animation").GetBoolean());
        Assert.False(_browser.Options[2].GetProperty("animation").GetBoolean());
    }

    [Fact]
    public async Task RecreationFailure_UsesErrorChannel_AndExplicitRetryRecovers()
    {
        // Arrange
        var errors = new List<EChartsError>();
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions()).Add(x => x.OnError, errors.Add));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        _browser.FailRecreate = true;

        // Act
        component.Render(p => p.Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" }));

        // Assert
        component.WaitForAssertion(() => Assert.Equal(ChartState.Failed, component.Instance.State));
        Assert.Equal("recreate", Assert.Single(errors).Operation);

        // Act
        _browser.FailRecreate = false;
        await component.InvokeAsync(() => component.Instance.InitializeAsync().AsTask());

        // Assert
        Assert.Equal(ChartState.Ready, component.Instance.State);
    }

    [Fact]
    public async Task RecreateBeforeFirstSnapshot_UsesLatestAcceptedConfiguration()
    {
        // Arrange
        _browser.Application = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var component = Render<EChart>(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        component.WaitForAssertion(() => Assert.Single(_browser.Options));

        // Act
        component.Render(p => p
            .Add(x => x.InitOptions, new ChartInitOptions { Renderer = "svg" })
            .Add(x => x.Options, new ChartOptions { Animation = true }));

        // Assert
        Assert.DoesNotContain("recreateChart", _browser.Calls);

        // Act
        _browser.Application.SetResult();
        await component.InvokeAsync(() => component.Instance.InitializeAsync().AsTask());
        await component.Instance.Instance!.SetOptionAsync(new ChartOptions());

        // Assert
        Assert.Equal(3, _browser.Options.Count);
        Assert.Equal(
            new[] { "setOption", "recreateChart", "setOption", "setOption" },
            _browser.Calls.Where(c => c is "setOption" or "recreateChart"));
        Assert.True(_browser.Options[1].GetProperty("animation").GetBoolean());
        Assert.Equal(2, component.Instance.Instance!.AcceptedRevision.Generation);
    }

    [Fact]
    public void RawReference_UsesIdentity_WithoutDeepComparison()
    {
        // Arrange
        using var first = JsonDocument.Parse("{\"a\":1}");
        using var second = JsonDocument.Parse("{\"a\":1}");
        var component = Render<EChart>(p => p.Add(x => x.RawOptions, first.RootElement));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));

        // Act
        component.Render(p => p.Add(x => x.RawOptions, first.RootElement));

        // Assert
        Assert.Single(_browser.Options);

        // Act
        component.Render(p => p.Add(x => x.RawOptions, second.RootElement));

        // Assert
        component.WaitForAssertion(() => Assert.Equal(2, _browser.Options.Count));
    }

    [Fact]
    public async Task Mutation_RequiresExplicitUpdateAsync()
    {
        // Arrange
        var options = new ChartOptions { Animation = false };
        var component = Render<EChart>(p => p.Add(x => x.Options, options));
        component.WaitForAssertion(() => Assert.Equal(ChartState.Ready, component.Instance.State));
        options.Animation = true;

        // Act
        component.Render();

        // Assert
        Assert.Single(_browser.Options);

        // Act
        await component.InvokeAsync(() => component.Instance.UpdateAsync().AsTask());

        // Assert
        Assert.Equal(2, _browser.Options.Count);
        Assert.True(_browser.Options[1].GetProperty("animation").GetBoolean());
    }

    private sealed class BrowserInterop : IJSRuntime, IJSObjectReference
    {
        public List<JsonElement> Options { get; } = [];
        public List<JsonElement> Updates { get; } = [];
        public List<string> Calls { get; } = [];

        public TaskCompletionSource? Application;
        public bool FailRecreate;
        public TaskCompletionSource<string>? Allocation;
        public TaskCompletionSource? Recreation;
        public TaskCompletionSource? Disposal;

        public TaskCompletionSource DisposalEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        private int _nextId;

        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);

        public async ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken token, object?[]? args)
        {
            Calls.Add(identifier);
            if (identifier == "recreateChart" && Recreation is not null)
            {
                await Recreation.Task.ConfigureAwait(false);
            }

            if (identifier == "disposeChart" && Disposal is not null)
            {
                DisposalEntered.TrySetResult();
                await Disposal.Task;
            }

            if (identifier == "recreateChart" && FailRecreate)
                throw new JSException("native recreation failed");

            if (identifier == "setOption")
            {
                Options.Add(JsonDocument.Parse((byte[])args![2]!).RootElement.Clone());
                Updates.Add((JsonElement)args[4]!);
                if (Application is not null)
                    await Application.Task;
            }

            object? result = identifier switch
            {
                "import" => this,
                "openFacade" => "page:1",
                "observeChart" => true,
                "createChart" => Allocation is not null ? await Allocation.Task : $"chart:{++_nextId}",
                _ => default(T),
            };
            return (T)result!;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
