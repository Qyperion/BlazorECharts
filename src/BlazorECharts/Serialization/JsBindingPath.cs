using System.Collections;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlazorECharts.Serialization;

/// <summary>An immutable path of exact property names and numeric array indexes, never executable text.</summary>
[JsonConverter(typeof(JsBindingPathConverter))]
public sealed class JsBindingPath : IReadOnlyList<object>
{
    private readonly object[] _segments;

    internal static JsBindingPath Root { get; } = new([]);

    private JsBindingPath(object[] segments) => _segments = segments;

    internal JsBindingPath Append(object segment) => new([.. _segments, segment]);

    internal static JsBindingPath From(List<PathSegment> segments)
    {
        var values = new object[segments.Count];
        for (var i = 0; i < values.Length; i++)
            values[i] = (object?)segments[i].Name ?? segments[i].Index;

        return new(values);
    }

    /// <summary>Gets the number of path segments.</summary>
    public int Count => _segments.Length;

    /// <summary>Gets a string property name or an int array index.</summary>
    public object this[int index] => _segments[index];

    /// <summary>Enumerates immutable path segments.</summary>
    public IEnumerator<object> GetEnumerator() => ((IEnumerable<object>)_segments).GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

// One property name or array index on the serializer's current path.
internal readonly record struct PathSegment(string? Name, int Index);

/// <summary>Writes structured binding paths without reflection or string path parsing.</summary>
internal sealed class JsBindingPathConverter : JsonConverter<JsBindingPath>
{
    /// <summary>Binding paths are produced by OptionSerializer; transport deserialization is unsupported.</summary>
    public override JsBindingPath Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException("Binding paths are output-only; validate incoming wire paths in the browser runtime.");

    /// <summary>Writes names as strings and indexes as JSON numbers.</summary>
    public override void Write(Utf8JsonWriter writer, JsBindingPath value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        foreach (var segment in value)
            if (segment is string property)
                writer.WriteStringValue(property);
            else
                writer.WriteNumberValue((int)segment);

        writer.WriteEndArray();
    }
}
