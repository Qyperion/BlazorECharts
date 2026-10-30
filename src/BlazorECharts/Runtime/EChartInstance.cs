using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

/// <summary>An owned chart handle.</summary>
/// <remarks>May be called from any thread. Calls on one chart run one at a time, in the order they were made, in the
/// chart's queue;
/// calls on different charts run concurrently. Event handlers run outside the queue.</remarks>
public sealed partial class EChartInstance : IAsyncDisposable
{
    private readonly IChartCommandTransport _transport;
    private readonly EChartsSerializationContext _serialization;
    private readonly object _gate = new();
    private Task? _disposal;
    private Task _readiness = Task.CompletedTask;
    private readonly ChartCommandQueue _commands = new();

    internal ChartRevision AcceptedRevision => _commands.Accepted;

    internal void WaitForReadiness(Task readiness, int generation = 1)
    {
        _readiness = readiness;
        _commands.SetGeneration(generation);
    }

    internal ValueTask SetInitialOptionAsync(ChartOptions options, SetOptionOptions update, CancellationToken cancellationToken) =>
        ApplyAsync(OptionSerializer.Serialize(options, _serialization), update, cancellationToken, initial: true);

    internal ValueTask SetInitialOptionAsync(JsonElement options, SetOptionOptions update, CancellationToken cancellationToken) =>
        ApplyAsync(OptionSerializer.Serialize(options, _serialization), update, cancellationToken, initial: true);

    /// <summary>Creates a handle using the lifecycle owner's command transport and serializer registrations.</summary>
    internal EChartInstance(string id, IChartCommandTransport transport, EChartsSerializationContext serialization)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(serialization);
        Id = id;
        _transport = transport;
        _serialization = serialization;
    }

    /// <summary>Gets the opaque chart identity within its owning facade.</summary>
    public string Id { get; }

    /// <summary>Gets whether disposal has started.</summary>
    public bool IsDisposed
    {
        get
        {
            lock (_gate)
                return _disposal is not null;
        }
    }

    /// <summary>Applies typed options, preserving assigned values and update semantics.</summary>
    public ValueTask SetOptionAsync(ChartOptions options, SetOptionOptions? updateOptions = null, CancellationToken cancellationToken = default)
    {
        EnsureActive();
        return ApplyAsync(OptionSerializer.Serialize(options, _serialization), updateOptions, cancellationToken);
    }

    /// <summary>Applies an owned snapshot of a raw JSON option object.</summary>
    public ValueTask SetOptionAsync(JsonElement options, SetOptionOptions? updateOptions = null, CancellationToken cancellationToken = default)
    {
        EnsureActive();
        return ApplyAsync(OptionSerializer.Serialize(options, _serialization), updateOptions, cancellationToken);
    }

    /// <summary>Reapplies a normalized snapshot, retaining its native values independently of the snapshot lifetime.</summary>
    public async ValueTask SetOptionAsync(
        EChartsOptionSnapshot snapshot,
        SetOptionOptions? updateOptions = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        EnsureActive();
        var prepared = snapshot.Prepare(_serialization);
        var leases = new List<ReferenceLease>();
        SnapshotRetentions? retentions = null;
        try
        {
            foreach (var reference in snapshot.References)
                leases.Add(await reference.AcquireLeaseAsync(_serialization.ReferenceRuntimeId!, cancellationToken).ConfigureAwait(false));

            retentions = new(leases.ToArray());
            await ApplyAsync(prepared, updateOptions, cancellationToken, retentions: retentions).ConfigureAwait(false);
        }
        finally
        {
            if (retentions is not null)
                await retentions.ReleaseBeforeStartAsync().ConfigureAwait(false);
            else
                foreach (var lease in leases)
                    await lease.DisposeAsync().ConfigureAwait(false);
        }
    }

    internal ValueTask SetDeclarativeOptionAsync(ChartOptions? typed, JsonElement? raw, SetOptionOptions update) =>
        ApplyAsync(
            typed is not null ? OptionSerializer.Serialize(typed, _serialization) : OptionSerializer.Serialize(raw!.Value, _serialization),
            update,
            default,
            declarative: true);

    private ValueTask ApplyAsync(
        PreparedOption option,
        SetOptionOptions? update,
        CancellationToken cancellationToken,
        bool initial = false,
        bool declarative = false,
        SnapshotRetentions? retentions = null)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var preparedUpdate = OptionSerializer.Serialize(update ?? new SetOptionOptions(), _serialization);
        if (preparedUpdate.Bindings.Count != 0)
            throw new NotSupportedException("Update options cannot contain bindings.");

        return _commands.Enqueue(async (revision, token) =>
        {
            if (retentions is not null && !retentions.Begin())
                throw new OperationCanceledException();

            try
            {
                if (!initial)
                    await _readiness.WaitAsync(token).ConfigureAwait(false);

                EnsureActive();
                token.ThrowIfCancellationRequested();

                // Once dispatched, keep the slot until transport completion, even when the caller cancels.
                if (_transport is IChartRevisionTransport stamped)
                    await stamped.SetOptionAsync(Id, option, preparedUpdate.Json, revision, CancellationToken.None).ConfigureAwait(false);
                else
                    await _transport.SetOptionAsync(Id, option, preparedUpdate.Json, CancellationToken.None).ConfigureAwait(false);
            }
            finally
            {
                if (retentions is not null)
                    await retentions.ReleaseAfterRunAsync().ConfigureAwait(false);
            }
        }, declarative, update?.NotMerge == true, cancellationToken: cancellationToken);
    }

    private sealed class SnapshotRetentions(ReferenceLease[] leases)
    {
        private int _state;

        internal bool Begin() => Interlocked.CompareExchange(ref _state, 1, 0) == 0;

        internal ValueTask ReleaseBeforeStartAsync() => Interlocked.CompareExchange(ref _state, 2, 0) == 0 ? ReleaseAsync() : ValueTask.CompletedTask;

        internal ValueTask ReleaseAfterRunAsync() => Interlocked.Exchange(ref _state, 2) != 2 ? ReleaseAsync() : ValueTask.CompletedTask;

        private ValueTask ReleaseAsync() => new(Task.WhenAll(leases.Select(l => l.DisposeAsync().AsTask())));
    }

    internal ValueTask ConfigureAsync(JsonElement init, string? theme, bool recreate) => _commands.Enqueue(async (revision, token) =>
    {
        await _readiness.WaitAsync(token).ConfigureAwait(false);
        EnsureActive();
        token.ThrowIfCancellationRequested();
        if (_transport is not IChartRecreationTransport transport)
            throw new NotSupportedException("The transport does not support chart reconfiguration.");

        if (!recreate)
        {
            await transport.SetThemeAsync(Id, theme, revision, CancellationToken.None).ConfigureAwait(false);
            return;
        }

        var epoch = AdvanceEventEpoch();
        try
        {
            await transport.RecreateAsync(Id, init, theme, revision, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception error) when (EChartsError.CodeOf(error) == "ChartContainerNotReady")
        {
            // The browser rejects a hidden container before it changes anything: the current chart and its events stay.
            RestoreEventEpoch(epoch - 1);
            _commands.RevertRecreation(revision.Generation);
            throw;
        }
    }, recreate: recreate);

    internal Task WaitForCommandSlotAsync() => _commands.WaitForSlotAsync();

    internal void FailPendingCommands(Exception cause) => _commands.Fail(cause);

    private void EnsureActive()
    {
        lock (_gate)
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
    }

    // The owning EChart component learns that its handle is going away.
    internal Action? Disposing { get; set; }

    /// <summary>Releases this handle without disposing any other facade or page runtime.</summary>
    /// <remarks>Disposing the handle of an <see cref="EChart"/> component moves that component to
    /// <see cref="ChartState.Failed"/>.</remarks>
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource completion;
        lock (_gate)
        {
            if (_disposal is not null)
                return new(_disposal);

            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _disposal = completion.Task;
        }

        Disposing?.Invoke();
        _ = ReleaseAsync(completion);
        return new(completion.Task);
    }

    private async Task ReleaseAsync(TaskCompletionSource completion)
    {
        _exportLifetime.Cancel();
        _commands.Dispose();
        ChartSubscription[] subscriptions;
        lock (_gate)
        {
            subscriptions = _subscriptions.Values.ToArray();
            foreach (var s in subscriptions)
                s.Deactivate();
        }

        var failures = new List<Exception>();
        foreach (var s in subscriptions)
            try
            {
                await s.DisposeAsync().ConfigureAwait(false);
            }
            catch (Exception error)
            {
                failures.Add(error);
            }

        try
        {
            await _transport.DisposeAsync(Id).ConfigureAwait(false);
        }
        catch (Exception error)
        {
            failures.Add(error);
        }

        _exportReference?.Dispose();
        if (failures.Count != 0)
            completion.SetException(new AggregateException(failures));
        else
            completion.SetResult();
    }
}
