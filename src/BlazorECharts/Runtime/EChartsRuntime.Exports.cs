using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

public partial class EChartsRuntime : IChartExportTransport
{
    async ValueTask<JsonElement> IChartExportTransport.InvokeExportAsync(
        string id,
        string method,
        PreparedOption arguments,
        double timeout,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null || !_instances.ContainsKey(id), this);
            _methodUses++;
        }

        var operation = Guid.NewGuid().ToString("N");
        var transferred = false;
        try
        {
            var prepared = JsonSerializer.SerializeToElement(arguments, EChartsTransportJsonContext.Default.PreparedOption);
            var pending = WithReplyTimeoutAsync(
                method,
                _module!.InvokeAsync<JsonElement>("exportChart", _ownerId, id, operation, method, prepared, timeout));
            using var registration = cancellationToken.Register(() => { _ = CancelAsync(); });

            var envelope = await pending.ConfigureAwait(false);
            transferred = true;
            await TrackResultAsync(envelope).ConfigureAwait(false);
            return envelope;
        }
        finally
        {
            if (!transferred)
                await EndMethodUseAsync().ConfigureAwait(false);
        }

        async Task CancelAsync()
        {
            try
            {
                await _module!.InvokeVoidAsync("cancelExport", _ownerId, operation).ConfigureAwait(false);
            }
            catch (JSDisconnectedException)
            {
            }
            catch (ObjectDisposedException)
            {
            }
            catch (JSException)
            {
            }
        }
    }
}
