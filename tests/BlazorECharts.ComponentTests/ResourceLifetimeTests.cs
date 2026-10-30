using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Bunit;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.ComponentTests;

public sealed class ResourceLifetimeTests : BunitContext
{
    private readonly ReferenceTrackingBrowser _browser = new();

    public ResourceLifetimeTests()
    {
        Services.AddSingleton<IJSRuntime>(_browser);
        Services.AddECharts();
        SetRendererInfo(new RendererInfo("Server", true));
    }

    [Fact]
    public async Task RepeatedMountLeavesNoOwnedManagedResources()
    {
        // Arrange
        var runtime = Services.GetRequiredService<EChartsRuntime>();
        var host = Render<ChartHost>();

        // Act
        for (var cycle = 0; cycle < 100; cycle++)
        {
            await host.InvokeAsync(() => host.Instance.Mount(new ChartOptions { Animation = false }));
            var chart = host.FindComponent<EChart>();
            host.WaitForAssertion(() => Assert.Equal(ChartState.Ready, chart.Instance.State));
            await host.InvokeAsync(() => host.Instance.Replace(new ChartOptions { Animation = true }));
            var subscription = await host.InvokeAsync(
                () => chart.Instance.Instance!.SubscribeAsync(ChartEvents.Finished, _ => Task.CompletedTask).AsTask());
            if (cycle % 2 == 0)
                await host.InvokeAsync(() => subscription.DisposeAsync().AsTask());

            await host.InvokeAsync(host.Instance.Unmount);
            host.WaitForAssertion(() => Assert.Equal(0, runtime.OwnedChartCount));
        }

        // Assert
        Assert.Equal(100, _browser.Count("createChart"));
        Assert.Equal(100, _browser.Count("disposeChart"));
        Assert.Equal(_browser.Count("observeChart"), _browser.Count("releaseObservation"));
        Assert.Equal(_browser.Count("subscribe"), _browser.Count("unsubscribe"));
        Assert.Equal(300, _browser.References.Count);
        Assert.All(_browser.References, reference => Assert.True(IsReleased(reference), reference.GetType().Name));
    }

    private static bool IsReleased(object reference)
    {
        try
        {
            _ = reference switch
            {
                DotNetObjectReference<ChartLifecycle> lifecycle => lifecycle.Value as object,
                DotNetObjectReference<EChartInstance.ExportReadiness> readiness => readiness.Value,
                DotNetObjectReference<ChartSubscription.Delivery> subscription => subscription.Value,
                _ => throw new InvalidOperationException($"Unexpected reference {reference.GetType()}."),
            };
            return false;
        }
        catch (ObjectDisposedException)
        {
            return true;
        }
    }

    private sealed class ChartHost : ComponentBase
    {
        private ChartOptions? _options;

        public void Mount(ChartOptions options)
        {
            _options = options;
            StateHasChanged();
        }

        public void Replace(ChartOptions options)
        {
            _options = options;
            StateHasChanged();
        }

        public void Unmount()
        {
            _options = null;
            StateHasChanged();
        }

        protected override void BuildRenderTree(RenderTreeBuilder builder)
        {
            if (_options is null)
                return;

            builder.OpenComponent<EChart>(0);
            builder.AddComponentParameter(1, nameof(EChart.Options), _options);
            builder.CloseComponent();
        }
    }

    private sealed class ReferenceTrackingBrowser : IJSRuntime, IJSObjectReference
    {
        private readonly List<string> _calls = [];
        private int _next;

        public List<object> References { get; } = [];

        public int Count(string identifier)
        {
            lock (_calls)
                return _calls.Count(c => c == identifier);
        }

        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);

        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            lock (_calls)
            {
                _calls.Add(identifier);
                foreach (var arg in args ?? [])
                    if (arg?.GetType() is { IsGenericType: true } type && type.GetGenericTypeDefinition() == typeof(DotNetObjectReference<>))
                        References.Add(arg);
            }

            object? result = identifier switch
            {
                "import" => this,
                "openFacade" => "page:1",
                "observeChart" => true,
                "createChart" => $"chart:{Interlocked.Increment(ref _next)}",
                _ => default(T),
            };
            return ValueTask.FromResult((T)result!);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
