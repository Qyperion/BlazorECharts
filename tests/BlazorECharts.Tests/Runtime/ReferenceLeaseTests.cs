using BlazorECharts.Runtime;
using BlazorECharts.Tests.Fixtures.Serialization;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class ReferenceLeaseTests
{
    [Fact]
    public async Task BorrowedReference_ChartLeaseDisposal_DoesNotDisposeConsumer()
    {
        // Arrange
        var resource = new FixtureReferenceOwner();
        var registry = new ReferenceRegistry("page", "consumer");
        var reference = registry.Register(resource, ReferenceOwnership.Borrowed);
        var chart = await reference.AcquireLeaseAsync("page");

        // Act
        await chart.DisposeAsync();
        await chart.DisposeAsync();

        // Assert
        Assert.Equal(1, registry.LeaseCount);

        // Act
        await reference.DisposeAsync();

        // Assert
        Assert.Equal(0, registry.Count);
        Assert.Equal(0, resource.Disposals);
    }

    [Fact]
    public async Task SnapshotLease_Disposal_DoesNotInvalidateChartLease()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "runtime");
        var resource = new FixtureReferenceOwner();
        var reference = registry.Register(resource, ReferenceOwnership.Owned);
        var chart = await reference.AcquireLeaseAsync("page");
        var snapshot = await chart.RetainAsync();

        // Act
        await reference.DisposeAsync();
        await snapshot.DisposeAsync();

        // Assert
        Assert.Equal(1, registry.LeaseCount);
        Assert.Equal(0, resource.Disposals);

        // Act
        await using (await chart.RetainAsync()) { }

        await chart.DisposeAsync();

        // Assert
        Assert.Equal(1, resource.Disposals);
        Assert.Equal(0, registry.Count);
    }

    [Fact]
    public async Task LastOwnedLease_DisposesOnce()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "runtime");
        var resource = new FixtureReferenceOwner();
        var reference = registry.Register(resource, ReferenceOwnership.Owned);
        var leases = await Task.WhenAll(Enumerable.Range(0, 16).Select(_ => reference.AcquireLeaseAsync("page").AsTask()));

        // Act
        await reference.DisposeAsync();
        await Task.WhenAll(leases.SelectMany(lease => new[] { lease.DisposeAsync().AsTask(), lease.DisposeAsync().AsTask() }));

        // Assert
        Assert.Equal(1, resource.Disposals);
        Assert.Equal(0, registry.Count);
        Assert.Equal(0, registry.LeaseCount);
    }

    [Fact]
    public async Task Reference_RuntimeMismatchAndDisposedToken_Reject()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "owner");
        var reference = registry.Register(new FixtureReferenceOwner());

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => reference.AcquireLeaseAsync("foreign").AsTask());
        await Assert.ThrowsAsync<InvalidOperationException>(() => registry.AcquireAsync("page", "foreign-owner", reference.Token).AsTask());
        await Assert.ThrowsAsync<InvalidOperationException>(() => registry.AcquireAsync("page", "owner", "unknown").AsTask());
        Assert.Equal(1, registry.LeaseCount);

        // Act
        await reference.DisposeAsync();

        // Assert
        await Assert.ThrowsAsync<ObjectDisposedException>(() => reference.AcquireLeaseAsync("page").AsTask());
        await Assert.ThrowsAsync<InvalidOperationException>(() => registry.AcquireAsync("page", "owner", reference.Token).AsTask());
        Assert.Equal(0, registry.Count);
    }

    [Fact]
    public async Task CancelledAcquisition_DoesNotRetainEntry()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "owner");
        var reference = registry.Register(new FixtureReferenceOwner());
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        // Act & Assert
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => reference.AcquireLeaseAsync("page", cancellation.Token).AsTask());
        Assert.Equal(1, registry.LeaseCount);

        // Act
        await reference.DisposeAsync();

        // Assert
        Assert.Equal(0, registry.Count);
    }

    [Fact]
    public async Task ReleaseFailure_RemovesEntryAndIsNotRetried()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "owner");
        var resource = new FixtureReferenceOwner { FailDisposal = true };
        var reference = registry.Register(resource, ReferenceOwnership.Owned);

        // Act & Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() => reference.DisposeAsync().AsTask());
        await Assert.ThrowsAsync<InvalidOperationException>(() => reference.DisposeAsync().AsTask());
        Assert.Equal(0, registry.Count);
        Assert.Equal(0, registry.LeaseCount);
        Assert.Equal(1, resource.Disposals);
    }

    [Fact]
    public async Task BrowserTokenRegistration_PreservesIdentityAndRejectsActiveDuplicates()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "owner");
        var resource = new FixtureReferenceOwner();

        // Act
        var reference = registry.Register("object:42", resource, ReferenceOwnership.Owned);

        // Assert
        Assert.Equal("object:42", reference.Token);
        Assert.Throws<InvalidOperationException>(() => registry.Register("object:42", resource));
        Assert.Equal(1, registry.LeaseCount);

        // Act
        await reference.DisposeAsync();

        // Assert
        Assert.Equal(1, resource.Disposals);
    }

    [Fact]
    public async Task Disposal_ReentrantReleaseObservesOnePendingOperation()
    {
        // Arrange
        var registry = new ReferenceRegistry("page", "owner");
        EChartsObjectReference? reference = null;
        Task? nested = null;
        var resource = new ReentrantResource(() => nested = reference!.DisposeAsync().AsTask());
        reference = registry.Register(resource, ReferenceOwnership.Owned);

        // Act
        await reference.DisposeAsync();
        await nested!;

        // Assert
        Assert.Equal(1, resource.Disposals);
        Assert.Equal(0, registry.Count);
    }

    private sealed class ReentrantResource(Action onDispose) : IAsyncDisposable
    {
        public int Disposals { get; private set; }

        public ValueTask DisposeAsync()
        {
            Disposals++;
            onDispose();
            return ValueTask.CompletedTask;
        }
    }
}
