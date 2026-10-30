namespace BlazorECharts.Runtime;

/// <summary>Describes a module exporting register(runtime), receiving the page's selected ECharts object.</summary>
public interface IChartExtension
{
    /// <summary>Gets the stable extension identity.</summary>
    string Id { get; }

    /// <summary>Gets the exact extension version.</summary>
    string Version { get; }

    /// <summary>Gets required extension identities, registered before this extension.</summary>
    IReadOnlyList<string> Dependencies { get; }

    /// <summary>Gets the module URL, resolved against the application base URI.</summary>
    string ModuleUrl { get; }

    /// <summary>Registers explicit consumer models and serializers on each managed facade.</summary>
    void ConfigureSerialization(BlazorECharts.Serialization.EChartsSerializationContext context) { }
}
