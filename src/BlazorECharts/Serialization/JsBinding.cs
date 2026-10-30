using System.Text.Json.Serialization;
using BlazorECharts.Runtime;
using BlazorECharts.Values;

namespace BlazorECharts.Serialization;

/// <summary>The explicit operation described by a separate binding.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<JsBindingKind>))]
public enum JsBindingKind
{
    /// <summary>A browser module export.</summary>
    [JsonStringEnumMemberName("module")] Module,

    /// <summary>Opt-in inline JavaScript.</summary>
    [JsonStringEnumMemberName("inline")] Inline,

    /// <summary>A native object retained by its runtime registry.</summary>
    [JsonStringEnumMemberName("object")] Object,
}

/// <summary>An immutable separate transport descriptor targeting a null JSON placeholder.</summary>
public sealed class JsBinding
{
    internal JsBinding(JsBindingPath path, string token, JsFunction function)
    {
        Path = path;
        Token = token;
        Kind = function.Kind;
        Signature = function.Signature;
        ModuleUrl = function.ModuleUrl;
        ExportName = function.ExportName;
        Source = function.Source;
    }

    internal JsBinding(JsBindingPath path, EChartsObjectReference reference)
    {
        Path = path;
        Kind = JsBindingKind.Object;
        Token = reference.Token;
        RuntimeId = reference.RuntimeId;
        OwnerId = reference.OwnerId;
    }

    /// <summary>Gets the exact structured JSON path.</summary>
    [JsonPropertyName("path")] public JsBindingPath Path { get; }

    /// <summary>Gets the descriptor kind.</summary>
    [JsonPropertyName("kind")] public JsBindingKind Kind { get; }

    /// <summary>Gets a payload-local function token or a registry object token.</summary>
    [JsonPropertyName("token")] public string Token { get; }

    /// <summary>Gets the stable signature ID for a function.</summary>
    [JsonPropertyName("signature"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Signature { get; }

    /// <summary>Gets the module URL.</summary>
    [JsonPropertyName("moduleUrl"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? ModuleUrl { get; }

    /// <summary>Gets the export name.</summary>
    [JsonPropertyName("exportName"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? ExportName { get; }

    /// <summary>Gets explicit inline source.</summary>
    [JsonPropertyName("source"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Source { get; }

    /// <summary>Gets the browser runtime identity for an object reference.</summary>
    [JsonPropertyName("runtimeId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? RuntimeId { get; }

    /// <summary>Gets the registry owner identity for an object reference.</summary>
    [JsonPropertyName("ownerId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? OwnerId { get; }
}
