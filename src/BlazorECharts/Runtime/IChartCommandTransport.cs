using System.Text.Json;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

/// <summary>The single command seam shared by public instance methods and lifecycle owners.</summary>
internal interface IChartCommandTransport
{
    /// <summary>Applies prepared options to an owned chart.</summary>
    ValueTask SetOptionAsync(string id, PreparedOption option, JsonElement update, CancellationToken cancellationToken);

    /// <summary>Releases an owned chart handle once.</summary>
    ValueTask DisposeAsync(string id);
}
