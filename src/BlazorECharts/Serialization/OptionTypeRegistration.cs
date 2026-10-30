using System.Text.Json;

namespace BlazorECharts.Serialization;

/// <summary>Registers an exact option type without reflection or a closed polymorphic type list.</summary>
/// <param name="writeProperties">Writes typed properties using WriteProperty. Object delimiters and additional fields
/// are owned by the context.</param>
/// <param name="read">Optionally reads the model back from JSON, for example from a normalized getOption snapshot.</param>
/// <typeparam name="T">The concrete option model, including models supplied by extensions.</typeparam>
public sealed class OptionTypeRegistration<T>(
    Action<Utf8JsonWriter, T, EChartsSerializationContext, string> writeProperties,
    Func<JsonElement, EChartsSerializationContext, T>? read = null) where T : OptionObject
{
    internal Action<Utf8JsonWriter, T, EChartsSerializationContext, string> WriteProperties { get; } =
        writeProperties ?? throw new ArgumentNullException(nameof(writeProperties));

    internal Func<JsonElement, EChartsSerializationContext, T>? Read { get; } = read;
}
