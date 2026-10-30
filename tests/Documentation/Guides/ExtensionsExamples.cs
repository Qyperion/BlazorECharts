// snippet: Guides.Extensions.Consumer
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
// endsnippet
using System.Text.Json;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;

namespace DocumentationExamples.Guides;

internal static class ExtensionsExamples
{
    internal static void Register(WebApplicationBuilder builder)
    {
        // snippet: Guides.Extensions.Register
        builder.Services.AddECharts().AddExtension(new ProgressSeriesExtension());
        // endsnippet
    }

    internal static ChartOptions WordCloud()
    {
        // snippet: Guides.Extensions.WordCloud
        var options = new ChartOptions
        {
            Tooltip = new TooltipOption { Show = true },
            Series = new WordCloudSeriesOption
            {
                Shape = "circle",
                SizeRange = [12, 48],
                RotationRange = [-90, 90],
                RotationStep = 45,
                GridSize = 6,
                TextStyle = new WordCloudTextStyle { FontFamily = "sans-serif", Color = "#2f5fd0" },
                Data =
                [
                    new WordCloudDataItem { Name = "Blazor", Value = 40 },
                    new WordCloudDataItem { Name = "ECharts", Value = 32 },
                    new WordCloudDataItem { Name = "WebAssembly", Value = 18 },
                ],
            },
        };
        // endsnippet
        return options;
    }

    internal static async Task Mask(EChartsRuntime runtime, EChartInstance chart)
    {
        // snippet: Guides.Extensions.WordCloudMask
        await using var mask = await runtime.CreateImageAsync("images/cloud-mask.png");
        await chart.SetOptionAsync(new ChartOptions
        {
            Series = new WordCloudSeriesOption
            {
                MaskImage = mask,
                KeepAspect = true,
                Data = [new WordCloudDataItem { Name = "Blazor", Value = 40 }],
            },
        });
        // The chart holds its own lease; disposing this handle afterwards is safe.
        // endsnippet
    }

    internal static async Task Themes(EChartsRuntime runtime)
    {
        // snippet: Guides.Extensions.Themes
        await runtime.RegisterThemeAsync("dusk", new ChartOptions
        {
            BackgroundColor = "#1f2433",
            Color = ["#f59f00", "#4dabf7", "#da77f2"],
            TextStyle = new() { Color = "#e6edf7" },
        });
        await runtime.RegisterLocaleAsync("EN-SHORT", new ChartLocaleOption
        {
            Legend = new() { Selector = new() { All = "All", Inverse = "Invert" } },
            Toolbox = new() { SaveAsImage = new() { Title = "Download" } },
        });
        // endsnippet
    }

    internal static async Task Maps(EChartsRuntime runtime, string officeGeoJson, string floorSvg)
    {
        // snippet: Guides.Extensions.Maps
        await runtime.RegisterMapAsync("office", officeGeoJson, new Dictionary<string, GeoSpecialArea>
        {
            // Draw the large "Rooftop" region as a small inset at this map position.
            ["Rooftop"] = new(Left: 104, Top: 0, Width: 20, Height: null),
        });
        await runtime.RegisterSvgMapAsync("floor", floorSvg);

        EChartsMapResult? office = await runtime.GetMapAsync("office");
        var areas = office?.GetSpecialAreas();
        // endsnippet
        _ = areas;
    }

    internal static void Providers(WebApplicationBuilder builder)
    {
        // snippet: Guides.Extensions.Provider
        builder.Services.AddECharts(options =>
        {
            options.Provider = EChartsRuntimeProvider.Module;
            options.ModuleUrl = "https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.esm.min.mjs";
        });
        // endsnippet
    }
}

// snippet: Guides.Extensions.Consumer
public sealed class ProgressSeriesExtension : IChartExtension
{
    public string Id => "product-progress-series";
    public string Version => "1.0.0";
    public IReadOnlyList<string> Dependencies => [];
    public string ModuleUrl => "js/progress-series.js";

    public void ConfigureSerialization(EChartsSerializationContext context) =>
        context.RegisterSeries("progress", new OptionTypeRegistration<ProgressSeriesOption>(
            (writer, series, metadata, path) =>
            {
                writer.WriteString("type", series.Type);
                metadata.WriteProperty(writer, series, "trackColor", series.TrackColor, path);
                metadata.WriteProperty(writer, series, "data", series.Data, path);
            },
            (json, metadata) => new ProgressSeriesOption
            {
                TrackColor = json.TryGetProperty("trackColor", out var color) ? color.GetString() : null,
                Data = json.TryGetProperty("data", out var data) ? [.. data.EnumerateArray().Select(v => v.GetDouble())] : null,
            }));
}

public sealed class ProgressSeriesOption() : SeriesOption("progress")
{
    private string? _trackColor;
    private double[]? _data;

    public string? TrackColor { get => _trackColor; set => SetProperty(ref _trackColor, value, "trackColor"); }
    public double[]? Data { get => _data; set => SetProperty(ref _data, value, "data"); }
}

// endsnippet

// snippet: Guides.Extensions.NestedRead
public sealed class BadgeSeriesOption() : SeriesOption("badge")
{
    private SeriesTooltipOption? _tooltip;
    private NumberOrString? _group;

    public SeriesTooltipOption? Tooltip { get => _tooltip; set => SetProperty(ref _tooltip, value, "tooltip"); }
    public NumberOrString? Group { get => _group; set => SetProperty(ref _group, value, "group"); }

    public static OptionTypeRegistration<BadgeSeriesOption> Registration { get; } = new(
        (writer, series, metadata, path) =>
        {
            writer.WriteString("type", series.Type);
            metadata.WriteProperty(writer, series, "tooltip", series.Tooltip, path);
            metadata.WriteProperty(writer, series, "group", series.Group, path);
        },
        (json, metadata) => new BadgeSeriesOption
        {
            // A core model nested in the extension model, with its unknown fields.
            Tooltip = json.TryGetProperty("tooltip", out var tooltip) ? metadata.Read<SeriesTooltipOption>(tooltip) : null,
            Group = json.TryGetProperty("group", out var group) ? ReadValue<NumberOrString>(group) : (NumberOrString?)null,
        });

    // Generated unions and tuples implement IReadableOptionValue<T> explicitly.
    private static T ReadValue<T>(JsonElement json) where T : struct, IReadableOptionValue<T> => T.Read(json);
}
// endsnippet
