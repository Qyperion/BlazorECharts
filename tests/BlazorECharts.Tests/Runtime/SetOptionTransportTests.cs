using System.Text;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

/// <summary>setOption sends the options as UTF-8 bytes, which Blazor transfers without a JSON reviver pass, and the
/// bindings separately.</summary>
public sealed class SetOptionTransportTests
{
    [Fact]
    public async Task SetOption_SendsUtf8OptionsAndNoBindings()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        await using var chart = await runtime.CreateInstanceAsync(default);

        // Act
        await chart.SetOptionAsync(new ChartOptions { Series = new LineSeriesOption { Data = [1d, 2d] } });

        // Assert
        var args = Assert.Single(bridge.SetOptions);
        var bytes = Assert.IsType<byte[]>(args[2]);
        Assert.Equal("""{"series":{"type":"line","data":[1,2]}}""", Encoding.UTF8.GetString(bytes));
        Assert.Null(args[3]);
    }

    [Fact]
    public async Task SetOption_SendsBindingsSeparately()
    {
        // Arrange
        var bridge = new Bridge();
        await using var runtime = new EChartsRuntime(bridge, new Navigation(), new());
        await using var chart = await runtime.CreateInstanceAsync(default);
        var options = new ChartOptions
        {
            Tooltip = new TooltipOption { Formatter = JsFunction.Module<TooltipFormatterSignature>("./m.js", "format") },
        };

        // Act
        await chart.SetOptionAsync(options);

        // Assert
        var args = Assert.Single(bridge.SetOptions);
        Assert.Equal("""{"tooltip":{"formatter":null}}""", Encoding.UTF8.GetString(Assert.IsType<byte[]>(args[2])));
        var binding = Assert.Single(((JsonElement)args[3]!).EnumerateArray());
        Assert.Equal("""["tooltip","formatter"]""", binding.GetProperty("path").GetRawText());
        Assert.Equal("module", binding.GetProperty("kind").GetString());
    }

    [Fact]
    public void PreparedOption_JsonMatchesTheSentBytes()
    {
        // Act
        var prepared = OptionSerializer.Serialize(new ChartOptions { Title = new TitleOption { Text = "A" } }, OptionMetadata.CreateContext());

        // Assert
        Assert.Equal("""{"title":{"text":"A"}}""", prepared.Json.GetRawText());
        Assert.Equal("A", prepared.Json.GetProperty("title").GetProperty("text").GetString());
    }

    private sealed class Navigation : NavigationManager
    {
        public Navigation() => Initialize("https://example.test/", "https://example.test/");

        protected override void NavigateToCore(string uri, bool forceLoad) => throw new NotSupportedException();
    }

    private sealed class Bridge : IJSRuntime, IJSObjectReference
    {
        internal readonly List<object?[]> SetOptions = [];

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (identifier == "setOption")
                SetOptions.Add(args!);

            object? result = identifier switch { "import" => this, "openFacade" => "page", "createChart" => "chart", _ => null };
            return ValueTask.FromResult<TValue>(result is null ? default! : (TValue)result);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
