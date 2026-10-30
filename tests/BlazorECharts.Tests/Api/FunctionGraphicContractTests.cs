using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class FunctionGraphicContractTests
{
    [Fact]
    public async Task NativeDispose_ClosesTheSameOwnedManagedHandle()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var chart = await runtime.CreateInstanceAsync(default);

        // Act
        await using var result = await runtime.DisposeNativeAsync([EChartsValue.From("native-id")]);

        // Assert
        Assert.True(chart.IsDisposed);
    }

    [Fact]
    public async Task RegisterCustomSeries_PassesTheRendererAsAFunctionBinding()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());

        // Act
        await runtime.RegisterCustomSeriesAsync("registered-bars", JsFunction.Module<CustomRenderItemSignature>("./render.js", "render"));

        // Assert
        Assert.Equal("registerCustomSeries", bridge.NativePath);
        Assert.Equal("registered-bars", bridge.NativeArguments.GetProperty("json").GetProperty("args")[0].GetString());
        var binding = Assert.Single(bridge.NativeArguments.GetProperty("bindings").EnumerateArray());
        Assert.Equal("module", binding.GetProperty("kind").GetString());
        Assert.Equal(["args", "1"], binding.GetProperty("path").EnumerateArray().Select(p => p.ToString()));
        await Assert.ThrowsAsync<ArgumentException>(
            () => runtime.RegisterCustomSeriesAsync(" ", JsFunction.Module<CustomRenderItemSignature>("./render.js", "render")).AsTask());
        await Assert.ThrowsAsync<ArgumentNullException>(() => runtime.RegisterCustomSeriesAsync("x", null!).AsTask());
    }

    [Fact]
    public async Task InlinePolicy_IsFrozenAtFirstUseRatherThanConstruction()
    {
        // Arrange
        var bridge = new Bridge();
        var options = new EChartsRuntimeOptions();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), options);

        // Act
        options.AllowInlineJavaScript = true;
        var chart = await runtime.CreateInstanceAsync(default);
        var chartOptions = new ChartOptions();
        chartOptions.AdditionalProperties["callback"] = EChartsValue.From(JsFunction.Inline<CustomRenderItemSignature>("() => null"));
        await chart.SetOptionAsync(chartOptions);

        // Assert
        Assert.True(bridge.Configuration.GetProperty("allowInlineJavaScript").GetBoolean());
    }

    [Fact]
    public async Task ActionPositionCallback_UsesBindingTransport()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var chart = await runtime.CreateInstanceAsync(default);

        // Act
        await chart.DispatchActionAsync(new ShowTipAction
        {
            SeriesIndex = 0,
            DataIndex = 0,
            Position = EventActionValue.From(JsFunction.Module<TooltipPositionCallback>("./module.js", "position")),
        });

        // Assert
        Assert.Equal("position", bridge.Prepared.GetProperty("bindings")[0].GetProperty("path")[0].GetString());
    }

    [Fact]
    public async Task ModuleBindings_ReachTheExistingCommandTransport()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var chart = await runtime.CreateInstanceAsync(default);
        var options = new ChartOptions();
        options.AdditionalProperties["callback"] = EChartsValue.From(JsFunction.Module<CustomRenderItemSignature>("./module.js", "render"));

        // Act
        await chart.SetOptionAsync(options);

        // Assert
        Assert.Equal("module", bridge.Prepared.GetProperty("bindings")[0].GetProperty("kind").GetString());
        Assert.Equal(JsonValueKind.Null, bridge.Prepared.GetProperty("json").GetProperty("callback").ValueKind);
    }

    [Fact]
    public async Task InlinePolicy_IsConsistentAcrossSerializerAndBrowserConfiguration()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new() { AllowInlineJavaScript = true });
        var chart = await runtime.CreateInstanceAsync(default);
        var options = new ChartOptions();
        options.AdditionalProperties["callback"] = EChartsValue.From(JsFunction.Inline<CustomRenderItemSignature>("() => null"));

        // Act
        await chart.SetOptionAsync(options);

        // Assert
        Assert.True(bridge.Configuration.GetProperty("allowInlineJavaScript").GetBoolean());
        Assert.Equal("inline", bridge.Prepared.GetProperty("bindings")[0].GetProperty("kind").GetString());
    }

    [Fact]
    public async Task BrowserReference_PreparesWithRuntimeIdentity_AndRejectsDisposedHandle()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var chart = await runtime.CreateInstanceAsync(default);
        var reference = await runtime.CreateCanvasAsync(32, 16);
        var options = new ChartOptions();
        options.AdditionalProperties["canvas"] = EChartsValue.From(reference);

        // Act
        await chart.SetOptionAsync(options);

        // Assert
        Assert.Equal("page", bridge.Prepared.GetProperty("bindings")[0].GetProperty("runtimeId").GetString());

        // Act
        await reference.DisposeAsync();
        var error = Assert.Throws<OptionSerializationException>(() => chart.SetOptionAsync(options));

        // Assert
        Assert.Contains("$.canvas", error.Message);
        Assert.IsType<ObjectDisposedException>(error.InnerException);
        Assert.Equal(1, bridge.Released);
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://test.local/app/", "https://test.local/app/");
    }

    private sealed class Bridge : IJSRuntime, IJSObjectReference
    {
        public JsonElement Prepared;
        public JsonElement Configuration;
        public JsonElement NativeArguments;
        public string? NativePath;
        public int Released;

        public ValueTask<T> InvokeAsync<T>(string name, object?[]? args) => InvokeAsync<T>(name, default, args);

        public ValueTask<T> InvokeAsync<T>(string name, CancellationToken token, object?[]? args)
        {
            object? value = null;
            switch (name)
            {
                case "import":
                    value = this;
                    break;
                case "openFacade":
                    Configuration = (JsonElement)args![2]!;
                    value = "page";
                    break;
                case "createChart":
                    value = "chart";
                    break;
                case "setOption":
                    Prepared = JsonDocument.Parse(
                        "{\"json\":"
                            + System.Text.Encoding.UTF8.GetString((byte[])args![2]!)
                            + ",\"bindings\":"
                            + (args[3] is JsonElement bindings ? bindings.GetRawText() : "[]")
                            + "}").RootElement
                        .Clone();
                    break;
                case "dispatchBoundAction":
                    Prepared = (JsonElement)args![2]!;
                    break;
                case "createNative":
                    using (var document = JsonDocument.Parse("""{"value":null,"leaseId":"native:1","bindings":[{"path":[],"kind":"object","runtimeId":"page","ownerId":"instance-results","token":"object:1"}]}"""))
                        value = document.RootElement.Clone();

                    break;
                case "invokeNative":
                    NativePath = (string)args![1]!;
                    NativeArguments = (JsonElement)args[3]!;
                    using (var document = JsonDocument.Parse(
                        "{\"value\":null,\"bindings\":[],\"disposedCharts\":[{\"ownerId\":\"" + (string)args![0]! + "\",\"chartId\":\"chart\"}]}"))
                        value = document.RootElement.Clone();

                    break;
                case "releaseResult":
                    Released++;
                    break;
            }

            return ValueTask.FromResult<T>(value is T typed ? typed : default!);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
