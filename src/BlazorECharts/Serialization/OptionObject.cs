using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Serialization;

/// <summary>Base class for mutable options with explicit property presence.</summary>
/// <remarks>Generated setters must call SetProperty with the exact upstream JSON name, even for default values.</remarks>
public abstract class OptionObject : IJsonOnSerializing
{
    private readonly HashSet<string> _assigned = new(StringComparer.Ordinal);
    private Dictionary<string, Exception>? _readErrors;

    /// <summary>Gets additional JSON fields. An assigned typed field with the same name is an error.</summary>
    public IDictionary<string, EChartsValue> AdditionalProperties { get; } = new Dictionary<string, EChartsValue>(StringComparer.Ordinal);

    /// <summary>Returns whether a setter has assigned the exact, case-sensitive JSON name.</summary>
    public bool IsAssigned(string jsonName) => _assigned.Contains(jsonName);

    /// <summary>Stores a value and marks its JSON property as assigned, including null and default values.</summary>
    protected void SetProperty<T>(ref T field, T value, string jsonName)
    {
        ArgumentNullException.ThrowIfNull(jsonName);
        field = value;
        _assigned.Add(jsonName);
        _readErrors?.Remove(jsonName);
    }

    /// <summary>Returns a field of a nested event payload, or throws the error of reading it: one malformed field does
    /// not hide the others.</summary>
    internal T Readable<T>(T value, string jsonName) => _readErrors is { } errors && errors.TryGetValue(jsonName, out var error)
        ? throw new JsonException($"Cannot read the payload field {jsonName}: {error.Message}", error) : value;

    internal void DeferReadError(string jsonName, Exception error) => (_readErrors ??= new(StringComparer.Ordinal))[jsonName] = error;

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(GetType());
}
