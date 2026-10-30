namespace BlazorECharts.Runtime;

/// <summary>Accounts for independent reference leases within one browser runtime and registry owner.</summary>
/// <remarks>This registry has no scope-wide disposal. A facade releases only its own leases, never shared
/// registrations.</remarks>
internal sealed class ReferenceRegistry
{
    private sealed class Entry(IAsyncDisposable resource, ReferenceOwnership ownership)
    {
        public readonly IAsyncDisposable Resource = resource;
        public readonly ReferenceOwnership Ownership = ownership;
        public int Leases = 1;
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _entries = new(StringComparer.Ordinal);
    private int _leaseCount;

    /// <summary>Creates accounting for a runtime and its unique registry owner.</summary>
    public ReferenceRegistry(string runtimeId, string ownerId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(runtimeId);
        ArgumentException.ThrowIfNullOrWhiteSpace(ownerId);
        RuntimeId = runtimeId;
        OwnerId = ownerId;
    }

    /// <summary>Gets the browser runtime identity.</summary>
    public string RuntimeId { get; }

    /// <summary>Gets the unique registry identity within the runtime.</summary>
    public string OwnerId { get; }

    /// <summary>Gets the number of live entries.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
                return _entries.Count;
        }
    }

    /// <summary>Gets the number of live leases.</summary>
    public int LeaseCount
    {
        get
        {
            lock (_gate)
                return _leaseCount;
        }
    }

    /// <summary>Registers a resource with one initial consumer handle. Borrowed is the default.</summary>
    /// <remarks>Register a native resource once and retain leases for each consumer. The resource may wrap an interop
    /// release operation.</remarks>
    public EChartsObjectReference Register(IAsyncDisposable resource, ReferenceOwnership ownership = ReferenceOwnership.Borrowed)
        => Register(Guid.NewGuid().ToString("N"), resource, ownership);

    /// <summary>Imports a browser registry token with its release adapter, preserving wire identity.</summary>
    /// <remarks>The caller must obtain the token from this runtime and owner. Re-registering a live token is an error.</remarks>
    public EChartsObjectReference Register(string token, IAsyncDisposable resource, ReferenceOwnership ownership = ReferenceOwnership.Borrowed)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(token);
        ArgumentNullException.ThrowIfNull(resource);
        if (!Enum.IsDefined(ownership))
            throw new ArgumentOutOfRangeException(nameof(ownership));

        lock (_gate)
        {
            if (!_entries.TryAdd(token, new Entry(resource, ownership)))
                throw new InvalidOperationException("Reference token is already registered.");

            _leaseCount++;
        }

        return new EChartsObjectReference(new ReferenceLease(this, token));
    }

    /// <summary>Validates all identities before retaining an independent lease. Failed or cancelled acquisition changes
    /// no counts.</summary>
    public ValueTask<ReferenceLease> AcquireAsync(string runtimeId, string ownerId, string token, CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Validate(runtimeId, ownerId, token);
            var lease = new ReferenceLease(this, token);
            _entries[token].Leases++;
            _leaseCount++;
            return ValueTask.FromResult(lease);
        }
    }

    internal void Validate(string runtimeId, string ownerId, string token)
    {
        lock (_gate)
        {
            if (runtimeId != RuntimeId)
                throw new InvalidOperationException("Reference runtime identity mismatch.");

            if (ownerId != OwnerId)
                throw new InvalidOperationException("Reference owner identity mismatch.");

            if (!_entries.ContainsKey(token))
                throw new InvalidOperationException("Unknown or disposed reference token.");
        }
    }

    internal async ValueTask ReleaseAsync(string token)
    {
        Entry entry;
        lock (_gate)
        {
            entry = _entries[token];
            _leaseCount--;
            if (--entry.Leases != 0)
                return;

            _entries.Remove(token);
        }

        if (entry.Ownership == ReferenceOwnership.Owned)
            await entry.Resource.DisposeAsync().ConfigureAwait(false);
    }
}
