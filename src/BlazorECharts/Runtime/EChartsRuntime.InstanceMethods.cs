using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

public partial class EChartsRuntime : IChartMethodTransport
{
    private readonly Dictionary<string, MethodResult> _methodResults = [];
    private int _methodUses;
    private bool _moduleReleaseRequested;
    private bool _moduleReleased;

    async ValueTask<JsonElement> IChartMethodTransport.InvokeMethodAsync(string id, string method, JsonElement arguments, ChartRevision revision)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null || !_instances.ContainsKey(id), this);
            _methodUses++;
        }

        var transferred = false;
        try
        {
            var result = await WithReplyTimeoutAsync(method, _module!.InvokeAsync<JsonElement>("invokeMethod",
                [_ownerId, id, method, arguments, revision.Generation, revision.Revision, revision.Sequence])).ConfigureAwait(false);
            transferred = true;
            await TrackResultAsync(result).ConfigureAwait(false);
            return result;
        }
        catch
        {
            if (!transferred)
                await EndMethodUseAsync().ConfigureAwait(false);

            throw;
        }
    }

    private async ValueTask TrackResultAsync(JsonElement result)
    {
        if (result.TryGetProperty("leaseId", out var leaseId) && leaseId.ValueKind == JsonValueKind.String)
        {
            lock (_gate)
                _methodResults.Add(leaseId.GetString()!, new MethodResult(this, leaseId.GetString()!));
        }
        else
            await EndMethodUseAsync().ConfigureAwait(false);
    }

    ValueTask<EChartsOptionSnapshot> IChartMethodTransport.ReadSnapshotAsync(JsonElement envelope, EChartsSerializationContext context)
    {
        // One owned copy of the whole snapshot, so that the Clone of each read value returns its element instead of copying it.
        var value = envelope.GetProperty("value").Clone();
        var options = GeneratedOptionMetadata.ReadChartOptions(value, context.CreateSnapshotReader());
        var snapshot = ReferenceOwner(envelope, options);
        snapshot.Anchor(value);
        return ValueTask.FromResult(snapshot);
    }

    ValueTask<EChartsObjectReference> IChartMethodTransport.ReadReferenceAsync(JsonElement envelope)
    {
        var owner = ReferenceOwner(envelope, new ChartOptions());
        if (owner.References.Count != 1 || owner.Bindings.Count != 1 || owner.Bindings[0].Path.Count != 0)
            return FailReferenceAsync(owner);

        return ValueTask.FromResult(owner.References[0]);

        static async ValueTask<EChartsObjectReference> FailReferenceAsync(EChartsOptionSnapshot owner)
        {
            await owner.DisposeAsync();
            throw new JsonException("Expected a native browser reference, not a JSON object.");
        }
    }

    ValueTask<ChartVisual> IChartMethodTransport.ReadVisualAsync(JsonElement envelope) =>
        ValueTask.FromResult(new ChartVisual(envelope.GetProperty("value"), ReferenceOwner(envelope, new ChartOptions())));

    ValueTask IChartMethodTransport.ReleaseResultAsync(JsonElement envelope)
    {
        if (!envelope.TryGetProperty("leaseId", out var id) || id.ValueKind != JsonValueKind.String)
            return ValueTask.CompletedTask;

        MethodResult? result;
        lock (_gate)
            _methodResults.TryGetValue(id.GetString()!, out result);

        return result?.DisposeAsync() ?? ValueTask.CompletedTask;
    }

    private EChartsOptionSnapshot ReferenceOwner(JsonElement envelope, ChartOptions options)
    {
        if (!envelope.TryGetProperty("bindings", out var bindings) || bindings.GetArrayLength() == 0)
            return new(options);

        var descriptors = bindings.EnumerateArray().ToArray();
        var runtime = descriptors[0].GetProperty("runtimeId").GetString()!;
        var owner = descriptors[0].GetProperty("ownerId").GetString()!;
        if (runtime != RuntimeId
            || descriptors.Any(d => d.GetProperty("runtimeId").GetString() != runtime || d.GetProperty("ownerId").GetString() != owner))
            throw new JsonException("Reference runtime/owner identity mismatch.");

        var tokens = descriptors.Select(d => d.GetProperty("token").GetString()!).Distinct(StringComparer.Ordinal).ToArray();
        MethodResult group;
        lock (_gate)
        {
            group = _methodResults[envelope.GetProperty("leaseId").GetString()!];
            group.Remaining = tokens.Length;
        }

        var registry = new ReferenceRegistry(runtime, owner);
        var references = tokens.ToDictionary(
            t => t,
            t => registry.Register(t, new MethodResultMember(group), ReferenceOwnership.Owned),
            StringComparer.Ordinal);
        var mapped = descriptors.Select(d =>
        {
            var path = JsBindingPath.Root;
            foreach (var s in d.GetProperty("path").EnumerateArray())
                path = path.Append(s.ValueKind == JsonValueKind.String ? s.GetString()! : s.GetInt32());

            return new JsBinding(path, references[d.GetProperty("token").GetString()!]);
        }).ToArray();
        return new(options, mapped, references.Values);
    }

    private async ValueTask EndMethodUseAsync()
    {
        bool release;
        lock (_gate)
        {
            _methodUses--;
            release = _moduleReleaseRequested && _methodUses == 0 && !_moduleReleased;
            if (release)
                _moduleReleased = true;
        }

        if (release && _module is not null)
            await _module.DisposeAsync().ConfigureAwait(false);
    }

    private async ValueTask ReleaseModuleWhenUnusedAsync()
    {
        bool release;
        lock (_gate)
        {
            _moduleReleaseRequested = true;
            release = _methodUses == 0 && !_moduleReleased;
            if (release)
                _moduleReleased = true;
        }

        if (release && _module is not null)
            await _module.DisposeAsync().ConfigureAwait(false);
    }

    private sealed class MethodResult(EChartsRuntime runtime, string id) : IAsyncDisposable
    {
        private Task? _release;
        internal int Remaining;

        public ValueTask DisposeAsync()
        {
            lock (this)
                return new(_release ??= ReleaseAsync());
        }

        private async Task ReleaseAsync()
        {
            try
            {
                await runtime._module!.InvokeVoidAsync("releaseResult", runtime._ownerId, id).ConfigureAwait(false);
            }
            catch (JSDisconnectedException)
            {
            }
            finally
            {
                lock (runtime._gate)
                    runtime._methodResults.Remove(id);

                await runtime.EndMethodUseAsync().ConfigureAwait(false);
            }
        }

        internal ValueTask ReleaseMemberAsync() => Interlocked.Decrement(ref Remaining) == 0 ? DisposeAsync() : ValueTask.CompletedTask;
    }

    private sealed class MethodResultMember(MethodResult result) : IAsyncDisposable
    {
        public ValueTask DisposeAsync() => result.ReleaseMemberAsync();
    }
}
