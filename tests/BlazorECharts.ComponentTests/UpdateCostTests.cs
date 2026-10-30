using System.Text.Json;
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

// Exact-zero cost gates. Serialization is counted by the production serializer, browser work by the JS boundary.
public sealed class UpdateCostTests : BunitContext
{
    private readonly RecordingBrowser _browser = new();

    public UpdateCostTests()
    {
        Services.AddSingleton<IJSRuntime>(_browser);
        Services.AddECharts();
        SetRendererInfo(new RendererInfo("Server", true));
    }

    private EChartsRuntime Runtime => Services.GetRequiredService<EChartsRuntime>();

    [Fact]
    public async Task SameReferenceRerenderDoesNotSerializeOrUpdate()
    {
        // Arrange
        var parent = Render<ChartParent>(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        parent.WaitForAssertion(() => Assert.Equal(ChartState.Ready, parent.FindComponent<EChart>().Instance.State));
        var statistics = Runtime.Serialization.Statistics;
        var serialized = statistics.Count<ChartOptions>();
        var calls = _browser.Calls.Count;

        // Act
        for (var i = 0; i < 25; i++)
            await parent.InvokeAsync(parent.Instance.Rerender);

        // Assert
        Assert.Equal(26, parent.Instance.Renders);
        Assert.Equal(0, statistics.Count<ChartOptions>() - serialized);
        Assert.Equal(0, _browser.Calls.Count - calls);
        Assert.Equal(1, _browser.Calls.Count(c => c == "setOption"));
    }

    [Fact]
    public async Task SameRawReferenceRerenderDoesNotCopyOrUpdate()
    {
        // Arrange
        using var raw = JsonDocument.Parse("{\"animation\":false}");
        var parent = Render<ChartParent>(p => p.Add(x => x.RawOptions, raw.RootElement));
        parent.WaitForAssertion(() => Assert.Equal(ChartState.Ready, parent.FindComponent<EChart>().Instance.State));
        var statistics = Runtime.Serialization.Statistics;
        var copied = statistics.Count<JsonElement>();
        var calls = _browser.Calls.Count;

        // Act
        for (var i = 0; i < 25; i++)
            await parent.InvokeAsync(parent.Instance.Rerender);

        // Assert
        Assert.Equal(0, statistics.Count<JsonElement>() - copied);
        Assert.Equal(0, _browser.Calls.Count - calls);
    }

    [Fact]
    public void NewReferenceSerializesOnceAndUpdatesOnce()
    {
        // Arrange
        var parent = Render<ChartParent>(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        var chart = parent.FindComponent<EChart>();
        parent.WaitForAssertion(() => Assert.Equal(ChartState.Ready, chart.Instance.State));
        var statistics = Runtime.Serialization.Statistics;
        var serialized = statistics.Count<ChartOptions>();
        var bytes = statistics.Bytes<ChartOptions>();

        // Act
        parent.Render(p => p.Add(x => x.Options, new ChartOptions { Animation = true }));

        // Assert
        parent.WaitForAssertion(() => Assert.Equal(2, _browser.Calls.Count(c => c == "setOption")));
        Assert.Equal(1, statistics.Count<ChartOptions>() - serialized);
        Assert.Equal("{\"animation\":true}".Length, statistics.Bytes<ChartOptions>() - bytes);
    }

    [Fact]
    public async Task ResizeAndSubscriptionChangesDoNotReserializeOptions()
    {
        // Arrange
        var parent = Render<ChartParent>(p => p.Add(x => x.Options, new ChartOptions { Animation = false }));
        var chart = parent.FindComponent<EChart>();
        parent.WaitForAssertion(() => Assert.Equal(ChartState.Ready, chart.Instance.State));
        var statistics = Runtime.Serialization.Statistics;
        var serialized = statistics.Count<ChartOptions>();

        // Act
        var subscription = await parent.InvokeAsync(
            () => chart.Instance.Instance!.SubscribeAsync(ChartEvents.Finished, _ => Task.CompletedTask).AsTask());
        await parent.InvokeAsync(() => subscription.DisposeAsync().AsTask());
        parent.Render(p => p.Add(x => x.Style, "width:300px;height:200px"));

        // Assert
        Assert.Equal(0, statistics.Count<ChartOptions>() - serialized);
        Assert.Equal(1, _browser.Calls.Count(c => c == "setOption"));
    }

    private sealed class ChartParent : ComponentBase
    {
        [Parameter] public ChartOptions? Options { get; set; }
        [Parameter] public JsonElement? RawOptions { get; set; }
        [Parameter] public string Style { get; set; } = "width:600px;height:300px";
        public int Renders { get; private set; }

        public void Rerender() => StateHasChanged();

        protected override void BuildRenderTree(RenderTreeBuilder builder)
        {
            Renders++;
            builder.OpenComponent<EChart>(0);
            if (Options is not null)
                builder.AddComponentParameter(1, nameof(EChart.Options), Options);

            if (RawOptions is not null)
                builder.AddComponentParameter(2, nameof(EChart.RawOptions), RawOptions);

            builder.AddComponentParameter(3, nameof(EChart.Style), Style);
            builder.CloseComponent();
        }
    }

    private sealed class RecordingBrowser : IJSRuntime, IJSObjectReference
    {
        private int _next;

        public List<string> Calls { get; } = [];

        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);

        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            lock (Calls)
                Calls.Add(identifier);

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
