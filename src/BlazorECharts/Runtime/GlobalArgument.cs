using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
namespace BlazorECharts.Runtime;

/// <summary>Method-local wire support; ordinary option JSON does not use these sentinels.</summary>
internal sealed class GlobalArgument(object? value, bool omitted = false) : IOptionValue
{
    internal bool IsOmitted => omitted;
    private object? Value => value;

    internal static object Optional(object? value) => new GlobalArgument(value, value is null);

    internal static JsonElement Json(object? value, EChartsSerializationContext? context = null) =>
        MethodJson.Create(w => Write(w, value, context ?? new EChartsSerializationContext(), "$"));

    internal static void Validate(JsonElement value, Func<JsonElement, bool> predicate)
    {
        if (!predicate(value))
            throw new ArgumentException("Value does not match the source global helper contract.");
    }

    internal static JsonElement Tail(JsonElement args, int start) => MethodJson.Create(w =>
    {
        w.WriteStartArray();
        foreach (var item in args.EnumerateArray().Skip(start))
            item.WriteTo(w);

        w.WriteEndArray();
    });

    internal static bool TryGetNumber(object? value, out double number)
    {
        switch (value)
        {
            case double d:
                number = d;
                return true;
            case float f:
                number = f;
                return true;
            case EChartsValue dynamic:
                return TryGetNumber(dynamic.RawValue, out number);
            case GlobalArgument argument when !argument.IsOmitted:
                return TryGetNumber(argument.Value, out number);
            default:
                number = default;
                return false;
        }
    }

    internal static void Write(Utf8JsonWriter w, object? value, EChartsSerializationContext context, string path)
    {
        switch (value)
        {
            case double number:
                MethodJson.WriteNumber(w, number);
                break;
            case float number:
                MethodJson.WriteNumber(w, number);
                break;
            case EChartsValue dynamic when TryGetNumber(dynamic, out var number):
                MethodJson.WriteNumber(w, number);
                break;
            case DateTimeOffset date:
                w.WriteStringValue(EChartsDate.Format(date));
                break;
            case DateOnly date:
                w.WriteStringValue(EChartsDate.Format(date));
                break;
            case Array array:
                w.WriteStartArray();
                foreach (var item in array)
                    Write(w, item, context, path);

                w.WriteEndArray();
                break;
            default:
                context.WriteValue(w, value, path);
                break;
        }
    }

    void IOptionValue.Write(Utf8JsonWriter w, EChartsSerializationContext context, string path)
    {
        if (omitted)
            w.WriteNullValue();
        else
            Write(w, value, context, path);
    }
}
