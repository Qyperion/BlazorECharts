using System.Text.Json;

namespace BlazorECharts.Options;

/// <summary>An action plus the native dispatchAction object or legacy boolean settings overload.</summary>
public sealed class DispatchActionOptions(ChartAction payload)
{
    /// <summary>Gets the action payload.</summary>
    public ChartAction Payload { get; } = payload ?? throw new ArgumentNullException(nameof(payload));

    /// <summary>Gets or sets event suppression in the object settings overload.</summary>
    public bool? Silent { get; set; }

    /// <summary>Gets or sets the native flush preference.</summary>
    public bool? Flush { get; set; }

    /// <summary>Gets or sets the legacy boolean overload. Cannot be combined with object settings.</summary>
    public bool? LegacySilent { get; set; }

    internal JsonElement PrepareSettings()
    {
        if (LegacySilent.HasValue && (Silent.HasValue || Flush.HasValue))
            throw new ArgumentException("LegacySilent cannot be combined with Silent/Flush.");

        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            if (LegacySilent.HasValue)
                writer.WriteBooleanValue(LegacySilent.Value);
            else
            {
                writer.WriteStartObject();
                if (Silent.HasValue)
                    writer.WriteBoolean("silent", Silent.Value);

                if (Flush.HasValue)
                    writer.WriteBoolean("flush", Flush.Value);

                writer.WriteEndObject();
            }
        }

        using var json = JsonDocument.Parse(stream.ToArray());
        return json.RootElement.Clone();
    }
}
