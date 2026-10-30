namespace BlazorECharts.Runtime;

// A synchronous rejection: the command was never queued, so a declarative caller may submit its latest input later.
internal sealed class ChartQueueFullException() : InvalidOperationException("The chart command queue is full (64 pending commands). Await pending operations before submitting more work.");

// One queue per managed handle, including across native recreation. Never await user callbacks here.
internal sealed class ChartCommandQueue : IDisposable
{
    private sealed class Command(
        Func<ChartRevision, CancellationToken, ValueTask> run,
        bool declarative,
        bool recreate,
        long revision,
        CancellationToken callerToken,
        bool inlineContinuations)
    {
        internal readonly TaskCompletionSource Completion =
            new(inlineContinuations ? TaskCreationOptions.None : TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly Func<ChartRevision, CancellationToken, ValueTask> Run = run;
        internal readonly bool Declarative = declarative;
        internal readonly bool Recreate = recreate;
        internal readonly long Revision = revision;
        internal readonly CancellationToken CallerToken = callerToken;
        internal CancellationTokenRegistration Cancellation;
    }

    // The browser runtime has one thread, where a thread-pool hop is a setTimeout(0) that Chrome clamps to 4 ms in a chain
    // of awaited commands. There callers resume inline, so commands settle outside the lock and between commands.
    private readonly bool _inlineContinuations;
    private readonly object _gate = new();
    private readonly LinkedList<Command> _pending = [];
    private readonly CancellationTokenSource _lifetime = new();
    private Command? _active;
    private TaskCompletionSource? _slot;
    private Exception? _failure;
    private bool _running;
    private bool _disposed;
    private int _generation = 1;
    private long _revision;
    private long _completed;
    private long _renderingSequence;

    internal ChartCommandQueue()
        : this(OperatingSystem.IsBrowser())
    {
    }

    internal ChartCommandQueue(bool inlineContinuations) => _inlineContinuations = inlineContinuations;

    internal long AcceptedRenderingSequence
    {
        get
        {
            lock (_gate)
                return _renderingSequence;
        }
    }

    internal int PendingCount
    {
        get
        {
            lock (_gate)
                return _pending.Count;
        }
    }

    internal ChartRevision Accepted
    {
        get
        {
            lock (_gate)
                return new(_generation, _revision, _revision);
        }
    }

    internal long CompletedRevision
    {
        get
        {
            lock (_gate)
                return _completed;
        }
    }

    internal void SetGeneration(int generation)
    {
        lock (_gate)
            _generation = generation;
    }

    internal ValueTask Enqueue(Func<ChartRevision, CancellationToken, ValueTask> run, bool declarative = false,
        bool replaces = false, bool recreate = false, CancellationToken cancellationToken = default, bool renders = true)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Command command;
        bool start;
        List<Command>? superseded = null;
        try
        {
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);

                // A complete replacement may supersede adjacent declarative patches, never an imperative barrier.
                // Cancellable replacements cannot erase work that would otherwise survive their cancellation.
                if (declarative && replaces && !cancellationToken.CanBeCanceled)
                    while (_pending.Last is { Value.Declarative: true } last)
                    {
                        _pending.RemoveLast();
                        (superseded ??= []).Add(last.Value);
                    }

                if (_pending.Count >= Capacity)
                    throw new ChartQueueFullException();

                command = new(run, declarative, recreate, ++_revision, cancellationToken, _inlineContinuations);
                if (renders)
                    _renderingSequence = _revision;

                // Cancellation settles the caller immediately; an already dispatched operation still owns the ordering slot.
                command.Cancellation = cancellationToken.Register(() => command.Completion.TrySetCanceled(cancellationToken));
                _pending.AddLast(command);
                start = !_running;
                _running = true;
            }
        }
        finally
        {
            // Superseded callers resume only after their replacement is queued.
            if (superseded is not null)
                foreach (var replaced in superseded)
                {
                    replaced.Completion.TrySetCanceled();
                    replaced.Cancellation.Dispose();
                }
        }

        if (start)
            _ = DrainAsync();

        return new(command.Completion.Task);
    }

    private async Task DrainAsync()
    {
        while (true)
        {
            Command command;
            ChartRevision stamp;
            lock (_gate)
            {
                if (_pending.First is null)
                {
                    _running = false;
                    return;
                }

                command = _pending.First.Value;
                _pending.RemoveFirst();
                _slot?.TrySetResult();
                _slot = null;

                _active = command;
                if (command.Recreate && !command.Completion.Task.IsCompleted)
                    _generation++;

                stamp = new(_generation, command.Revision, command.Revision);
            }

            var completed = false;
            Exception? failure = null;
            try
            {
                if (!command.Completion.Task.IsCompleted)
                {
                    using var waiting = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, command.CallerToken);
                    await command.Run(stamp, waiting.Token).ConfigureAwait(false);
                    lock (_gate)
                    {
                        // Leaving the active slot with the decision keeps a concurrent Dispose from cancelling a completed command.
                        _active = null;
                        completed = !_disposed && stamp.Generation == _generation;
                        if (completed)
                            _completed = stamp.Revision;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                lock (_gate)
                    failure = _failure;
            }
            catch (Exception error)
            {
                failure = error;
            }
            finally
            {
                command.Cancellation.Dispose();
                lock (_gate)
                    _active = null;
            }

            if (completed)
                command.Completion.TrySetResult();
            else if (failure is not null)
                command.Completion.TrySetException(failure);
            else
                command.Completion.TrySetCanceled();
        }
    }

    private const int Capacity = 64;

    // Completes when a queued command starts, or when the queue is disposed.
    internal Task WaitForSlotAsync()
    {
        lock (_gate)
        {
            if (_disposed || _pending.Count < Capacity)
                return Task.CompletedTask;

            return (_slot ??= new(TaskCreationOptions.RunContinuationsAsynchronously)).Task;
        }
    }

    // A recreation that the browser rejected before any change keeps the current native generation.
    internal void RevertRecreation(int generation)
    {
        lock (_gate)
            if (_generation == generation)
                _generation--;
    }

    // Commands that wait for a failed initialization report its cause instead of a cancellation.
    internal void Fail(Exception cause)
    {
        lock (_gate)
            _failure ??= cause;
    }

    public void Dispose()
    {
        Command? active;
        Command[] pending;
        Exception? failure;
        lock (_gate)
        {
            if (_disposed)
                return;

            _disposed = true;
            _generation++;
            active = _active;
            pending = [.. _pending];
            _pending.Clear();
            failure = _failure;
            _slot?.TrySetResult();
            _slot = null;
        }

        // Cancellation callbacks and callers run outside the lock; the drain disposes the active command's registration.
        _lifetime.Cancel();
        Settle(active);
        foreach (var command in pending)
        {
            Settle(command);
            command.Cancellation.Dispose();
        }

        void Settle(Command? command)
        {
            if (failure is null)
                command?.Completion.TrySetCanceled();
            else
                command?.Completion.TrySetException(failure);
        }
    }
}
