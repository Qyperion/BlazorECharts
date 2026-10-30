namespace BlazorECharts.Runtime;

/// <summary>Defines whether the registry releases the native resource after its last lease.</summary>
internal enum ReferenceOwnership
{
    /// <summary>The consumer owns the resource; leases never dispose it.</summary>
    Borrowed,

    /// <summary>The registry disposes the resource exactly once after the last lease.</summary>
    Owned,
}
