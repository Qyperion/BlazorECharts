using System.Text.Json;

namespace BlazorECharts.Serialization;

/// <summary>Puts default options under the options of a chart, as ECharts merges an option object into a component:
/// objects merge by key, every other value of the chart replaces the default.</summary>
internal static class OptionDefaults
{
    private const string BaseOption = "baseOption";

    /// <summary>Options with a <c>baseOption</c>, such as a timeline, take the defaults there: ECharts reads components
    /// only from it.</summary>
    internal static PreparedOption Apply(PreparedOption options, PreparedOption defaults)
    {
        var over = options.Json;
        var under = defaults.Json;
        var based = over.TryGetProperty(BaseOption, out var baseOption) && baseOption.ValueKind == JsonValueKind.Object;
        using var buffer = new PooledBufferWriter();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { MaxDepth = 64, Encoder = PreparedOption.TransportEncoder }))
        {
            if (based)
            {
                writer.WriteStartObject();
                foreach (var property in over.EnumerateObject())
                {
                    writer.WritePropertyName(property.Name);
                    if (property.NameEquals(BaseOption))
                        Merge(writer, under, baseOption);
                    else
                        property.Value.WriteTo(writer);
                }

                writer.WriteEndObject();
            }
            else
                Merge(writer, under, over);
        }

        var target = based ? baseOption : over;
        var bindings = new List<JsBinding>(options.Bindings);
        foreach (var binding in defaults.Bindings)
        {
            if (!Survives(binding.Path, target))
                continue;

            // Function tokens are unique within a payload; the path moves with the defaults.
            bindings.Add(new(binding, based ? Prefixed(binding.Path) : binding.Path, $"default:{bindings.Count}"));
        }

        return new(buffer.WrittenSpan.ToArray(), bindings);
    }

    private static void Merge(Utf8JsonWriter writer, JsonElement under, JsonElement over)
    {
        writer.WriteStartObject();
        foreach (var property in over.EnumerateObject())
        {
            writer.WritePropertyName(property.Name);
            if (property.Value.ValueKind == JsonValueKind.Object
                && under.TryGetProperty(property.Name, out var inherited)
                && inherited.ValueKind == JsonValueKind.Object)
                Merge(writer, inherited, property.Value);
            else
                property.Value.WriteTo(writer);
        }

        foreach (var property in under.EnumerateObject())
        {
            if (over.TryGetProperty(property.Name, out _))
                continue;

            writer.WritePropertyName(property.Name);
            property.Value.WriteTo(writer);
        }

        writer.WriteEndObject();
    }

    // A default value is written where the chart's options have no value on its path; Merge descends only through objects.
    private static bool Survives(JsBindingPath path, JsonElement over)
    {
        var current = over;
        for (var i = 0; i < path.Count; i++)
        {
            if (path[i] is not string name || current.ValueKind != JsonValueKind.Object)
                return false;

            if (!current.TryGetProperty(name, out current))
                return true;
        }

        return false;
    }

    private static JsBindingPath Prefixed(JsBindingPath path)
    {
        var prefixed = JsBindingPath.Root.Append(BaseOption);
        foreach (var segment in path)
            prefixed = prefixed.Append(segment);

        return prefixed;
    }
}
