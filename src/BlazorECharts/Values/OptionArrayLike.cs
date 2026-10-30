using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>An upstream ArrayLike value, supplied as managed elements or an explicit browser reference.</summary>
public readonly struct OptionArrayLike<T> : IOptionValue, IJsonOnSerializing
{
    private readonly object? _value;

    private OptionArrayLike(object value) => _value = value;

    /// <summary>Creates a JSON array without collapsing its shape.</summary>
    public static OptionArrayLike<T> From(T[] values) => new(values ?? throw new ArgumentNullException(nameof(values)));

    /// <summary>Uses a browser ArrayLike object, such as Float64Array, through the existing binding lease.</summary>
    public static OptionArrayLike<T> From(EChartsObjectReference reference) => new(reference ?? throw new ArgumentNullException(nameof(reference)));

    /// <summary>Gets the managed elements, including elements read from JSON.</summary>
    public bool TryGetValues([NotNullWhen(true)] out IReadOnlyList<T>? values)
    {
        values = _value is T[] items ? Array.AsReadOnly(items) : null;
        return values is not null;
    }

    /// <summary>Gets the browser ArrayLike reference.</summary>
    public bool TryGetReference([NotNullWhen(true)] out EChartsObjectReference? reference)
    {
        reference = _value as EChartsObjectReference;
        return reference is not null;
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        if (_value is null)
            throw new OptionSerializationException("Uninitialized ArrayLike value.", path, typeof(OptionArrayLike<T>));

        context.WriteValue(writer, _value, path);
    }

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(typeof(OptionArrayLike<T>));
}
