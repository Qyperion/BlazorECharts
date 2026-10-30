namespace BlazorECharts.Serialization;

// Test-only accounting of serializer entry points; shared by a context and its preparations.
internal sealed class SerializationStatistics
{
    private readonly object _gate = new();
    private readonly Dictionary<Type, (long Count, long Bytes)> _byRoot = [];

    internal void Record(Type root, long bytes)
    {
        lock (_gate)
        {
            _byRoot.TryGetValue(root, out var current);
            _byRoot[root] = (current.Count + 1, current.Bytes + bytes);
        }
    }

    internal long Count<T>() => Sum<T>(entry => entry.Count);

    internal long Bytes<T>() => Sum<T>(entry => entry.Bytes);

    private long Sum<T>(Func<(long Count, long Bytes), long> select)
    {
        lock (_gate)
            return _byRoot.Where(entry => entry.Key.IsAssignableTo(typeof(T))).Sum(entry => select(entry.Value));
    }
}
