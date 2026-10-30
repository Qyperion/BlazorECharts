using System.Runtime.CompilerServices;
using System.Text.Json;

namespace BlazorECharts.Serialization;

// Each reader level prepends its property or index, so the top-level reader reports the full JSON path.
internal static class OptionReadError
{
    private static readonly ConditionalWeakTable<JsonException, Located> s_located = [];

    internal static bool Is(Exception error) =>
        error is JsonException or FormatException or KeyNotFoundException or ArgumentException or OverflowException
        || error is InvalidOperationException and not ObjectDisposedException;

    internal static JsonException AtProperty(string name, Exception error) => At(EChartsSerializationContext.PropertyPath("", name), error);

    internal static JsonException AtIndex(int index, Exception error) => At(EChartsSerializationContext.IndexPath("", index), error);

    private static JsonException At(string segment, Exception error)
    {
        var located = error is JsonException json && s_located.TryGetValue(json, out var inner)
            ? new Located(segment + inner.RelativePath, inner.Reason, inner.Cause)
            : new Located(segment, error.Message, error);
        var result = new JsonException(
            $"Cannot read the option at ${located.RelativePath}: {located.Reason}",
            "$" + located.RelativePath,
            null,
            null,
            located.Cause);
        s_located.Add(result, located);
        return result;
    }

    private sealed record Located(string RelativePath, string Reason, Exception Cause);
}
