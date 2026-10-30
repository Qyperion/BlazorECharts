using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>Reading a getOption snapshot, editing it and reapplying it.</summary>
public sealed class SnapshotEditTests
{
    [Fact]
    public async Task UnknownSeries_ReadsAsRawSeriesAndRoundTrips()
    {
        // Arrange
        await using var chart = await Chart("""{"series":[{"type":"liquidFill","id":"l","data":[0.6],"waveAnimation":false},{"type":"line","data":[1]}]}""");

        // Act
        await using var snapshot = await chart.Instance.GetOptionAsync();

        // Assert
        var raw = Assert.IsType<RawSeriesOption>(snapshot.Options.Series!.Value.Items[0]);
        Assert.Equal("liquidFill", raw.Type);
        Assert.IsType<LineSeriesOption>(snapshot.Options.Series!.Value.Items[1]);

        // Act
        var json = OptionSerializer.Serialize(snapshot.Options, OptionMetadata.CreateContext()).Json.GetProperty("series")[0];

        // Assert
        Assert.Equal("""{"type":"liquidFill","data":[0.6],"id":"l","waveAnimation":false}""", json.GetRawText());
    }

    [Fact]
    public void UnknownSeries_OutsideSnapshots_StaysAnError()
    {
        // Arrange
        using var document = JsonDocument.Parse("""{"series":[{"type":"liquidFill"}]}""");

        // Act
        var error = Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadChartOptions(document.RootElement));

        // Assert
        Assert.Equal("$.series[0]", error.Path);
        Assert.Contains("liquidFill", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"title":[{"text":12}]}""", "$.title[0].text")]
    [InlineData("""{"xAxis":[{"type":"value","name":12}]}""", "$.xAxis[0]")]
    [InlineData("""{"series":[{"type":"bar","label":{"show":"yes"}}]}""", "$.series[0].label.show")]
    [InlineData("""{"series":[{"type":"line","data":[1,{"value":1,"name":{}}]}]}""", "$.series[0].data[1]")]
    public async Task MismatchedValue_IsAJsonExceptionWithItsPath(string value, string path)
    {
        // Act & Assert
        using (var document = JsonDocument.Parse(value))
            Assert.Equal(path, Assert.Throws<JsonException>(() => GeneratedOptionMetadata.ReadChartOptions(document.RootElement)).Path);

        // Arrange
        await using var chart = await Chart(value);

        // Act
        var error = await Assert.ThrowsAsync<JsonException>(() => chart.Instance.GetOptionAsync().AsTask());

        // Assert
        Assert.Equal(path, error.Path);
        Assert.Contains(path, error.Message, StringComparison.Ordinal);
        Assert.Equal(1, chart.Bridge.Releases);
    }

    private const string Callbacks = """{"series":[{"id":"a","type":"line","label":{"formatter":null}},{"id":"b","type":"bar","label":{"formatter":null}}],"tooltip":[{"formatter":null}]}""";
    private const string CallbackBindings = """[["series",0,"label","formatter"],["series",1,"label","formatter"],["tooltip",0,"formatter"]]""";

    [Fact]
    public async Task UneditedSnapshot_PreparesEveryBinding()
    {
        // Arrange
        await using var chart = await Chart(Callbacks, CallbackBindings);

        // Act
        await using var snapshot = await chart.Instance.GetOptionAsync();

        // Assert
        Assert.Equal(3, snapshot.Prepare(chart.Runtime.Serialization).Bindings.Count);
    }

    public static TheoryData<string, Action<ChartOptions>, string> StructuralEdits => new()
    {
        {
            "prepend",
            o => o.Series = OneOrMany<SeriesOption>.Many([new LineSeriesOption { Id = "new" }, .. o.Series!.Value.Items]),
            "$.series[0].label.formatter"
        },
        { "swap", o => o.Series = OneOrMany<SeriesOption>.Many(o.Series!.Value.Items[1], o.Series!.Value.Items[0]), "$.series[0].label.formatter" },
        { "remove tooltip", o => o.Tooltip = null, "$.tooltip[0].formatter" },
        { "remove label", o => ((BarSeriesOption)o.Series!.Value.Items[1]).Label = null, "$.series[1].label.formatter" },
    };

    [Theory]
    [MemberData(nameof(StructuralEdits))]
    public async Task StructuralEdit_IsOneInvalidOperationWithThePath(string edit, Action<ChartOptions> apply, string path)
    {
        // Arrange
        await using var chart = await Chart(Callbacks, CallbackBindings);
        await using var snapshot = await chart.Instance.GetOptionAsync();

        // Act
        apply(snapshot.Options);

        // Assert
        var error = Assert.Throws<InvalidOperationException>(() => snapshot.Prepare(chart.Runtime.Serialization));
        Assert.True(error.Message.Contains(path, StringComparison.Ordinal), $"{edit}: {error.Message}");
    }

    [Fact]
    public async Task AppendedComponentWithIds_KeepsBindings()
    {
        // Arrange
        await using var chart = await Chart(Callbacks, CallbackBindings);
        await using var snapshot = await chart.Instance.GetOptionAsync();

        // Act
        snapshot.Options.Series = OneOrMany<SeriesOption>.Many([.. snapshot.Options.Series!.Value.Items, new LineSeriesOption { Id = "c" }]);

        // Assert
        Assert.Equal(3, snapshot.Prepare(chart.Runtime.Serialization).Bindings.Count);
    }

    [Fact]
    public async Task ShiftedDataItems_WithoutIds_AreDetectedByLength()
    {
        // Arrange
        await using var chart = await Chart(
            """{"series":[{"type":"line","data":[1,{"value":2,"label":{"formatter":null}},3]}]}""",
            """[["series",0,"data",1,"label","formatter"]]""");
        await using var snapshot = await chart.Instance.GetOptionAsync();
        var line = (LineSeriesOption)snapshot.Options.Series!.Value.Items[0];

        // Act
        line.Data = [0d, .. line.Data!];

        // Assert
        var error = Assert.Throws<InvalidOperationException>(() => snapshot.Prepare(chart.Runtime.Serialization));
        Assert.Contains("$.series[0].data[1].label.formatter", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void UnionAlternative_EditedAfterTryGet_IsWritten()
    {
        // Arrange
        using var document = JsonDocument.Parse("""{"yAxis":[{"type":"value","name":"before"}],"series":[{"type":"bar","data":[{"value":1,"name":"a"},[1,2]]}]}""");
        var options = GeneratedOptionMetadata.ReadChartOptions(document.RootElement);
        var axis = options.YAxis!.Value.Items[0]!.Value;

        // Act
        Assert.True(axis.TryGet(out YAxisValueOption? value));
        value.Name = "after";
        Assert.True(axis.TryGet(out YAxisValueOption? again));
        Assert.Same(value, again);
        Assert.Same(value, axis.Value);
        var bar = (BarSeriesOption)options.Series!.Value.Items[0];
        Assert.True(bar.Data![0]!.Value.TryGet(out BarDataItemOption? item));
        item.Name = "z";
        Assert.True(bar.Data![1]!.Value.TryGet(out OptionDataValue?[]? pair));
        pair[1] = 5d;

        // Assert
        var json = OptionSerializer.Serialize(options, OptionMetadata.CreateContext()).Json;
        Assert.Equal("after", json.GetProperty("yAxis")[0].GetProperty("name").GetString());
        Assert.Equal("z", json.GetProperty("series")[0].GetProperty("data")[0].GetProperty("name").GetString());
        Assert.Equal(5, json.GetProperty("series")[0].GetProperty("data")[1][1].GetDouble());
    }

    [Fact]
    public void UnionAlternative_NotMaterialized_WritesTheJsonUnchanged()
    {
        // Arrange
        using var document = JsonDocument.Parse("""{"yAxis":[{"type":"value","name":"before","unknown":1}]}""");

        // Act
        var options = GeneratedOptionMetadata.ReadChartOptions(document.RootElement);

        // Assert
        Assert.IsType<EChartsValue>(options.YAxis!.Value.Items[0]!.Value.Value);
        var json = OptionSerializer.Serialize(options, OptionMetadata.CreateContext()).Json;
        Assert.Equal("""[{"type":"value","name":"before","unknown":1}]""", json.GetProperty("yAxis").GetRawText());
    }

    private static async Task<TestChart> Chart(string value, string paths = "[]")
    {
        var bridge = new Bridge(value, paths);
        var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        return new TestChart(bridge, runtime, await runtime.CreateInstanceAsync(default));
    }

    private sealed record TestChart(Bridge Bridge, EChartsRuntime Runtime, EChartInstance Instance) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            await Instance.DisposeAsync();
            await Runtime.DisposeAsync();
        }
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class Bridge(string value, string paths) : IJSRuntime, IJSObjectReference
    {
        internal int Releases;

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            object? result = identifier switch
            {
                "import" => this,
                "openFacade" => "page",
                "createChart" => "chart",
                "invokeMethod" => Envelope(),
                "releaseResult" => Released(),
                "disposeChart" or "releaseFacade" or "registerExportReadiness" or "setOption" => null,
                _ => throw new InvalidOperationException(identifier),
            };
            return ValueTask.FromResult<TValue>(result is null ? default! : (TValue)result);
        }

        private object? Released()
        {
            Releases++;
            return null;
        }

        private JsonElement Envelope()
        {
            using var parsed = JsonDocument.Parse(paths);
            var bindings = string.Join(",", parsed.RootElement.EnumerateArray().Select((path, i) =>
                $$"""{"path":{{path.GetRawText()}},"runtimeId":"page","ownerId":"objects","token":"object:{{i}}"}"""));
            using var json = JsonDocument.Parse($$"""{"value":{{value}},"leaseId":"result:1","bindings":[{{bindings}}]}""");
            return json.RootElement.Clone();
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
