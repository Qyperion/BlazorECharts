using System.Reflection;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class GlobalMethodContractTests
{
    [Theory]
    [InlineData(nameof(EChartsRuntime.RegisterLocaleAsync), "name,locale")]
    [InlineData(nameof(EChartsRuntime.RegisterThemeAsync), "name,theme")]
    [InlineData(nameof(EChartsRuntime.RegisterMapAsync), "name,geoJson,specialAreas")]
    public void RegisterOverloads_UseTheSameParameterNames(string method, string expected)
    {
        // Act
        var overloads = typeof(EChartsRuntime).GetMethods(BindingFlags.Public | BindingFlags.Instance).Where(m => m.Name == method).ToArray();

        // Assert
        Assert.NotEmpty(overloads);
        foreach (var overload in overloads)
            Assert.Equal(expected, string.Join(",", overload.GetParameters().Select(p => p.Name).Where(n => n != "cancellationToken")));
    }

    [Fact]
    public void UndocumentedGlobalHelpers_AreNotManagedApi()
    {
        // Act
        var methods = typeof(EChartsRuntime).GetMethods(BindingFlags.Public | BindingFlags.Instance).Select(m => m.Name).ToHashSet();

        // Assert
        foreach (var hidden in new[] { "ColorLiftAsync", "ZrUtilMergeAllAsync", "FormatFormatTplAsync", "ColorLiftNativeAsync", "RegisterTransformNativeAsync",
            "RegisterActionNativeAsync", "GraphicRectNativeAsync", "GraphicLinearGradientNativeAsync", "GetInstanceByIdAsync", "DisConnectAsync", "GetCoordinateSystemDimensionsAsync" })
            Assert.DoesNotContain(hidden, methods);

        foreach (var documented in new[] { "RegisterThemeAsync", "RegisterLocaleAsync", "ConnectAsync", "GraphicExtendShapeNativeAsync", "SetPlatformAPINativeAsync", "InvokeNativeAsync" })
            Assert.Contains(documented, methods);
    }

    [Fact]
    public async Task UndocumentedGlobalHelpers_AreCallableThroughTheNativeBridge()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        runtime.Serialization.Register(FixtureJsonContext.Default.FixtureData);

        // Act
        await using var result = await runtime.InvokeNativeAsync(
            "zrUtil.mergeAll",
            [EChartsValue.Array(EChartsValue.From(new FixtureData("registered", 0, DateTimeOffset.UnixEpoch)))]);

        // Assert
        Assert.Equal("zrUtil.mergeAll", bridge.NativePath);
        Assert.Equal("registered", bridge.NativeArguments.GetProperty("json").GetProperty("args")[0][0].GetProperty("label").GetString());
        Assert.Equal("merged", result.Json.GetString());
    }

    [Fact]
    public async Task ConsumerExtension_RegistersSerializerWithoutChangingCore()
    {
        // Arrange
        var services = new ServiceCollection();
        var builder = services.AddECharts();
        builder.AddExtension(new ConsumerExtension());
        await using var runtime = new EChartsRuntime(new Bridge(), new Navigation(), builder.Options);

        // Act
        var value = OptionSerializer.Serialize(
            new ChartOptions { Series = BlazorECharts.Values.OneOrMany<SeriesOption>.One(new ConsumerSeries { Value = 7 }) },
            runtime.Serialization);

        // Assert
        Assert.Equal("consumer", value.Json.GetProperty("series").GetProperty("type").GetString());
        Assert.Equal(7, value.Json.GetProperty("series").GetProperty("value").GetInt32());
        Assert.IsType<ConsumerSeries>(runtime.Serialization.ReadSeries(value.Json.GetProperty("series")));

        // Act & Assert
        Assert.Throws<InvalidOperationException>(() => builder.AddExtension(new ConsumerExtension()));
        await runtime.InitializeAsync();
    }

    [Fact]
    public async Task MapRoundTrip_PreservesGeoJsonAndSvg()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        using var json = JsonDocument.Parse("""{"type":"FeatureCollection","features":[],"zero":0,"flag":false}""");

        // Act
        await runtime.RegisterMapAsync("geo", json.RootElement);
        var result = await runtime.GetMapAsync("geo");

        // Assert
        Assert.Equal(0, result!.GeoJson!.Value.GetProperty("zero").GetInt32());
        Assert.False(result.GeoJson.Value.GetProperty("flag").GetBoolean());

        // Act
        await runtime.RegisterSvgMapAsync("svg", "<svg/>");

        // Assert
        Assert.False((await runtime.GetMapAsync("svg"))!.IsGeoJson);
        Assert.Null(await runtime.GetMapAsync("missing"));

        // Act
        await runtime.RegisterLocaleAsync("CUSTOM", json.RootElement);
        await runtime.RegisterThemeAsync("theme", new ChartOptions { Animation = false });

        // Assert
        Assert.False(bridge.LastArguments[1].GetProperty("animation").GetBoolean());
    }

    [Fact]
    public async Task RegisterMap_TypedSpecialAreasReachNativeArgumentsAndReadBack()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var areas = new Dictionary<string, GeoSpecialArea> { ["Alaska"] = new(-131, 25, 15, null), ["Hawaii"] = new(-110, 28.5, null, 5) };
        using var json = JsonDocument.Parse("""{"type":"FeatureCollection","features":[]}""");

        // Act
        await runtime.RegisterMapAsync("usa", json.RootElement, areas);

        // Assert
        Assert.Equal(
            """{"Alaska":{"left":-131,"top":25,"width":15},"Hawaii":{"left":-110,"top":28.5,"height":5}}""",
            bridge.LastArguments[2].GetRawText());

        // Act
        var read = (await runtime.GetMapAsync("usa"))!.GetSpecialAreas()!;

        // Assert
        Assert.Equal(new GeoSpecialArea(-131, 25, 15, null), read["Alaska"]);
        Assert.Equal(new GeoSpecialArea(-110, 28.5, null, 5), read["Hawaii"]);

        // Act
        await runtime.RegisterMapAsync("text", """{"type":"FeatureCollection","features":[]}""", areas);

        // Assert
        Assert.Equal(JsonValueKind.String, bridge.LastArguments[1].ValueKind);
        Assert.Equal(-131, bridge.LastArguments[2].GetProperty("Alaska").GetProperty("left").GetDouble());

        // Act & Assert
        await Assert.ThrowsAsync<ArgumentException>(
            () => runtime.RegisterMapAsync("bad", json.RootElement, new Dictionary<string, GeoSpecialArea> { ["x"] = new(double.NaN, 0, null, null) })
                .AsTask());
        await Assert.ThrowsAsync<ArgumentException>(
            () => runtime.RegisterMapAsync(
                "bad",
                json.RootElement,
                new Dictionary<string, GeoSpecialArea> { ["x"] = new(0, 0, double.PositiveInfinity, null) })
                .AsTask());
    }

    [Fact]
    public async Task GetSpecialAreas_IsNullWithoutAreasAndForSvg()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        using var json = JsonDocument.Parse("""{"type":"FeatureCollection","features":[]}""");

        // Act
        await runtime.RegisterMapAsync("plain", json.RootElement);

        // Assert
        Assert.Null((await runtime.GetMapAsync("plain"))!.GetSpecialAreas());

        // Act
        await runtime.RegisterSvgMapAsync("svg", "<svg/>");

        // Assert
        Assert.Null((await runtime.GetMapAsync("svg"))!.GetSpecialAreas());
    }

    [Fact]
    public async Task RegisterMap_StringGeoJsonUsesNativeTextOverload()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        const string text = """{"type":"FeatureCollection","features":[]}""";

        // Act
        await runtime.RegisterMapAsync("text", text);

        // Assert
        Assert.Equal("text", bridge.LastArguments[0].GetString());
        Assert.Equal(text, bridge.LastArguments[1].GetString());
        Assert.Equal(JsonValueKind.Null, bridge.LastArguments[2].ValueKind);
    }

    [Fact]
    public async Task RegisterLocale_TypedOptionWritesOnlyAssignedFields()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());

        // Act
        await runtime.RegisterLocaleAsync(
            "typed",
            new ChartLocaleOption { Legend = new() { Selector = new() { All = "Everything" } }, Time = new() { Month = ["M1"] } });

        // Assert
        Assert.Equal("typed", bridge.LastArguments[0].GetString());
        Assert.Equal("""{"legend":{"selector":{"all":"Everything"}},"time":{"month":["M1"]}}""", bridge.LastArguments[1].GetRawText());

        // Arrange
        var init = new ChartInitOptions { Locale = new ChartLocaleOption { Legend = new() { Selector = new() { Inverse = "Flip" } } } };

        // Act & Assert
        Assert.Equal(
            "Flip",
            OptionSerializer.Serialize(init, runtime.Serialization).Json
                .GetProperty("locale")
                .GetProperty("legend")
                .GetProperty("selector")
                .GetProperty("inverse")
                .GetString());
    }

    [Fact]
    public async Task LookupAndDispose_ResolveOnlyOwnedHandlesByNativeIdAndElement()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var first = new ElementReference("first");
        var second = new ElementReference("second");

        // Act
        var a = await runtime.CreateInstanceAsync(first);
        var b = await runtime.CreateInstanceAsync(second);

        // Assert
        Assert.Same(a, await runtime.GetInstanceByDomAsync(first));
        Assert.Same(b, await runtime.GetInstanceByIdAsync("native-2"));
        Assert.Null(await runtime.GetInstanceByDomAsync(new ElementReference("unknown")));

        // Arrange
        await using var other = new EChartsRuntime(new Bridge { RuntimeId = "another" }, new Navigation(), new());

        // Act & Assert
        Assert.Null(await other.GetInstanceByDomAsync(first));

        // Act
        await other.DisposeChartAsync(first);

        // Assert
        Assert.False(a.IsDisposed);

        // Act
        await runtime.DisposeChartAsync("missing");

        // Assert
        Assert.False(a.IsDisposed || b.IsDisposed);

        // Act
        await runtime.DisposeChartAsync("native-2");

        // Assert
        Assert.True(b.IsDisposed);
        Assert.False(a.IsDisposed);
        Assert.Null(await runtime.GetInstanceByIdAsync("native-2"));

        // Act
        await runtime.DisposeChartAsync(first);

        // Assert
        Assert.True(a.IsDisposed);
        Assert.Null(await runtime.GetInstanceByDomAsync(first));
        Assert.Equal(
            ["dom:first", "id:native-2", "dom:unknown", "id:missing", "id:native-2", "id:native-2", "dom:first", "dom:first"],
            bridge.Lookups);
    }

    [Fact]
    public async Task Groups_RejectForeignRuntimeAndDisposedMembers()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        var chart = await runtime.CreateInstanceAsync(default);

        // Act
        await chart.SetGroupAsync("g");

        // Assert
        Assert.Equal("g", await chart.GetGroupAsync());

        // Act & Assert
        Assert.Equal("g", await runtime.ConnectAsync([chart]));
        await runtime.DisconnectAsync("g");

        // Arrange
        await using var other = new EChartsRuntime(new Bridge { RuntimeId = "another" }, new Navigation(), new());
        var foreign = await other.CreateInstanceAsync(default);

        // Act & Assert
        await Assert.ThrowsAsync<ArgumentException>(() => runtime.ConnectAsync([foreign]).AsTask());

        // Act
        await chart.DisposeAsync();

        // Assert
        await Assert.ThrowsAsync<ObjectDisposedException>(() => runtime.ConnectAsync([chart]).AsTask());
    }

    [Fact]
    public async Task CoordinateSystemDimensions_PreserveObjectDefinitions()
    {
        // Arrange
        await using var runtime = new EChartsRuntime(new Bridge(), new Navigation(), new());

        // Act
        var dimensions = await runtime.GetCoordinateSystemDimensionsAsync("custom");

        // Assert
        Assert.Equal("x", dimensions![0].Name);
        Assert.Equal("category", dimensions[1].Name);
        Assert.Equal("ordinal", dimensions[1].Type);
        Assert.Equal("Label", dimensions[1].DisplayName);
    }

    [Fact]
    public async Task Init_PreservesNativeObjectTheme()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());

        // Act
        await runtime.CreateInstanceWithThemeAsync(default, new ChartOptions { BackgroundColor = "#123456" });

        // Assert
        Assert.Equal("#123456", ((JsonElement)bridge.LastTheme!).GetProperty("backgroundColor").GetString());
    }

    private sealed class ConsumerSeries() : SeriesOption("consumer")
    {
        public int Value { get; set; }
    }

    private sealed class ConsumerExtension : IChartExtension
    {
        public string Id => "consumer";
        public string Version => "1";
        public string ModuleUrl => "consumer.js";
        public IReadOnlyList<string> Dependencies => [];

        public void ConfigureSerialization(EChartsSerializationContext context) =>
            context.RegisterSeries("consumer", new OptionTypeRegistration<ConsumerSeries>(
            (w, v, c, p) =>
            {
                w.WriteString("type", v.Type);
                w.WriteNumber("value", v.Value);
            }, (j, _) => new() { Value = j.GetProperty("value").GetInt32() }));
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class Bridge : IJSRuntime, IJSObjectReference
    {
        public string RuntimeId = "page";
        private string? _group;
        private JsonElement? _map;
        private JsonElement? _areas;
        private bool _svg;
        private int _charts;
        public JsonElement LastArguments;
        public string? NativePath;
        public JsonElement NativeArguments;

        public List<string> Lookups { get; } = [];

        public object? LastTheme;

        public ValueTask<T> InvokeAsync<T>(string identifier, object?[]? args) => InvokeAsync<T>(identifier, default, args);

        public ValueTask<T> InvokeAsync<T>(string identifier, CancellationToken token, object?[]? args)
        {
            object? result = null;
            if (identifier == "import")
                result = this;
            else if (identifier == "openFacade")
                result = RuntimeId;
            else if (identifier == "createChart")
            {
                result = _charts++ == 0 ? "chart" : "chart" + _charts;
                LastTheme = args![2];
            }
            else if (identifier == "findInstance")
            {
                var key = args![2] is ElementReference element ? element.Id : (string)args[2]!;
                Lookups.Add(args[1] + ":" + key);
                result = key is "first" or "native-1" ? "chart" : key is "second" or "native-2" ? "chart2" : null;
            }
            else if (identifier == "invokeNative")
            {
                NativePath = (string)args![1]!;
                NativeArguments = (JsonElement)args[3]!;
                result = Parse("""{"value":"merged","bindings":[]}""");
            }
            else if (identifier == "invokeGlobalMethod")
            {
                var method = (string)args![1]!;
                LastArguments = (JsonElement)args[2]!;
                if (method == "registerMap")
                {
                    _svg = LastArguments[1].ValueKind == JsonValueKind.Object && LastArguments[1].TryGetProperty("svg", out _);
                    if (!_svg)
                    {
                        _map = LastArguments[1].Clone();
                        _areas = LastArguments.GetArrayLength() > 2 ? LastArguments[2].Clone() : null;
                    }
                }

                if (method == "getMap")
                    result = Parse(
                        LastArguments[0].GetString() == "missing"
                            ? "null"
                            : _svg
                                ? "false"
                                : "{\"geoJSON\":"
                                    + _map!.Value.GetRawText()
                                    + ",\"geoJson\":"
                                    + _map!.Value.GetRawText()
                                    + ",\"specialAreas\":"
                                    + (_areas?.GetRawText() ?? "null")
                                    + "}");

                if (method == "getCoordinateSystemDimensions")
                    result = Parse("""["x",{"name":"category","type":"ordinal","displayName":"Label"}]""");
            }
            else if (identifier == "invokeMethod")
            {
                var method = (string)args![2]!;
                if (method == "setGroup")
                    _group = ((JsonElement)args[3]!)[0].GetString();

                result = Parse("{\"value\":" + (method == "getGroup" ? "\"" + _group + "\"" : "null") + "}");
            }
            else if (identifier == "connect")
                result = "g";

            return ValueTask.FromResult<T>(result is null ? default! : (T)result);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        private static JsonElement Parse(string value)
        {
            using var d = JsonDocument.Parse(value);
            return d.RootElement.Clone();
        }
    }
}
