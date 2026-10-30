using BlazorECharts.Serialization.Generated;

namespace BlazorECharts.Serialization;

/// <summary>The writers, readers and series factories of the built-in option models.</summary>
public static class OptionMetadata
{
    /// <summary>Creates a context with the built-in models registered. Add consumer metadata before preparing options.</summary>
    public static EChartsSerializationContext CreateContext() => GeneratedOptionMetadata.CreateContext();

    /// <summary>Registers the built-in models in a context already configured with binding policies.</summary>
    public static void Register(EChartsSerializationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        GeneratedOptionMetadata.Register(context);
    }
}
