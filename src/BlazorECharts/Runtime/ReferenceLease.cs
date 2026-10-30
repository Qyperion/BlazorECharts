namespace BlazorECharts.Runtime;

/// <summary>An independently retained native reference. Repeated disposal observes the same release operation.</summary>
public sealed class ReferenceLease : IAsyncDisposable
{
    private readonly ReferenceRegistry _registry;
    private readonly object _gate = new();
    private Task? _release;

    internal ReferenceLease(ReferenceRegistry registry, string token)
    {
        _registry = registry;
        Token = token;
    }

    /// <summary>Gets the browser runtime identity.</summary>
    public string RuntimeId => _registry.RuntimeId;

    /// <summary>Gets the registry identity.</summary>
    public string OwnerId => _registry.OwnerId;

    /// <summary>Gets the opaque registry token.</summary>
    public string Token { get; }

    /// <summary>Gets whether this lease has begun disposal.</summary>
    public bool IsDisposed
    {
        get
        {
            lock (_gate)
                return _release is not null;
        }
    }

    /// <summary>Retains another lease without transferring this lease's ownership.</summary>
    public ValueTask<ReferenceLease> RetainAsync(CancellationToken cancellationToken = default)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_release is not null, this);
            return _registry.AcquireAsync(RuntimeId, OwnerId, Token, cancellationToken);
        }
    }

    internal void Validate(string runtimeId)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_release is not null, this);
            _registry.Validate(runtimeId, OwnerId, Token);
        }
    }

    /// <summary>Releases this lease once. The last owned lease disposes the registered resource.</summary>
    public ValueTask DisposeAsync()
    {
        TaskCompletionSource completion;
        lock (_gate)
        {
            if (_release is not null)
                return new(_release);

            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _release = completion.Task;
        }

        _ = CompleteReleaseAsync(completion);
        return new(completion.Task);
    }

    private async Task CompleteReleaseAsync(TaskCompletionSource completion)
    {
        try
        {
            await _registry.ReleaseAsync(Token).ConfigureAwait(false);
            completion.SetResult();
        }
        catch (Exception error)
        {
            completion.SetException(error);
        }
    }
}
