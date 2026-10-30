using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

// A union value read from JSON. The first reference-type alternative that TryGet decodes is kept and written
// instead of the JSON, so edits to it reach the next serialization; copies of the union share it.
// The JSON is held inline: a large snapshot keeps one object per value, not a box besides it.
internal sealed class ReadValue(JsonElement json) : IOptionValue, IScalarOptionValue
{
    private object? _decoded;

    // Clone returns the element itself when its document is already owned, such as a snapshot cloned once on entry.
    private readonly JsonElement _json = json.Clone();

    internal object? Decoded => _decoded;
    internal object Current => _decoded ?? EChartsValue.FromJson(_json);

    internal static bool TryGetJson(object? value, out JsonElement json)
    {
        switch (value)
        {
            case ReadValue read:
                json = read._json;
                return true;
            case EChartsValue raw:
                return raw.TryGetJson(out json);
            default:
                json = default;
                return false;
        }
    }

    internal T Materialize<T>(T decoded) where T : class
    {
        var cached = Interlocked.CompareExchange(ref _decoded, decoded, null);
        return cached as T ?? decoded;
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        if (_decoded is { } decoded)
            context.WriteValue(writer, decoded, path);
        else
            _json.WriteTo(writer);
    }

    bool IScalarOptionValue.TryWriteScalar(Utf8JsonWriter writer, EChartsSerializationContext context)
    {
        if (_decoded is { } decoded)
            return context.TryWriteScalar(writer, decoded);

        if (_json.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            return false;

        _json.WriteTo(writer);
        return true;
    }
}
