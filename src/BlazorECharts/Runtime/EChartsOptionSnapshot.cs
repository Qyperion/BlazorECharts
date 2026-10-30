using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;

namespace BlazorECharts.Runtime;

/// <summary>A typed normalized option snapshot owning independent native reference leases.</summary>
/// <remarks>The producer transfers the supplied leases to this snapshot. Retrieval and native hydration are separate
/// APIs.</remarks>
public sealed class EChartsOptionSnapshot : IAsyncDisposable
{
    private readonly ChartOptions _options;
    private readonly ReferenceLease[] _leases;
    private readonly IAsyncDisposable[] _resources = [];
    private readonly IReadOnlyList<JsBinding> _bindings = [];
    private ArrayAnchor[][] _anchors = [];
    private readonly object _gate = new();
    private Task? _disposal;

    /// <summary>Takes ownership of the supplied leases without acquiring or taking ownership of the chart's leases.</summary>
    public EChartsOptionSnapshot(ChartOptions options, IEnumerable<ReferenceLease>? ownedLeases = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options;
        _leases = ownedLeases?.ToArray() ?? [];
        if (_leases.Any(lease => lease is null || lease.IsDisposed))
            throw new ArgumentException("Snapshot leases must be active.", nameof(ownedLeases));
    }

    /// <summary>Gets normalized typed options while the snapshot's references are retained.</summary>
    public ChartOptions Options
    {
        get
        {
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposal is not null, this);
                return _options;
            }
        }
    }

    internal EChartsOptionSnapshot(ChartOptions options, IReadOnlyList<JsBinding> bindings, IEnumerable<IAsyncDisposable> resources) : this(options)
    {
        _bindings = bindings;
        _resources = resources.ToArray();
    }

    /// <summary>Gets explicit browser-reference descriptors at their structured normalized paths. Reapplication
    /// requires the binding bridge.</summary>
    public IReadOnlyList<JsBinding> Bindings
    {
        get
        {
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposal is not null, this);
                return _bindings;
            }
        }
    }

    /// <summary>Gets the owned browser handles. Retain an independent lease before disposing this snapshot.</summary>
    public IReadOnlyList<EChartsObjectReference> References
    {
        get
        {
            lock (_gate)
            {
                ObjectDisposedException.ThrowIf(_disposal is not null, this);
                return _resources.OfType<EChartsObjectReference>().ToArray();
            }
        }
    }

    internal PreparedOption Prepare(EChartsSerializationContext context)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
            foreach (var reference in References)
                reference.Validate(context.ReferenceRuntimeId);

            var prepared = OptionSerializer.Serialize(_options, context);
            for (var b = 0; b < _bindings.Count; b++)
                Validate(prepared, _bindings[b], b < _anchors.Length ? _anchors[b] : []);

            return new(prepared.Utf8, prepared.Bindings.Concat(_bindings));
        }
    }

    // Records, for each array on a binding path, the item id or the array length, so that Prepare detects shifted items.
    internal void Anchor(JsonElement source)
    {
        _anchors = _bindings.Select(binding =>
        {
            var anchors = new List<ArrayAnchor>();
            var node = source;
            for (var i = 0; i < binding.Path.Count; i++)
            {
                if (binding.Path[i] is string key)
                {
                    if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(key, out node))
                        break;

                    continue;
                }

                var index = (int)binding.Path[i];
                if (node.ValueKind != JsonValueKind.Array || index >= node.GetArrayLength())
                    break;

                anchors.Add(new(i, node.GetArrayLength(), Id(node[index])));
                node = node[index];
            }

            return anchors.ToArray();
        }).ToArray();
    }

    private static void Validate(PreparedOption prepared, JsBinding binding, ArrayAnchor[] anchors)
    {
        var path = "$";
        foreach (var segment in binding.Path)
            path = segment is string key
                ? EChartsSerializationContext.PropertyPath(path, key)
                : EChartsSerializationContext.IndexPath(path, (int)segment);

        if (prepared.Bindings.Any(b => b.Path.SequenceEqual(binding.Path)))
            throw Moved(path, "an edited option assigns its own value there");

        var node = prepared.Json;
        for (var i = 0; i < binding.Path.Count; i++)
        {
            if (binding.Path[i] is string key)
            {
                if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(key, out node))
                    throw Moved(path, "the path no longer exists");

                continue;
            }

            var index = (int)binding.Path[i];
            if (node.ValueKind != JsonValueKind.Array || index >= node.GetArrayLength())
                throw Moved(path, "the path no longer exists");

            var item = node[index];
            foreach (var anchor in anchors)
                if (anchor.Depth == i && (anchor.Id is not null ? anchor.Id != Id(item) : anchor.Length != node.GetArrayLength()))
                    throw Moved(path, anchor.Id is not null ? "the array items were reordered" : "the array length changed");

            node = item;
        }

        if (node.ValueKind != JsonValueKind.Null)
            throw Moved(path, "the placeholder was replaced");
    }

    private static string? Id(JsonElement item) =>
        item.ValueKind == JsonValueKind.Object
            && item.TryGetProperty("id", out var id)
            && id.ValueKind is JsonValueKind.String or JsonValueKind.Number
            ? id.GetRawText()
            : null;

    private static InvalidOperationException Moved(string path, string reason) => new(
        $"The snapshot binding at {path} no longer matches the edited Options: {reason}. Snapshot callbacks and objects are bound by position; "
        + "after adding, removing or reordering items, apply the edited Options with their own values instead of the snapshot.");

    private sealed record ArrayAnchor(int Depth, int Length, string? Id);

    /// <summary>Releases every owned lease once, including when another release fails.</summary>
    public ValueTask DisposeAsync()
    {
        lock (_gate)
            return new(_disposal ??= Task.WhenAll(_leases.Cast<IAsyncDisposable>().Concat(_resources).Select(lease => lease.DisposeAsync().AsTask())));
    }
}
