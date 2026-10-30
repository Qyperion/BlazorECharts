using System.Text.Json.Serialization;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

/// <summary>An explicit native browser reference with an initial consumer lease.</summary>
/// <remarks>Chart and snapshot consumers acquire independent leases. Preparing JSON does not retain a lease.</remarks>
public sealed class EChartsObjectReference : IAsyncDisposable, IJsonOnSerializing
{
    private readonly ReferenceLease _lease;

    internal EChartsObjectReference(ReferenceLease lease) => _lease = lease;

    /// <summary>Gets the browser runtime identity.</summary>
    public string RuntimeId => _lease.RuntimeId;

    /// <summary>Gets the registry identity.</summary>
    public string OwnerId => _lease.OwnerId;

    /// <summary>Gets the opaque registry token.</summary>
    public string Token => _lease.Token;

    /// <summary>Gets whether this handle has begun disposal.</summary>
    public bool IsDisposed => _lease.IsDisposed;

    /// <summary>Validates the target runtime and retains an independent chart or snapshot lease.</summary>
    public ValueTask<ReferenceLease> AcquireLeaseAsync(string runtimeId, CancellationToken cancellationToken = default)
    {
        _lease.Validate(runtimeId);
        return _lease.RetainAsync(cancellationToken);
    }

    internal void Validate(string? runtimeId)
    {
        if (string.IsNullOrWhiteSpace(runtimeId))
            throw new InvalidOperationException("Set ReferenceRuntimeId before preparing native object bindings.");

        _lease.Validate(runtimeId);
    }

    /// <summary>Releases only the initial consumer lease.</summary>
    public ValueTask DisposeAsync() => _lease.DisposeAsync();

    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(GetType());
}
