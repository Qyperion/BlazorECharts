using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>A scalar or an explicit array. A one-element array retains its array shape.</summary>
/// <remarks>A value converts to <see cref="One"/>, an array or a collection expression to <see cref="Many"/>.
/// The default struct value is uninitialized and cannot be serialized.</remarks>
[CollectionBuilder(typeof(OneOrMany), nameof(OneOrMany.Create))]
public readonly struct OneOrMany<T> : IOptionValue, IJsonOnSerializing
{
    private readonly byte _shape;

    // Write is reached only through IOptionValue, so WebAssembly AOT compiles it as shared generic code, where
    // passing a Nullable<T> by value faults ("null function"). The scalar is boxed here and items are read through Array.
    private readonly object? _one;

    private readonly T[]? _many;

    private OneOrMany(T value)
    {
        _shape = 1;
        _one = value;
    }

    private OneOrMany(T[] values)
    {
        _shape = 2;
        _many = values;
    }

    /// <summary>Creates a scalar alternative, including a null scalar if T permits it.</summary>
    public static OneOrMany<T> One(T value) => new(value);

    /// <summary>Creates an array alternative, copying its container and preserving order, nulls and empty arrays.</summary>
    public static OneOrMany<T> Many(params T[] values)
    {
        ArgumentNullException.ThrowIfNull(values);
        return new((T[])values.Clone());
    }

    internal static OneOrMany<T> FromSpan(ReadOnlySpan<T> values) => new(values.ToArray());

    /// <summary>Converts a value to the scalar alternative, as <see cref="One"/> does.</summary>
    public static implicit operator OneOrMany<T>(T value) => new(value);

    /// <summary>Converts an array to the array alternative, as <see cref="Many"/> does.</summary>
    public static implicit operator OneOrMany<T>(T[] values) => Many(values);

    /// <summary>Gets whether this value is the array alternative, including a value read from JSON.</summary>
    public bool IsMany => _shape == 2;

    /// <summary>Gets the scalar alternative. Returns false for an array or an uninitialized value.</summary>
    public bool TryGetOne([MaybeNullWhen(false)] out T value)
    {
        if (_shape == 1)
        {
            value = (T)_one!;
            return true;
        }

        value = default;
        return false;
    }

    /// <summary>Gets the array elements, or the scalar as a single item. Throws for an uninitialized value.</summary>
    public IReadOnlyList<T> Items => _shape switch
    {
        1 => Array.AsReadOnly<T>([(T)_one!]),
        2 => Array.AsReadOnly(_many!),
        _ => throw new InvalidOperationException("Uninitialized OneOrMany; it holds neither One nor Many."),
    };

    /// <summary>Enumerates <see cref="Items"/>.</summary>
    public IEnumerator<T> GetEnumerator() => Items.GetEnumerator();

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        switch (_shape)
        {
            case 1:
                context.WriteValue(writer, _one, path);
                break;
            case 2:
                Array items = _many!;
                writer.WriteStartArray();
                for (var i = 0; i < items.Length; i++)
                    context.WriteArrayItem(writer, items.GetValue(i), path, i);

                writer.WriteEndArray();
                break;
            default:
                throw new OptionSerializationException($"Uninitialized OneOrMany at {path}; select One or Many.", path, typeof(OneOrMany<T>));
        }
    }

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(typeof(OneOrMany<T>));
}

/// <summary>Builds <see cref="OneOrMany{T}"/> values from collection expressions.</summary>
public static class OneOrMany
{
    /// <summary>Creates the array alternative of a collection expression, also for one or no element.</summary>
    public static OneOrMany<T> Create<T>(ReadOnlySpan<T> values) => OneOrMany<T>.FromSpan(values);
}
