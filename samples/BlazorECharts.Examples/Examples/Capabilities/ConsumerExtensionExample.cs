using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;

namespace BlazorECharts.Examples.Capabilities;

/// <summary>
/// A consumer extension adds a new series type without changing the library:
/// a JS module exporting register(runtime), a typed model and its explicit serializer.
/// Hosts register it once with <c>AddECharts().AddExtension(new ProgressSeriesExtension())</c>.
/// </summary>
public static class ConsumerExtensionExample
{
    public static ChartOptions Create() => new()
    {
        Title = new TitleOption { Text = "Profile completion (custom progress series)", Left = "center" },
        Series = new ProgressSeriesOption
        {
            TrackColor = "#e8eefc",
            Data =
            [
                new ProgressItem { Name = "Avatar", Value = 100 },
                new ProgressItem { Name = "Bio", Value = 65 },
                new ProgressItem { Name = "Links", Value = 40 },
                new ProgressItem { Name = "Pinned post", Value = 15 },
            ],
        },
    };
}

/// <summary>The page extension that installs the <c>progress</c> series.</summary>
public sealed class ProgressSeriesExtension : IChartExtension
{
    public string Id => "examples-progress-series";
    public string Version => "1.0.0";
    public IReadOnlyList<string> Dependencies => [];
    public string ModuleUrl => ExampleModules.ProgressExtension;

    public void ConfigureSerialization(EChartsSerializationContext context)
    {
        context.Register(new OptionTypeRegistration<ProgressItem>(
            (writer, item, metadata, path) =>
            {
                metadata.WriteProperty(writer, item, "name", item.Name, path);
                metadata.WriteProperty(writer, item, "value", item.Value, path);
            },
            (json, _) => new ProgressItem { Name = json.GetProperty("name").GetString(), Value = json.GetProperty("value").GetDouble() }));
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
                Data = json.TryGetProperty("data", out var data)
                    ? [.. data.EnumerateArray()
                        .Select(
                            item => new ProgressItem { Name = item.GetProperty("name").GetString(), Value = item.GetProperty("value").GetDouble() })]
                    : null,
            }));
    }
}

/// <summary>The typed model of the <c>progress</c> series.</summary>
public sealed class ProgressSeriesOption() : SeriesOption("progress")
{
    private string? _trackColor;
    private ProgressItem[]? _data;

    public string? TrackColor { get => _trackColor; set => SetProperty(ref _trackColor, value, "trackColor"); }
    public ProgressItem[]? Data { get => _data; set => SetProperty(ref _data, value, "data"); }
}

/// <summary>One progress bar: a label and a percentage.</summary>
public sealed class ProgressItem : OptionObject
{
    private string? _name;
    private double? _value;

    public string? Name { get => _name; set => SetProperty(ref _name, value, "name"); }
    public double? Value { get => _value; set => SetProperty(ref _value, value, "value"); }
}
