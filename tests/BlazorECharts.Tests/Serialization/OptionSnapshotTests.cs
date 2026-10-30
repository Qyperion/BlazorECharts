using System.Text.Json;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

public sealed class OptionSnapshotTests
{
    [Fact]
    public async Task CancelledSnapshotApply_RetainsReferencesUntilActualTransportCompletion()
    {
        // Arrange
        var bridge = new SnapshotBridge { ApplyGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var runtime = new EChartsRuntime(bridge, new SnapshotNavigation(), new());
        var chart = await runtime.CreateInstanceAsync(default);
        var snapshot = await chart.GetOptionAsync();
        using var cancel = new CancellationTokenSource();

        // Act
        var applying = chart.SetOptionAsync(snapshot, cancellationToken: cancel.Token).AsTask();
        cancel.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => applying);

        // Act
        await snapshot.DisposeAsync();

        // Assert
        Assert.Equal(0, bridge.Releases);

        // Act
        bridge.ApplyGate.SetResult();
        await chart.GetWidthAsync();

        // Assert
        Assert.Equal(1, bridge.Releases);
    }

    [Fact]
    public async Task SnapshotDisposal_PreservesChartLease()
    {
        // Arrange
        var bridge = new SnapshotBridge();
        await using var runtime = new EChartsRuntime(bridge, new SnapshotNavigation(), new EChartsRuntimeOptions());
        var chart = await runtime.CreateInstanceAsync(default);

        // Act
        var snapshot = await chart.GetOptionAsync();

        // Assert
        Assert.Single(snapshot.References);
        Assert.Equal(2, snapshot.Bindings.Count);

        // Arrange
        var reference = snapshot.References[0];
        var chartLease = await reference.AcquireLeaseAsync("page");

        // Act
        await snapshot.DisposeAsync();
        await snapshot.DisposeAsync();

        // Assert
        Assert.True(reference.IsDisposed);
        Assert.Equal(0, bridge.Releases);
        Assert.Equal(640, await chart.GetWidthAsync());

        // Act
        await runtime.DisposeAsync();

        // Assert
        Assert.Equal(0, bridge.ModuleDisposals);

        // Act
        await chartLease.DisposeAsync();

        // Assert
        Assert.Equal(1, bridge.Releases);
        Assert.Equal(1, bridge.ModuleDisposals);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => reference.AcquireLeaseAsync("page").AsTask());
    }

    [Fact]
    public async Task CancelledSnapshot_ReleasesLateResultAndPreservesOrdering()
    {
        // Arrange
        var bridge = new SnapshotBridge { Gate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        await using var runtime = new EChartsRuntime(bridge, new SnapshotNavigation(), new EChartsRuntimeOptions());
        await using var chart = await runtime.CreateInstanceAsync(default);
        using var cancel = new CancellationTokenSource();

        // Act
        var snapshot = chart.GetOptionAsync(cancel.Token).AsTask();
        cancel.Cancel();

        // Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => snapshot);

        // Act
        var width = chart.GetWidthAsync().AsTask();

        // Assert
        Assert.False(width.IsCompleted);
        Assert.Equal(0, bridge.WidthCalls);

        // Act
        bridge.Gate.SetResult();

        // Assert
        Assert.Equal(640, await width);
        Assert.Equal(1, bridge.Releases);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task InvalidSnapshot_ReleasesIncomingReferences(bool invalidData, bool foreignRuntime)
    {
        // Arrange
        var bridge = new SnapshotBridge { InvalidData = invalidData, ForeignRuntime = foreignRuntime };
        await using var runtime = new EChartsRuntime(bridge, new SnapshotNavigation(), new EChartsRuntimeOptions());
        await using var chart = await runtime.CreateInstanceAsync(default);

        // Act & Assert
        await Assert.ThrowsAnyAsync<Exception>(() => chart.GetOptionAsync().AsTask());
        Assert.Equal(1, bridge.Releases);
        Assert.Equal(640, await chart.GetWidthAsync());
    }

    [Fact]
    public void NativeDefaults_AfterClear_PreserveAnimationAuto()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"animation":"auto","series":[]}""");

        // Act
        var options = GeneratedOptionMetadata.ReadChartOptions(json.RootElement);

        // Assert
        Assert.Equal("auto", OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext()).Json.GetProperty("animation").GetString());
    }

    [Fact]
    public void GetOption_PreservesNormalizedArraysAndUnknownData()
    {
        // Arrange
        using var json = JsonDocument.Parse("""{"title":[{"text":"A","unknown":{"zero":0,"flag":false,"empty":[]}}],"timeline":[],"series":[],"extension":{"data":[null,0,false,[]]}}""");

        // Act
        var options = GeneratedOptionMetadata.ReadChartOptions(json.RootElement);
        var prepared = OptionSerializer.Serialize(options, GeneratedOptionMetadata.CreateContext());

        // Assert
        Assert.Equal(JsonValueKind.Array, prepared.Json.GetProperty("title").ValueKind);
        Assert.Equal(JsonValueKind.Array, prepared.Json.GetProperty("timeline").ValueKind);
        Assert.Equal(0, prepared.Json.GetProperty("title")[0].GetProperty("unknown").GetProperty("zero").GetInt32());
        Assert.Equal(json.RootElement.GetProperty("extension").GetRawText(), prepared.Json.GetProperty("extension").GetRawText());
    }

    private sealed class SnapshotNavigation : NavigationManager
    {
        public SnapshotNavigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class SnapshotBridge : IJSRuntime, IJSObjectReference
    {
        internal int Releases;
        internal int ModuleDisposals;
        internal int WidthCalls;
        internal bool InvalidData;
        internal bool ForeignRuntime;
        internal TaskCompletionSource? Gate;
        internal TaskCompletionSource? ApplyGate;

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public async ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            object? result = null;
            if (identifier == "import")
                result = this;
            else if (identifier == "openFacade")
                result = "page";
            else if (identifier == "createChart")
                result = "chart";
            else if (identifier == "releaseResult")
                Releases++;
            else if (identifier == "setOption")
            {
                if (ApplyGate is not null)
                    await ApplyGate.Task;
            }
            else if (identifier == "invokeMethod")
            {
                if ((string)args![2]! == "getOption")
                {
                    if (Gate is not null)
                        await Gate.Task;

                    var data = InvalidData ? "{\"animation\":\"invalid\"}" : "{\"series\":[],\"image\":null,\"other\":null}";
                    using var json = JsonDocument.Parse(
                        "{\"value\":"
                            + data
                            + ",\"leaseId\":\"result:1\",\"bindings\":[{\"path\":[\"image\"],\"runtimeId\":\""
                            + (ForeignRuntime ? "other" : "page")
                            + "\",\"ownerId\":\"objects\",\"token\":\"object:1\"},{\"path\":[\"other\"],\"runtimeId\":\"page\",\"ownerId\":\"objects\",\"token\":\"object:1\"}]}");
                    result = json.RootElement.Clone();
                }
                else
                {
                    WidthCalls++;
                    using var json = JsonDocument.Parse("{\"value\":640}");
                    result = json.RootElement.Clone();
                }
            }
            else if (identifier is not ("disposeChart" or "releaseFacade" or "registerExportReadiness"))
                throw new InvalidOperationException(identifier);

            return result is null ? default! : (TValue)result;
        }

        public ValueTask DisposeAsync()
        {
            ModuleDisposals++;
            return ValueTask.CompletedTask;
        }
    }
}
