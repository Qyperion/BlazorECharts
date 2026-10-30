using System.Text.Json;
using BlazorECharts.Serialization;
namespace BlazorECharts.Runtime;

internal interface IChartExportTransport
{
    ValueTask<JsonElement> InvokeExportAsync(string id, string method, PreparedOption arguments, double timeout, CancellationToken cancellationToken);
}
