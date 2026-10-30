using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.WordCloud;

/// <summary>Named rich-text tokens with explicit typed styles, native bindings and retained null entries. Token colors
/// are strings: ECharts evaluates a color callback only on the series text style.</summary>
public sealed class WordCloudRichText : IOptionValue, IJsonOnSerializing
{
    private readonly Dictionary<string, WordCloudItemTextStyle?> _styles = new(StringComparer.Ordinal);

    /// <summary>Gets or sets a named token style. Unknown names retain their exact JSON spelling.</summary>
    public WordCloudItemTextStyle? this[string name] { get => _styles[name]; set => _styles[name] = value; }

    /// <summary>Gets the current named token styles.</summary>
    public IReadOnlyDictionary<string, WordCloudItemTextStyle?> Styles => _styles;

    internal static bool Matches(JsonElement json) =>
        json.ValueKind == JsonValueKind.Object
            && json.EnumerateObject()
                .All(p => p.Value.ValueKind == JsonValueKind.Null || WordCloudTypeRegistration.MatchesWordCloudItemTextStyle(p.Value));

    internal static WordCloudRichText Read(JsonElement json, EChartsSerializationContext context)
    {
        if (!Matches(json))
            throw new JsonException("Invalid rich text styles.");

        var value = new WordCloudRichText();
        foreach (var property in json.EnumerateObject())
            value[property.Name] = property.Value.ValueKind == JsonValueKind.Null
                ? null
                : WordCloudTypeRegistration.ReadWordCloudItemTextStyle(property.Value, context);

        return value;
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path) =>
        context.WriteValue(
            writer,
            EChartsValue.Object(_styles.ToDictionary(p => p.Key, p => EChartsValue.From(p.Value), StringComparer.Ordinal)),
            path);

    void IJsonOnSerializing.OnSerializing() => throw new NotSupportedException("Use OptionSerializer for rich text bindings.");
}
