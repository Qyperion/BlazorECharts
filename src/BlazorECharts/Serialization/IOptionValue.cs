using System.Text.Json;

namespace BlazorECharts.Serialization;

/// <summary>Writes an explicit extension value through the option serializer, including nested bindings.</summary>
/// <remarks>Use context.WriteValue/WriteProperty/WriteArrayItem to preserve binding paths and inline/reference policy.</remarks>
public interface IOptionValue
{
    /// <summary>Writes this value at the current structured binding path.</summary>
    void Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path);
}

// A value that may hold a plain scalar: the serializer writes it without building the child path.
internal interface IScalarOptionValue
{
    bool TryWriteScalar(Utf8JsonWriter writer, EChartsSerializationContext context);
}
