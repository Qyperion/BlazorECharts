using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

public partial class EChartsRuntime
{
    /// <summary>Retains an event's native reference descriptor beyond its awaited handler. Call before the handler
    /// returns.</summary>
    public ValueTask<EChartsObjectReference> RetainReferenceAsync(JsonElement descriptor, CancellationToken cancellationToken = default)
    {
        if (descriptor.ValueKind != JsonValueKind.Object)
            throw new ArgumentException("Expected a runtimeId/ownerId/token reference descriptor.", nameof(descriptor));

        return CreateNativeAsync("reference", EChartsValue.FromJson(descriptor), [], cancellationToken);
    }

    /// <summary>Invokes an exact public native path. Prefer generated named helpers; use explicit bindings for native
    /// arguments.</summary>
    public async ValueTask<EChartsBrowserResult> InvokeNativeAsync(
        string publicPath,
        EChartsValue[] arguments,
        bool construct = false,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(publicPath);
        ArgumentNullException.ThrowIfNull(arguments);
        await EnsureInitializedAsync(false, cancellationToken).ConfigureAwait(false);
        var prepared = PrepareBrowserArguments(arguments);
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
            _methodUses++;
        }

        JsonElement envelope;
        try
        {
            envelope = await WithReplyTimeoutAsync(
                publicPath,
                _module!.InvokeAsync<JsonElement>("invokeNative", _ownerId, publicPath, construct, prepared)).ConfigureAwait(false);
        }
        catch
        {
            await EndMethodUseAsync().ConfigureAwait(false);
            throw;
        }

        await TrackResultAsync(envelope).ConfigureAwait(false);
        try
        {
            if (envelope.TryGetProperty("disposedCharts", out var disposed))
                foreach (var member in disposed.EnumerateArray())
                    if (member.GetProperty("ownerId").GetString() == _ownerId)
                    {
                        EChartInstance? instance;
                        lock (_gate)
                            _instances.TryGetValue(member.GetProperty("chartId").GetString()!, out instance);

                        if (instance is not null)
                            await instance.DisposeAsync().ConfigureAwait(false);
                    }

            cancellationToken.ThrowIfCancellationRequested();
            return new(envelope.GetProperty("value"), ReferenceOwner(envelope, new ChartOptions()));
        }
        catch
        {
            await ((IChartMethodTransport)this).ReleaseResultAsync(envelope).ConfigureAwait(false);
            throw;
        }
    }

    /// <summary>
    /// Registers a custom series renderer under <paramref name="type"/>. A custom series selects it by setting
    /// <see cref="CustomSeriesOption.RenderItem"/> to the same name. A later registration with the same name replaces it.
    /// </summary>
    public async ValueTask RegisterCustomSeriesAsync(
        string type,
        JsFunction<CustomRenderItemSignature> renderItem,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        ArgumentNullException.ThrowIfNull(renderItem);
        await using var result = await InvokeNativeAsync(
            "registerCustomSeries",
            [EChartsValue.From(type), EChartsValue.From(renderItem)],
            false,
            cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Creates an owned decoded browser image. Decode, HTTP and CORS failures reject the call.</summary>
    public ValueTask<EChartsObjectReference> CreateImageAsync(
        string source,
        string? crossOrigin = "anonymous",
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        return CreateNativeAsync(
            "image",
            EChartsValue.Object(
                new Dictionary<string, EChartsValue> { ["src"] = EChartsValue.From(source), ["crossOrigin"] = EChartsValue.From(crossOrigin) }),
            [],
            cancellationToken);
    }

    /// <summary>Creates a canvas retained independently by each consumer/chart/snapshot.</summary>
    public ValueTask<EChartsObjectReference> CreateCanvasAsync(int width, int height, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);
        return CreateNativeAsync(
            "canvas",
            EChartsValue.Object(new Dictionary<string, EChartsValue> { ["width"] = EChartsValue.From(width), ["height"] = EChartsValue.From(height) }),
            [],
            cancellationToken);
    }

    /// <summary>Invokes a browser module factory and borrows its returned object. Supports async factories without
    /// serializing browser objects.</summary>
    public ValueTask<EChartsObjectReference> ImportObjectAsync(
        string moduleUrl,
        string exportName,
        EChartsValue[]? arguments = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(moduleUrl);
        ArgumentException.ThrowIfNullOrWhiteSpace(exportName);
        return CreateNativeAsync(
            "module",
            EChartsValue.Object(
                new Dictionary<string, EChartsValue> { ["moduleUrl"] = EChartsValue.From(moduleUrl), ["exportName"] = EChartsValue.From(exportName) }),
            arguments ?? [],
            cancellationToken);
    }

    private async ValueTask<EChartsObjectReference> CreateNativeAsync(
        string kind,
        EChartsValue options,
        EChartsValue[] arguments,
        CancellationToken token)
    {
        await EnsureInitializedAsync(false, token).ConfigureAwait(false);
        var prepared = PrepareBrowserArguments(arguments);
        var settings = new ChartOptions();
        settings.AdditionalProperties["options"] = options;
        var json = OptionSerializer.Serialize(settings, Serialization).Json.GetProperty("options");
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposal is not null, this);
            _methodUses++;
        }

        JsonElement envelope;
        try
        {
            envelope = await WithReplyTimeoutAsync(kind, _module!.InvokeAsync<JsonElement>("createNative", _ownerId, kind, json, prepared))
                .ConfigureAwait(false);
        }
        catch
        {
            await EndMethodUseAsync().ConfigureAwait(false);
            throw;
        }

        await TrackResultAsync(envelope).ConfigureAwait(false);
        try
        {
            token.ThrowIfCancellationRequested();
            return await ((IChartMethodTransport)this).ReadReferenceAsync(envelope).ConfigureAwait(false);
        }
        catch
        {
            await ((IChartMethodTransport)this).ReleaseResultAsync(envelope).ConfigureAwait(false);
            throw;
        }
    }

    private JsonElement PrepareBrowserArguments(EChartsValue[] arguments)
    {
        var options = new ChartOptions();
        options.AdditionalProperties["args"] = EChartsValue.Array(arguments);
        return JsonSerializer.SerializeToElement(
            OptionSerializer.Serialize(options, Serialization),
            EChartsTransportJsonContext.Default.PreparedOption);
    }
}
