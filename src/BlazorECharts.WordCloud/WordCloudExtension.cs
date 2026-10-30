using BlazorECharts.Runtime;
using BlazorECharts.Serialization;

namespace BlazorECharts.WordCloud;

/// <summary>Registers the optional, version-pinned WordCloud module against the selected core runtime.</summary>
public sealed class WordCloudExtension : IChartExtension
{
    // Must equal StaticWebAssetBasePath in the project file.
    internal const string AssetBasePath = "_content/BlazorECharts.WordCloud";

    /// <summary>Gets the stable page extension identity.</summary>
    public string Id => "echarts-wordcloud";

    /// <summary>Gets the exact @qyperion/echarts-wordcloud version validated against ECharts 6.1.0.</summary>
    public string Version => "3.0.0";

    /// <summary>Gets the application-relative optional module URL.</summary>
    public string ModuleUrl => $"{AssetBasePath}/js/wordcloud-extension.js";

    /// <summary>Gets additional extension dependencies. Core is supplied by the page runtime.</summary>
    public IReadOnlyList<string> Dependencies => [];

    /// <summary>Adds explicit WordCloud serializers to this managed facade.</summary>
    public void ConfigureSerialization(EChartsSerializationContext context) => WordCloudTypeRegistration.Register(context);
}

/// <summary>Optional WordCloud registration.</summary>
public static class WordCloudBuilderExtensions
{
    /// <summary>Adds WordCloud models and its optional browser module before first runtime use.</summary>
    public static EChartsBuilder AddWordCloud(this EChartsBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        var existing = builder.Options.Extensions.Where(extension => extension.Id == "echarts-wordcloud").ToArray();
        if (existing.Any(extension => extension is not WordCloudExtension))
            throw new InvalidOperationException("Conflicting echarts-wordcloud extension registration.");

        if (existing.Length == 0)
            builder.AddExtension(new WordCloudExtension());

        return builder;
    }
}
