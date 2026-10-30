using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

/// <summary>Interactive Server: a result over the SignalR limit or a lost reply must not hold the chart queue.</summary>
public sealed class ServerLimitTests
{
    [Fact]
    public void ServerResultLimit_DefaultsToTheSignalRDefault()
    {
        // Act
        var options = new EChartsRuntimeOptions();

        // Assert
        Assert.Equal(32 * 1024, options.MaximumServerResultSize);

        // Act
        options.MaximumServerResultSize = null;

        // Assert
        Assert.Null(options.MaximumServerResultSize);
        Assert.Throws<ArgumentOutOfRangeException>(() => options.MaximumServerResultSize = 0);
    }

    [Fact]
    public async Task OpenFacade_SendsTheServerResultLimit_AndFreezesIt()
    {
        // Arrange
        var bridge = new Bridge();
        var options = new EChartsRuntimeOptions { MaximumServerResultSize = 4 * 1024 * 1024 };
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), options) { Server = true };

        // Act
        await runtime.InitializeAsync();

        // Assert
        var args = bridge.Calls.Single(c => c.Identifier == "openFacade").Args;
        Assert.Equal(true, args[5]);
        Assert.Equal(4L * 1024 * 1024, args[6]);
        Assert.Throws<InvalidOperationException>(() => options.MaximumServerResultSize = 1024);
    }

    [Fact]
    public async Task OutsideACircuit_TheFacadeIsNotServer()
    {
        // Blazor Hybrid and other in-process hosts have no SignalR message limit.

        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());

        // Act
        await runtime.InitializeAsync();

        // Assert
        var args = bridge.Calls.Single(c => c.Identifier == "openFacade").Args;
        Assert.Equal(false, args[5]);
        Assert.Null(args[6]);
    }

    [Fact]
    public async Task LostSetOptionReply_TimesOutWithResultTimeout_AndReleasesTheQueue()
    {
        // Arrange
        var lost = 0;
        var browser = new CircuitJSRuntime(TimeSpan.FromMilliseconds(200))
        {
            Lose = id => id == "setOption" && Interlocked.Exchange(ref lost, 1) == 0,
        };
        await using var runtime = new EChartsRuntime(browser, new Navigation(), new());
        await using var chart = await runtime.CreateInstanceAsync(default);

        // Act
        var first = chart.SetOptionAsync(new ChartOptions()).AsTask();
        var width = chart.GetWidthAsync().AsTask();
        var second = chart.SetOptionAsync(new ChartOptions()).AsTask();
        await Settles(first);

        // Assert
        var error = await Assert.ThrowsAsync<TimeoutException>(() => first);
        Assert.StartsWith("[ResultTimeout] setOption", error.Message, StringComparison.Ordinal);
        Assert.IsAssignableFrom<OperationCanceledException>(error.InnerException);
        await Settles(width);
        Assert.Equal(640, await width);
        await Settles(second);
        await second;
    }

    [Fact]
    public async Task LostThemeAndRecreateReplies_TimeOutWithResultTimeout()
    {
        // Arrange
        var browser = new CircuitJSRuntime(TimeSpan.FromMilliseconds(200)) { Lose = id => id is "setTheme" or "recreateChart" };
        await using var runtime = new EChartsRuntime(browser, new Navigation(), new());
        await using var chart = await runtime.CreateInstanceAsync(default);
        using var init = JsonDocument.Parse("{}");

        // Act
        var theme = chart.ConfigureAsync(init.RootElement, "dark", recreate: false).AsTask();
        await Settles(theme);

        // Assert
        Assert.StartsWith("[ResultTimeout] setTheme", (await Assert.ThrowsAsync<TimeoutException>(() => theme)).Message, StringComparison.Ordinal);

        // Act
        var recreate = chart.ConfigureAsync(init.RootElement, null, recreate: true).AsTask();
        await Settles(recreate);

        // Assert
        Assert.StartsWith(
            "[ResultTimeout] recreateChart",
            (await Assert.ThrowsAsync<TimeoutException>(() => recreate)).Message,
            StringComparison.Ordinal);

        // Arrange
        browser.Lose = _ => false;

        // Act
        var width = chart.GetWidthAsync().AsTask();
        await Settles(width);

        // Assert
        Assert.Equal(640, await width);
    }

    [Fact]
    public async Task LostMethodReply_EndsWithTheApplicationInteropTimeout_AndReleasesTheQueue()
    {
        // The application's CircuitOptions.JSInteropDefaultCallTimeout bounds the wait, not a fixed library timeout.

        // Arrange
        var browser = new CircuitJSRuntime(TimeSpan.FromMilliseconds(200)) { Lose = id => id == "invokeMethod" };
        await using var runtime = new EChartsRuntime(browser, new Navigation(), new());
        await using var chart = await runtime.CreateInstanceAsync(default);

        // Act
        var lost = chart.GetWidthAsync().AsTask();
        await Settles(lost);

        // Assert
        var error = await Assert.ThrowsAsync<TimeoutException>(() => lost);
        Assert.StartsWith("[ResultTimeout] getWidth", error.Message, StringComparison.Ordinal);
        Assert.Contains("JSInteropDefaultCallTimeout", error.Message, StringComparison.Ordinal);
        Assert.Contains("MaximumReceiveMessageSize", error.Message, StringComparison.Ordinal);

        // Arrange
        browser.Lose = _ => false;

        // Act
        var width = chart.GetWidthAsync().AsTask();
        await Settles(width);

        // Assert
        Assert.Equal(640, await width);
    }

    [Fact]
    public async Task LostGlobalReply_TimesOutAndReleasesTheRuntime()
    {
        // Arrange
        var browser = new CircuitJSRuntime(TimeSpan.FromMilliseconds(200)) { Lose = id => id == "invokeGlobalMethod" };
        await using var runtime = new EChartsRuntime(browser, new Navigation(), new());

        // Act
        var map = runtime.GetMapAsync("world").AsTask();
        await Settles(map);

        // Assert
        Assert.StartsWith("[ResultTimeout]", (await Assert.ThrowsAsync<TimeoutException>(() => map)).Message, StringComparison.Ordinal);

        // Arrange
        browser.Lose = _ => false;

        // Act
        var created = runtime.CreateInstanceAsync(default).AsTask();
        await Settles(created);
        await using var chart = await created;

        // Assert
        Assert.False(chart.IsDisposed);
    }

    // Fails instead of hanging the test run when a lost reply is never bounded.
    private static async Task Settles(Task task) =>
        Assert.True(ReferenceEquals(task, await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5)))), "The call did not settle within 5 s.");

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class Bridge : IJSRuntime, IJSObjectReference
    {
        internal readonly List<(string Identifier, object?[] Args)> Calls = [];

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            lock (Calls)
                Calls.Add((identifier, args ?? []));

            object? result = identifier switch { "import" => this, "openFacade" => "page", _ => null };
            return ValueTask.FromResult<TValue>(result is null ? default! : (TValue)result);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
