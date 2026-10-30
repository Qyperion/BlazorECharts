using System.Text.Json.Serialization;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>A schema-derived browser function signature, not a .NET delegate.</summary>
public interface IJsFunctionSignature
{
    /// <summary>Gets the stable schema signature identifier.</summary>
    static abstract string Id { get; }
}

/// <summary>An explicit immutable JavaScript function descriptor. Preparation never executes it.</summary>
public abstract class JsFunction : IJsonOnSerializing
{
    private protected JsFunction(JsBindingKind kind, string signature, string? moduleUrl, string? exportName, string? source)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(signature);
        Kind = kind;
        Signature = signature;
        ModuleUrl = moduleUrl;
        ExportName = exportName;
        Source = source;
    }

    /// <summary>Creates a module-export descriptor for a generated signature marker.</summary>
    public static JsFunction<TSignature> Module<TSignature>(string moduleUrl, string exportName) where TSignature : IJsFunctionSignature
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(moduleUrl);
        ArgumentException.ThrowIfNullOrWhiteSpace(exportName);
        return new(JsBindingKind.Module, moduleUrl, exportName, null);
    }

    /// <summary>Creates an inline descriptor. Serialization requires AllowInlineJavaScript=true.</summary>
    public static JsFunction<TSignature> Inline<TSignature>(string source) where TSignature : IJsFunctionSignature
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        return new(JsBindingKind.Inline, null, null, source);
    }

    /// <summary>Reconstructs a typed module or inline descriptor from an explicit prepared binding.</summary>
    /// <remarks>The signature must match exactly. Inline serialization still requires opt-in.
    /// Native object bindings retain their own reference ownership and are rejected.</remarks>
    public static JsFunction<TSignature> FromBinding<TSignature>(JsBinding binding) where TSignature : IJsFunctionSignature
    {
        ArgumentNullException.ThrowIfNull(binding);
        if (binding.Kind is not (JsBindingKind.Module or JsBindingKind.Inline))
            throw new ArgumentException("Expected an explicit module or inline function binding.", nameof(binding));

        if (!string.Equals(binding.Signature, TSignature.Id, StringComparison.Ordinal))
            throw new ArgumentException("The function binding has a different signature.", nameof(binding));

        return binding.Kind == JsBindingKind.Module
            ? Module<TSignature>(binding.ModuleUrl!, binding.ExportName!)
            : Inline<TSignature>(binding.Source!);
    }

    /// <summary>Gets the explicit descriptor kind.</summary>
    public JsBindingKind Kind { get; }

    /// <summary>Gets the stable signature identifier.</summary>
    public string Signature { get; }

    /// <summary>Gets the module URL for a module binding.</summary>
    public string? ModuleUrl { get; }

    /// <summary>Gets the module export name.</summary>
    public string? ExportName { get; }

    /// <summary>Gets explicit inline source. This value is never inferred from ordinary strings.</summary>
    public string? Source { get; }

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(GetType());
}

/// <summary>A JavaScript descriptor constrained to a schema signature.</summary>
public sealed class JsFunction<TSignature> : JsFunction where TSignature : IJsFunctionSignature
{
    internal JsFunction(JsBindingKind kind, string? moduleUrl, string? exportName, string? source)
        : base(kind, TSignature.Id, moduleUrl, exportName, source) { }
}
