using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
namespace BrowserHost.Client.Shared;

public sealed class ConsumerSeries : SeriesOption
{
    public ConsumerSeries() : base("consumer") { }

    private double[] _data = [];

    public double[] Data { get => _data; set => SetProperty(ref _data, value, "data"); }
}

public sealed class ConsumerExtension : IChartExtension
{
    public string Id => "synthetic-consumer";
    public string Version => "1.0";
    public string ModuleUrl => "modules/consumer-extension.js";
    public IReadOnlyList<string> Dependencies => [];

    public void ConfigureSerialization(EChartsSerializationContext context) =>
        context.RegisterSeries("consumer", new OptionTypeRegistration<ConsumerSeries>(
        (w, value, c, p) =>
        {
            w.WriteString("type", value.Type);
            c.WriteProperty(w, value, "data", value.Data, p);
        },
        (json, _) => new() { Data = json.GetProperty("data").EnumerateArray().Select(v => v.GetDouble()).ToArray() }));
}
