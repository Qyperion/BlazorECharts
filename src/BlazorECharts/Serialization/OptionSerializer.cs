using System.Text.Json;

namespace BlazorECharts.Serialization;

/// <summary>Prepares an owned JSON snapshot without executing strings or interpreting descriptor-like keys.</summary>
public static class OptionSerializer
{
    /// <summary>Serializes assigned typed properties and additional fields using explicit registrations.</summary>
    public static PreparedOption Serialize(OptionObject options, EChartsSerializationContext context)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(context);
        var preparation = context.CreatePreparation();
        using var buffer = new PooledBufferWriter();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { MaxDepth = 64, Encoder = PreparedOption.TransportEncoder }))
            preparation.WriteValue(writer, options, "$");

        context.Statistics.Record(options.GetType(), buffer.WrittenCount);
        return new PreparedOption(buffer.WrittenSpan.ToArray(), preparation.Bindings);
    }

    /// <summary>Clones a raw JSON object, preserving unknown fields and its JSON value shapes.</summary>
    public static PreparedOption Serialize(JsonElement raw, EChartsSerializationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (raw.ValueKind != JsonValueKind.Object)
            throw new OptionSerializationException("Raw options must be a JSON object at $.", "$", typeof(JsonElement));

        context.Statistics.Record(typeof(JsonElement), 0);
        return new PreparedOption(raw);
    }
}
