using System.Text;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

/// <summary>Options travel as byte[] arguments, which JSRuntime numbers with an unsynchronized counter and sends
/// separately.</summary>
public sealed class ByteArrayTransportTests
{
    [Fact]
    public async Task ConcurrentSetOptionOnOneCircuit_InitiatesOneByteArrayCallAtATime()
    {
        // Arrange
        var browser = new CircuitJSRuntime();

        // Two facades of one circuit share its JSRuntime counter.
        await using var first = new EChartsRuntime(browser, new Navigation(), new());
        await using var second = new EChartsRuntime(browser, new Navigation(), new());
        var charts = new List<EChartInstance>();
        for (var i = 0; i < 8; i++)
            charts.Add(await (i % 2 == 0 ? first : second).CreateInstanceAsync(default));

        using var start = new ManualResetEventSlim();
        var updates = charts.Select(chart => Task.Run(async () =>
        {
            start.Wait();
            for (var i = 0; i < 100; i++)
                await chart.SetOptionAsync(new ChartOptions { Title = new TitleOption { Text = $"{chart.Id}/{i}" } });
        })).ToArray();

        // Act
        start.Set();
        await Task.WhenAll(updates).WaitAsync(TimeSpan.FromSeconds(30));

        // Assert
        Assert.Equal(0, browser.OverlappingByteArrayCalls);
        var sent = browser.Calls.Where(c => c.Identifier == "setOption").Select(c => JsonDocument.Parse(c.Args).RootElement).ToArray();
        Assert.Equal(800, sent.Length);
        var ids = sent.Select(args => args[2].GetProperty("__byte[]").GetInt32()).ToArray();
        Assert.Equal(ids.Length, ids.Distinct().Count());
        foreach (var args in sent)
        {
            var option = JsonDocument.Parse(Encoding.UTF8.GetString(browser.ByteArrays[args[2].GetProperty("__byte[]").GetInt32()])).RootElement;
            Assert.StartsWith(args[1].GetString() + "/", option.GetProperty("title").GetProperty("text").GetString(), StringComparison.Ordinal);
        }

        foreach (var chart in charts)
            await chart.DisposeAsync();
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }
}
