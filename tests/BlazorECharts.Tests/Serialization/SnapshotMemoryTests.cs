using System.Globalization;
using System.Text;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

[Collection(nameof(ReadCostTests))]
public sealed class SnapshotMemoryTests
{
    // One copy of the JSON plus one inline-JSON value per item and its array slot: about 9.6x the JSON. A clone per value was 26x,
    // a boxed element beside each value 12x.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SnapshotRead_Line100k_SharesOneDocument(bool disposableSource)
    {
        // Arrange
        var utf8 = Envelope(100_000);
        await using var runtime = new EChartsRuntime(new NoJs(), new Navigation(), new());
        var transport = (IChartMethodTransport)runtime;
        await transport.ReadSnapshotAsync(Received(utf8), runtime.Serialization);
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();

        // Act
        var before = GC.GetTotalMemory(true);
        EChartsOptionSnapshot snapshot;
        if (disposableSource)
        {
            using var document = JsonDocument.Parse(utf8);
            snapshot = await transport.ReadSnapshotAsync(document.RootElement, runtime.Serialization);
        }
        else
            snapshot = await transport.ReadSnapshotAsync(Received(utf8), runtime.Serialization);

        // Assert
        var retained = GC.GetTotalMemory(true) - before;
        var data = Assert.IsType<LineSeriesOption>(snapshot.Options.Series!.Value.Items[0]).Data!;
        Assert.True(data[99_999]!.Value.TryGet(out double last));
        Assert.Equal(100 + 99_999 * 0.01, last, 6);
        Assert.True(
            retained < 11 * utf8.Length,
            $"A snapshot of {utf8.Length} B of JSON retains {retained / 1024} KiB ({(double)retained / utf8.Length:F1}x).");
    }

    // JS interop reads a JsonElement result with JsonElement.ParseValue: one document that is never disposed.
    private static JsonElement Received(byte[] utf8)
    {
        var reader = new Utf8JsonReader(utf8);
        return JsonElement.ParseValue(ref reader);
    }

    // The getOption envelope of a line with 100k numbers, as the browser sends it.
    private static byte[] Envelope(int points)
    {
        var json = new StringBuilder("""{"value":{"series":[{"type":"line","data":[""");
        for (var i = 0; i < points; i++)
            json.Append(i == 0 ? "" : ",").Append((100 + i * 0.01).ToString("R", CultureInfo.InvariantCulture));

        json.Append("""]}],"xAxis":[{"type":"category"}],"yAxis":[{"type":"value"}]},"bindings":[],"leaseId":null}""");
        return Encoding.UTF8.GetBytes(json.ToString());
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class NoJs : IJSRuntime
    {
        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => throw new NotSupportedException();

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args) =>
            throw new NotSupportedException();
    }
}
