namespace BlazorECharts.Serialization;

/// <summary>Reports an invalid option value or missing registration at a public JSON path.</summary>
public sealed class OptionSerializationException(string message, string path, Type? clrType = null, Exception? innerException = null)
    : Exception(message, innerException)
{
    /// <summary>Gets the JSON path, starting at $ and using array indices and escaped property names.</summary>
    public string Path { get; } = path;

    /// <summary>Gets the offending CLR type, when available.</summary>
    public Type? ClrType { get; } = clrType;
}
