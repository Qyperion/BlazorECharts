using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

// Internal operations on the same transport/handle. Public getOption belongs to the snapshot reader.
internal interface IChartRecreationTransport
{
    ValueTask SetThemeAsync(string id, string? theme, ChartRevision revision, CancellationToken cancellationToken);

    ValueTask RecreateAsync(string id, JsonElement init, string? theme, ChartRevision revision, CancellationToken cancellationToken);
}

internal interface IChartRevisionTransport
{
    ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, ChartRevision revision, CancellationToken cancellationToken);
}
