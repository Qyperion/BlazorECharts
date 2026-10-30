using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Values;

/// <summary>A generated union or tuple that an extension model reads from JSON, such as a getOption snapshot.</summary>
/// <remarks>
/// The members are implemented explicitly. An extension reader calls them through a generic constraint,
/// for example <c>static T ReadValue&lt;T&gt;(JsonElement json) where T : struct, IReadableOptionValue&lt;T&gt; =&gt;
/// T.Read(json);</c>.
/// Nested option models are read with <see cref="EChartsSerializationContext.Read{T}(JsonElement)"/>.
/// </remarks>
/// <typeparam name="TSelf">The value type itself.</typeparam>
public interface IReadableOptionValue<TSelf> : IOptionValue where TSelf : struct, IReadableOptionValue<TSelf>
{
    /// <summary>Gets whether the JSON is one of the alternatives.</summary>
    static abstract bool Matches(JsonElement json);

    /// <summary>Reads the JSON; <c>TryGet</c> decodes an alternative from it.</summary>
    /// <exception cref="JsonException">The JSON is none of the alternatives.</exception>
    static abstract TSelf Read(JsonElement json);
}
