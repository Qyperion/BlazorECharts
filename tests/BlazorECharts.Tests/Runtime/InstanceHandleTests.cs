using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class InstanceHandleTests
{
    [Fact]
    public async Task TypedAndRawOptions_UseOneTransportAndPreserveValues()
    {
        // Arrange
        var transport = new RecordingTransport();
        await using var instance = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());

        // Act
        await instance.SetOptionAsync(new ChartOptions { Animation = false }, new SetOptionOptions { Silent = true });
        using var raw = JsonDocument.Parse("{\"series\":[],\"zero\":0}");
        await instance.SetOptionAsync(raw.RootElement);

        // Assert
        Assert.Equal(2, transport.Calls.Count);
        Assert.Equal("chart", transport.Calls[0].Id);
        Assert.False(transport.Calls[0].Option.Json.GetProperty("animation").GetBoolean());
        Assert.True(transport.Calls[0].Update.GetProperty("silent").GetBoolean());
        Assert.Equal(0, transport.Calls[1].Option.Json.GetProperty("zero").GetInt32());
        Assert.Equal(JsonValueKind.Array, transport.Calls[1].Option.Json.GetProperty("series").ValueKind);
    }

    [Fact]
    public async Task Instance_ForwardsExplicitBindingsAndRejectsDisposedHandle()
    {
        // Arrange
        var transport = new RecordingTransport();
        var instance = new EChartInstance("chart", transport, GeneratedOptionMetadata.CreateContext());
        var options = new ChartOptions();
        options.AdditionalProperties["formatter"] = EChartsValue.From(JsFunction.Module<FixtureFormatter>("format.js", "format"));

        // Act
        await instance.SetOptionAsync(options);

        // Assert
        Assert.Equal("format", Assert.Single(Assert.Single(transport.Calls).Option.Bindings).ExportName);

        // Act
        await instance.DisposeAsync();
        await instance.DisposeAsync();

        // Assert
        await Assert.ThrowsAsync<ObjectDisposedException>(() => instance.SetOptionAsync(new ChartOptions()).AsTask());
        Assert.Equal(1, transport.Disposals);
    }

    [Fact]
    public async Task Snapshot_OwnsIndependentLeases()
    {
        // Arrange
        var resource = new FixtureReferenceOwner();
        var registry = new ReferenceRegistry("page", "owner");
        var reference = registry.Register(resource, ReferenceOwnership.Owned);
        var chartLease = await reference.AcquireLeaseAsync("page");
        var snapshot = new EChartsOptionSnapshot(new ChartOptions(), [await chartLease.RetainAsync()]);

        // Act
        await reference.DisposeAsync();
        await snapshot.DisposeAsync();
        await snapshot.DisposeAsync();

        // Assert
        Assert.Equal(0, resource.Disposals);

        // Act
        await using (await chartLease.RetainAsync()) { }

        await chartLease.DisposeAsync();

        // Assert
        Assert.Equal(1, resource.Disposals);
        Assert.Throws<ObjectDisposedException>(() => snapshot.Options);
    }

    private sealed class RecordingTransport : IChartCommandTransport
    {
        public List<(string Id, PreparedOption Option, JsonElement Update)> Calls { get; } = [];
        public int Disposals { get; private set; }

        public ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken cancellationToken)
        {
            Calls.Add((id, option, update));
            return ValueTask.CompletedTask;
        }

        public ValueTask DisposeAsync(string id)
        {
            Disposals++;
            return ValueTask.CompletedTask;
        }
    }
}
