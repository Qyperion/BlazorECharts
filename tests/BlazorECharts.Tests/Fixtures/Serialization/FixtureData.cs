using System.Text.Json;
using System.Text.Json.Serialization;
using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Tests.Fixtures.Serialization;

internal sealed record FixtureData([property: JsonPropertyName("label")] string Name, decimal Value, DateTimeOffset At);

internal sealed record FixtureWrappedValue(EChartsValue Value);

internal sealed record FixtureWrappedItems(OneOrMany<int> Items);

internal sealed record FixtureWrappedOptions(FixtureNestedOptions Options);

internal sealed record FixtureConvertedValue([property: JsonConverter(typeof(FixtureDynamicValueConverter))] EChartsValue Value);

internal sealed class FixtureDynamicValueConverter : JsonConverter<EChartsValue>
{
    public override EChartsValue Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException();

    public override void Write(Utf8JsonWriter writer, EChartsValue value, JsonSerializerOptions options) =>
        new EChartsSerializationContext().WriteValue(writer, value, "$");
}

internal sealed class FixtureDataArrayConverter : JsonConverter<FixtureData[]>
{
    public override FixtureData[] Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException();

    public override void Write(Utf8JsonWriter writer, FixtureData[] value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        foreach (var row in value)
            writer.WriteStringValue(row.Name);

        writer.WriteEndArray();
    }
}

// ECharts 6.1.0 util/types.d.ts: OptionSourceHeader = boolean | 'auto' | number.
[JsonConverter(typeof(FixtureHeaderConverter))]
internal readonly record struct FixtureHeader(object? Value);

internal sealed class FixtureHeaderConverter : JsonConverter<FixtureHeader>
{
    public override FixtureHeader Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException();

    public override void Write(Utf8JsonWriter writer, FixtureHeader value, JsonSerializerOptions options)
    {
        switch (value.Value)
        {
            case bool flag:
                writer.WriteBooleanValue(flag);
                break;
            case int number:
                writer.WriteNumberValue(number);
                break;
            case "auto":
                writer.WriteStringValue("auto");
                break;
            default:
                throw new JsonException("Expected boolean, number or literal 'auto'.");
        }
    }
}

// ECharts 6.1.0 util/types.d.ts: tooltip formatter point: [number, number].
// The transport fixture deliberately uses different numbers to expose order/arity loss.
[JsonConverter(typeof(FixtureRangeConverter))]
internal readonly record struct FixtureRange(decimal Start, decimal End);

internal sealed class FixtureRangeConverter : JsonConverter<FixtureRange>
{
    public override FixtureRange Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException();

    public override void Write(Utf8JsonWriter writer, FixtureRange value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(value.Start);
        writer.WriteNumberValue(value.End);
        writer.WriteEndArray();
    }
}
