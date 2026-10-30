using System.Buffers;
using System.Runtime.CompilerServices;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlazorECharts.Serialization;

/// <summary>An immutable JSON snapshot prepared for transport to ECharts.</summary>
public sealed class PreparedOption
{
    private byte[]? _utf8;
    private StrongBox<JsonElement>? _json;

    internal PreparedOption(JsonElement json, IEnumerable<JsBinding>? bindings = null)
    {
        _json = new(json.Clone());
        Bindings = Array.AsReadOnly(bindings?.ToArray() ?? []);
    }

    internal PreparedOption(byte[] utf8, IEnumerable<JsBinding>? bindings)
    {
        _utf8 = utf8;
        Bindings = Array.AsReadOnly(bindings?.ToArray() ?? []);
    }

    /// <summary>Gets JSON owned by this snapshot, independent of input documents and subsequent option mutations.</summary>
    /// <remarks>Its text uses the default HTML-safe escaping of System.Text.Json, also for non-ASCII text.</remarks>
    [JsonPropertyName("json")]
    public JsonElement Json
    {
        get
        {
            var json = Volatile.Read(ref _json);
            if (json is null)
            {
                json = new(ParseEscaped(_utf8!));
                json = Interlocked.CompareExchange(ref _json, json, null) ?? json;
            }

            return json.Value;
        }
    }

    // The transport bytes reach only TextDecoder and JSON.parse, never HTML: JSON escaping alone keeps them exact,
    // and Cyrillic, CJK and HTML characters of templates stay 2-6 times smaller than escaped.
    internal static readonly JavaScriptEncoder TransportEncoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping;

    private static readonly SearchValues<byte> Unescaped = SearchValues.Create(
        [(byte)'\\', .. "<>&'+`"u8, .. Enumerable.Range(0x80, 0x80).Select(b => (byte)b)]);

    // Json keeps the default HTML-safe escaping of its text, whatever the transport bytes leave unescaped.
    private static JsonElement ParseEscaped(byte[] utf8)
    {
        var reader = new Utf8JsonReader(utf8);
        var json = JsonElement.ParseValue(ref reader);
        if (utf8.AsSpan().IndexOfAny(Unescaped) < 0)
            return json;

        using var buffer = new PooledBufferWriter();
        using (var writer = new Utf8JsonWriter(buffer))
            json.WriteTo(writer);

        var escaped = new Utf8JsonReader(buffer.WrittenSpan);
        return JsonElement.ParseValue(ref escaped);
    }

    /// <summary>Gets immutable descriptors targeting null placeholders in Json. This snapshot owns no reference leases.</summary>
    [JsonPropertyName("bindings")] public IReadOnlyList<JsBinding> Bindings { get; }

    // The transport sends these bytes as one binary argument: Blazor does not run its JSON reviver over them.
    internal byte[] Utf8
    {
        get
        {
            if (Volatile.Read(ref _utf8) is { } utf8)
                return utf8;

            using var buffer = new PooledBufferWriter();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Encoder = TransportEncoder }))
                Json.WriteTo(writer);

            return Interlocked.CompareExchange(ref _utf8, buffer.WrittenSpan.ToArray(), null) ?? _utf8!;
        }
    }
}
