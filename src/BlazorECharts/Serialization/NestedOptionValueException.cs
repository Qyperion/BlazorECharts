using System.Text.Json;

namespace BlazorECharts.Serialization;

// Preserve the rejected CLR type while STJ supplies its native diagnostic, if available.
internal sealed class NestedOptionValueException(Type clrType)
    : JsonException($"CLR type '{clrType.FullName}' needs an explicit JSON converter when nested in custom CLR data; use transport option writers or supply a converter in JsonTypeInfo metadata.")
{
    public Type ClrType { get; } = clrType;
}
