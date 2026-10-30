using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;

namespace BlazorECharts.Examples;

/// <summary>Registers the page extensions the examples use. Call it in every host, including WebAssembly clients.</summary>
public static class ExampleCatalogBuilderExtensions
{
    /// <summary>Adds WordCloud and the example consumer extension that installs the progress series.</summary>
    public static EChartsBuilder AddExampleCatalog(this EChartsBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.AddWordCloud().AddExtension(new Capabilities.ProgressSeriesExtension());
    }
}
