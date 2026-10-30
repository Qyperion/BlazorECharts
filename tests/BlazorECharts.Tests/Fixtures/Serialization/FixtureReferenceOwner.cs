namespace BlazorECharts.Tests.Fixtures.Serialization;

internal sealed class FixtureReferenceOwner : IAsyncDisposable
{
    public int Disposals { get; private set; }
    public bool FailDisposal { get; init; }

    public ValueTask DisposeAsync()
    {
        Disposals++;
        return FailDisposal ? ValueTask.FromException(new InvalidOperationException("fixture release failed")) : ValueTask.CompletedTask;
    }
}
