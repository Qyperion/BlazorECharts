using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

internal interface IChartMethodTransport
{
    ValueTask<JsonElement> InvokeMethodAsync(string id, string method, JsonElement arguments, ChartRevision revision);

    ValueTask<EChartsOptionSnapshot> ReadSnapshotAsync(JsonElement envelope, EChartsSerializationContext context);

    ValueTask<EChartsObjectReference> ReadReferenceAsync(JsonElement envelope);

    ValueTask<ChartVisual> ReadVisualAsync(JsonElement envelope);

    ValueTask ReleaseResultAsync(JsonElement envelope);
}
