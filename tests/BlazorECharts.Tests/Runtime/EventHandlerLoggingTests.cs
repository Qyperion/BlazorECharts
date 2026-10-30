using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

/// <summary>A .NET event handler that throws is logged, without flooding the log, and still rejects its browser
/// delivery.</summary>
public sealed class EventHandlerLoggingTests
{
    [Fact]
    public async Task FailingHandler_IsLoggedAtError_AndStillRejectsTheDelivery()
    {
        // Arrange
        var log = new ListLogger();
        await using var chart = new EChartInstance("chart", new Transport(), GeneratedOptionMetadata.CreateContext()) { Logger = log };
        await using var subscription = await chart.SubscribeAsync(
            ChartEvents.Click,
            _ => Task.FromException(new InvalidOperationException("handler failed")));

        // Act
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Deliver(subscription));

        // Assert
        var entry = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Error, entry.Level);
        Assert.Same(error, entry.Exception);
        Assert.Contains("click", entry.Message, StringComparison.Ordinal);
        Assert.Contains(subscription.Id, entry.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RepeatedHandlerFailures_AreRateLimited()
    {
        // Arrange
        var log = new ListLogger();
        await using var chart = new EChartInstance("chart", new Transport(), GeneratedOptionMetadata.CreateContext()) { Logger = log };
        await using var click = await chart.SubscribeAsync(ChartEvents.Click, _ => throw new InvalidOperationException("click failed"));
        await using var move = await chart.SubscribeAsync(ChartEvents.MouseMove, _ => throw new InvalidOperationException("move failed"));

        // Act
        for (var i = 0; i < 100; i++)
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => Deliver(click));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Deliver(move));
        }

        // Assert
        Assert.Equal(2, log.Entries.Count);
        Assert.All(log.Entries, entry => Assert.Equal(LogLevel.Error, entry.Level));
    }

    [Fact]
    public async Task RuntimeFromDependencyInjection_LogsHandlerFailures()
    {
        // Arrange
        var log = new ListLogger();
        var services = new ServiceCollection();
        services.AddSingleton<ILoggerFactory>(new Factory(log));
        services.AddSingleton<IJSRuntime>(new CircuitJSRuntime());
        services.AddSingleton<NavigationManager>(new Navigation());
        services.AddECharts();
        await using var provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();
        var runtime = scope.ServiceProvider.GetRequiredService<EChartsRuntime>();
        await using var chart = await runtime.CreateInstanceAsync(default);
        await using var subscription = await chart.SubscribeAsync(ChartEvents.Click, _ => throw new InvalidOperationException("handler failed"));

        // Act
        await Assert.ThrowsAsync<InvalidOperationException>(() => Deliver(subscription));

        // Assert
        var entry = Assert.Single(log.Entries);
        Assert.Equal(typeof(EChartInstance).FullName, entry.Category);
    }

    private static Task Deliver(ChartSubscription subscription)
    {
        using var empty = JsonDocument.Parse("{}");
        using var references = JsonDocument.Parse("[]");
        return subscription.Reference.Value.Deliver(subscription.Id, 0, empty.RootElement.Clone(), references.RootElement.Clone());
    }

    internal sealed record Entry(string Category, LogLevel Level, string Message, Exception? Exception);

    internal sealed class ListLogger(string category = "test") : ILogger
    {
        public List<Entry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (Entries)
                Entries.Add(new(category, logLevel, formatter(state, exception), exception));
        }
    }

    private sealed class Factory(ListLogger sink) : ILoggerFactory
    {
        public ILogger CreateLogger(string categoryName) => new Forward(sink, categoryName);

        public void AddProvider(ILoggerProvider provider) => throw new NotSupportedException();

        public void Dispose() { }

        private sealed class Forward(ListLogger sink, string category) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (sink.Entries)
                    sink.Entries.Add(new(category, logLevel, formatter(state, exception), exception));
            }
        }
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class Transport : IChartCommandTransport, IChartEventTransport
    {
        public ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken token) => ValueTask.CompletedTask;

        public ValueTask DisposeAsync(string id) => ValueTask.CompletedTask;

        public ValueTask DispatchActionAsync(string id, JsonElement payload, JsonElement settings, ChartRevision revision) => ValueTask.CompletedTask;

        public ValueTask SubscribeAsync(string id, ChartSubscription subscription, string name, JsonElement query) => ValueTask.CompletedTask;

        public ValueTask UnsubscribeAsync(string id, string subscription) => ValueTask.CompletedTask;
    }
}
