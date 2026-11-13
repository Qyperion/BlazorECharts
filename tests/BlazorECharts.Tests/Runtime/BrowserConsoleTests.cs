using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

/// <summary>Interactive Server: a failure without OnError is logged on the server, so the browser console names it too.</summary>
public sealed class BrowserConsoleTests
{
    [Fact]
    public async Task BrowserFailure_OnServer_IsWrittenWithItsMessage()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new()) { Server = true };
        var error = new EChartsError("ChartInitializationFailed", "Cannot import js/callbacks.js: SyntaxError", new JSException("SyntaxError"))
        {
            Operation = "initialize",
            ChartId = "chart:1",
        };

        // Act
        await runtime.WriteBrowserConsoleAsync(error, LogLevel.Error);

        // Assert
        var (identifier, args) = Assert.Single(bridge.Calls);
        Assert.Equal("console.error", identifier);
        Assert.Equal(
            "[BlazorECharts] ChartInitializationFailed during initialize (chart chart:1): Cannot import js/callbacks.js: SyntaxError "
            + "Handle EChart.OnError to report it in the application.",
            Assert.Single(args));
    }

    [Fact]
    public async Task ServerFailure_OnServer_IsWrittenWithoutItsMessage()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new()) { Server = true };
        var error = new EChartsError("ChartUpdateFailed", "Connection string of the report database", new InvalidOperationException())
        {
            Operation = "setOption",
        };

        // Act
        await runtime.WriteBrowserConsoleAsync(error, LogLevel.Warning);

        // Assert
        var (identifier, args) = Assert.Single(bridge.Calls);
        Assert.Equal("console.warn", identifier);
        Assert.Equal(
            "[BlazorECharts] ChartUpdateFailed during setOption: the server log has the details. "
            + "Handle EChart.OnError to report it in the application.",
            Assert.Single(args));
    }

    [Fact]
    public async Task Failure_OutsideServer_IsNotWritten_AndABrokenConsoleIsIgnored()
    {
        // Arrange
        var bridge = new Bridge();
        await using var inProcess = new EChartsRuntime(bridge, new Navigation(), new());
        await using var disconnected = new EChartsRuntime(new Bridge { Disconnected = true }, new Navigation(), new()) { Server = true };
        var error = new EChartsError("ChartInitializationFailed", "failed") { Operation = "initialize" };

        // Act
        await inProcess.WriteBrowserConsoleAsync(error, LogLevel.Error);
        await disconnected.WriteBrowserConsoleAsync(error, LogLevel.Error);

        // Assert
        Assert.Empty(bridge.Calls);
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class Bridge : IJSRuntime
    {
        internal readonly List<(string Identifier, object?[] Args)> Calls = [];

        internal bool Disconnected;

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (Disconnected)
                throw new JSDisconnectedException("The circuit is disconnected.");

            Calls.Add((identifier, args ?? []));
            return ValueTask.FromResult<TValue>(default!);
        }
    }
}
