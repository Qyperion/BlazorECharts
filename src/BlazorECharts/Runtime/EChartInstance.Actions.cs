using BlazorECharts.Options;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

public partial class EChartInstance
{
    /// <summary>Dispatches an action through the same ordered queue as setOption and recreation.</summary>
    public ValueTask DispatchActionAsync(ChartAction payload, CancellationToken cancellationToken = default) =>
        DispatchActionAsync(new DispatchActionOptions(payload), cancellationToken);

    /// <summary>Dispatches using the native legacy boolean settings overload.</summary>
    public ValueTask DispatchActionAsync(ChartAction payload, bool silent, CancellationToken cancellationToken = default) =>
        DispatchActionAsync(new DispatchActionOptions(payload) { LegacySilent = silent }, cancellationToken);

    /// <summary>Captures the payload and settings at acceptance and advances the chart revision conservatively for
    /// every action.</summary>
    public ValueTask DispatchActionAsync(DispatchActionOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        var payload = OptionSerializer.Serialize(options.Payload, _serialization);
        var settings = options.PrepareSettings();
        return _commands.Enqueue(async (revision, token) =>
        {
            await _readiness.WaitAsync(token).ConfigureAwait(false);
            EnsureActive();
            token.ThrowIfCancellationRequested();
            if (_transport is not IChartEventTransport transport)
                throw new NotSupportedException("The transport does not support actions.");

            await transport.DispatchBoundActionAsync(Id, payload, settings, revision).ConfigureAwait(false);
        }, cancellationToken: cancellationToken);
    }
}
