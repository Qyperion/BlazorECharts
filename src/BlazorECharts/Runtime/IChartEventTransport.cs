using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

internal interface IChartEventTransport
{
    ValueTask SubscribeAsync(string id, ChartSubscription subscription, string name, JsonElement query);

    ValueTask UnsubscribeAsync(string id, string subscription);

    ValueTask DispatchActionAsync(string id, JsonElement payload, JsonElement settings, ChartRevision revision);

    ValueTask DispatchBoundActionAsync(string id, PreparedOption payload, JsonElement settings, ChartRevision revision) =>
        payload.Bindings.Count == 0
            ? DispatchActionAsync(id, payload.Json, settings, revision)
            : throw new NotSupportedException("This transport cannot hydrate action bindings.");
}
