using System.Runtime.CompilerServices;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Runtime;

public partial class EChartInstance
{
    /// <summary>Reads normalized native options after all previously accepted commands. This is not a stable-render
    /// barrier.</summary>
    public ValueTask<EChartsOptionSnapshot> GetOptionAsync(CancellationToken cancellationToken = default) =>
        MethodAsync("getOption", [], (t, e) => t.ReadSnapshotAsync(e, _serialization), cancellationToken);

    /// <summary>Gets an independently retained borrowed reference to the chart DOM element.</summary>
    public ValueTask<EChartsObjectReference> GetDomAsync(CancellationToken cancellationToken = default) =>
        MethodAsync("getDom", [], (t, e) => t.ReadReferenceAsync(e), cancellationToken);

    /// <summary>Gets a borrowed ZRender reference. Its disposal never disposes ZRender.</summary>
    public ValueTask<EChartsObjectReference> GetZrAsync(CancellationToken cancellationToken = default) =>
        MethodAsync("getZr", [], (t, e) => t.ReadReferenceAsync(e), cancellationToken);

    /// <summary>Gets the native ECharts ID, which differs from the managed handle ID.</summary>
    public ValueTask<string> GetIdAsync(CancellationToken cancellationToken = default) =>
        ReadAsync("getId", [], v => v.GetString() ?? throw new JsonException("Missing native ID."), cancellationToken);

    /// <summary>Gets whether the native instance uses SSR.</summary>
    public ValueTask<bool> IsSsrAsync(CancellationToken cancellationToken = default) =>
        ReadAsync("isSSR", [], v => v.ValueKind != JsonValueKind.Null && v.GetBoolean(), cancellationToken);

    /// <summary>Gets native listener absence for an event, as defined by Eventful.isSilent.</summary>
    public ValueTask<bool> IsSilentAsync(string eventName, CancellationToken cancellationToken = default) =>
        ReadAsync("isSilent", [Required(eventName)], v => v.GetBoolean(), cancellationToken);

    /// <summary>Gets whether the managed handle or native chart has been disposed.</summary>
    public ValueTask<bool> IsDisposedAsync(CancellationToken cancellationToken = default) =>
        IsDisposed
            ? ValueTask.FromResult(true)
            : ReadAsync("isDisposed", [], v => v.ValueKind != JsonValueKind.Null && v.GetBoolean(), cancellationToken);

    /// <summary>Triggers an event with serializable arguments, as the native <c>trigger</c>.</summary>
    public ValueTask TriggerAsync(string eventName, IReadOnlyList<EChartsValue> arguments, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        return VoidAsync("trigger", [Required(eventName), .. arguments.Cast<object>()], cancellationToken);
    }

    /// <summary>Triggers an event with an explicit serializable receiver context.</summary>
    public ValueTask TriggerWithContextAsync(
        string eventName,
        IReadOnlyList<EChartsValue> arguments,
        EChartsValue context,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(arguments);
        return VoidAsync("triggerWithContext", [Required(eventName), .. arguments.Cast<object>(), context], cancellationToken);
    }

    /// <summary>Gets the native chart width.</summary>
    public ValueTask<double> GetWidthAsync(CancellationToken cancellationToken = default) =>
        ReadAsync("getWidth", [], v => v.GetDouble(), cancellationToken);

    /// <summary>Gets the native chart height.</summary>
    public ValueTask<double> GetHeightAsync(CancellationToken cancellationToken = default) =>
        ReadAsync("getHeight", [], v => v.GetDouble(), cancellationToken);

    /// <summary>Gets the native rendering device pixel ratio.</summary>
    public ValueTask<double> GetDevicePixelRatioAsync(CancellationToken cancellationToken = default) =>
        ReadAsync("getDevicePixelRatio", [], v => v.GetDouble(), cancellationToken);

    /// <summary>Converts source-defined data coordinates to a numeric scalar or array.</summary>
    public ValueTask<ChartPixelValue> ConvertToPixelAsync(
        ChartFinder finder,
        CoordinateValue value,
        ChartConvertOptions? options = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync("convertToPixel", ConvertArguments(finder, value, options), v => new ChartPixelValue(v), cancellationToken);

    /// <summary>Converts one pixel coordinate to data coordinates.</summary>
    public ValueTask<ChartPixelValue> ConvertFromPixelAsync(
        ChartFinder finder,
        double value,
        ChartConvertOptions? options = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync("convertFromPixel", ConvertArguments(finder, CoordinateValue.From(value), options), v => new ChartPixelValue(v), cancellationToken);

    /// <summary>Converts a pixel coordinate array without collapsing its shape.</summary>
    public ValueTask<ChartPixelValue> ConvertFromPixelAsync(
        ChartFinder finder,
        double[] value,
        ChartConvertOptions? options = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync(
            "convertFromPixel",
            ConvertArguments(finder, CoordinateValue.Array(Required(value).Select(CoordinateValue.From).ToArray()), options),
            v => new ChartPixelValue(v),
            cancellationToken);

    /// <summary>Converts data coordinates to a native coordinate-system layout.</summary>
    public ValueTask<ChartCoordinateLayout> ConvertToLayoutAsync(
        ChartFinder finder,
        CoordinateValue value,
        JsonElement? options = null,
        CancellationToken cancellationToken = default) =>
        ReadAsync("convertToLayout", [Required(finder), value, options], v => new ChartCoordinateLayout(v), cancellationToken);

    /// <summary>Converts data coordinates to a native coordinate-system layout with typed matrix options. A null
    /// argument omits the options.</summary>
    [OverloadResolutionPriority(1)]
    public ValueTask<ChartCoordinateLayout> ConvertToLayoutAsync(
        ChartFinder finder,
        CoordinateValue value,
        ChartConvertOptions? options,
        CancellationToken cancellationToken = default) =>
        ReadAsync("convertToLayout", ConvertArguments(finder, value, options), v => new ChartCoordinateLayout(v), cancellationToken);

    /// <summary>Tests a pixel point against native coordinates or components.</summary>
    public ValueTask<bool> ContainPixelAsync(ChartFinder finder, double[] point, CancellationToken cancellationToken = default) =>
        ReadAsync(
            "containPixel",
            [Required(finder), CoordinateValue.Array(Required(point).Select(CoordinateValue.From).ToArray())],
            v => v.GetBoolean(),
            cancellationToken);

    /// <summary>Gets color, symbol, symbol size, gradient or pattern visuals and their native references.</summary>
    public ValueTask<ChartVisual> GetVisualAsync(ChartFinder finder, string visualType, CancellationToken cancellationToken = default) =>
        MethodAsync("getVisual", [Required(finder), Required(visualType)], (t, e) => t.ReadVisualAsync(e), cancellationToken);

    /// <summary>Clears chart content through the ordered command queue.</summary>
    public ValueTask ClearAsync(CancellationToken cancellationToken = default) => VoidAsync("clear", [], cancellationToken);

    /// <summary>Resizes the native chart.</summary>
    public ValueTask ResizeAsync(ChartResizeOptions? options = null, CancellationToken cancellationToken = default) =>
        VoidAsync("resize", options is null ? [] : [options], cancellationToken);

    /// <summary>Shows the default loading effect using its configuration overload.</summary>
    [OverloadResolutionPriority(1)]
    public ValueTask ShowLoadingAsync(ChartLoadingOptions? options = null, CancellationToken cancellationToken = default) =>
        VoidAsync("showLoading", options is null ? [] : [options], cancellationToken);

    /// <summary>Shows a named loading effect.</summary>
    public ValueTask ShowLoadingAsync(string name, ChartLoadingOptions? options = null, CancellationToken cancellationToken = default) =>
        VoidAsync("showLoading", options is null ? [Required(name)] : [Required(name), options], cancellationToken);

    /// <summary>Shows an effect using an explicit custom configuration object.</summary>
    public ValueTask ShowLoadingAsync(JsonElement configuration, CancellationToken cancellationToken = default) =>
        VoidAsync("showLoading", [ObjectJson(configuration)], cancellationToken);

    /// <summary>Shows a named custom effect using its native configuration object.</summary>
    public ValueTask ShowLoadingAsync(string name, JsonElement configuration, CancellationToken cancellationToken = default) =>
        VoidAsync("showLoading", [Required(name), ObjectJson(configuration)], cancellationToken);

    /// <summary>Hides the loading effect.</summary>
    public ValueTask HideLoadingAsync(CancellationToken cancellationToken = default) => VoidAsync("hideLoading", [], cancellationToken);

    /// <summary>Appends explicit JSON data to supported scatter/lines series. Dataset input and other core series are
    /// rejected.</summary>
    public ValueTask AppendDataAsync(int seriesIndex, EChartsValue data, CancellationToken cancellationToken = default) =>
        VoidAsync(
            "appendData",
            [EChartsValue.Object(new Dictionary<string, EChartsValue> { ["seriesIndex"] = EChartsValue.From(seriesIndex), ["data"] = data })],
            cancellationToken);

    /// <summary>Updates native label layout.</summary>
    public ValueTask UpdateLabelLayoutAsync(CancellationToken cancellationToken = default) => VoidAsync("updateLabelLayout", [], cancellationToken);

    /// <summary>Maps a serializable native event to an action payload.</summary>
    public ValueTask<ChartActionResult> MakeActionFromEventAsync(JsonElement eventObject, CancellationToken cancellationToken = default) =>
        ReadAsync("makeActionFromEvent", [ObjectJson(eventObject)], v => new ChartActionResult(v), cancellationToken);

    /// <summary>Applies a named theme using native 6.1 semantics, which replay the initial option backup.</summary>
    [OverloadResolutionPriority(1)]
    public ValueTask SetThemeAsync(string theme, ChartSetThemeOptions? options = null, CancellationToken cancellationToken = default) =>
        VoidAsync("setTheme", [Required(theme), options], cancellationToken);

    /// <summary>Applies an explicit native theme object.</summary>
    public ValueTask SetThemeAsync(JsonElement theme, ChartSetThemeOptions? options = null, CancellationToken cancellationToken = default) =>
        VoidAsync("setTheme", [ObjectJson(theme), options], cancellationToken);

    /// <summary>Applies registered typed theme properties and explicit additional theme fields.</summary>
    public ValueTask SetThemeAsync(ChartOptions theme, ChartSetThemeOptions? options = null, CancellationToken cancellationToken = default)
    {
        var prepared = OptionSerializer.Serialize(theme, _serialization);
        if (prepared.Bindings.Count != 0)
            throw new NotSupportedException("Theme bindings require the binding bridge.");

        return SetThemeAsync(prepared.Json, options, cancellationToken);
    }

    /// <summary>Applies the native legacy boolean setOption overload through the same queue.</summary>
    public ValueTask SetOptionAsync(ChartOptions options, bool notMerge, bool lazyUpdate, CancellationToken cancellationToken = default) =>
        SetOptionAsync(options, new SetOptionOptions { NotMerge = notMerge, LazyUpdate = lazyUpdate }, cancellationToken);

    /// <summary>Applies raw options using native legacy boolean update flags.</summary>
    public ValueTask SetOptionAsync(JsonElement options, bool notMerge, bool lazyUpdate, CancellationToken cancellationToken = default) =>
        SetOptionAsync(options, new SetOptionOptions { NotMerge = notMerge, LazyUpdate = lazyUpdate }, cancellationToken);

    private static T Required<T>(T value) where T : class => value ?? throw new ArgumentNullException(nameof(value));

    private static object?[] ConvertArguments(ChartFinder finder, CoordinateValue value, ChartConvertOptions? options) =>
        options is null ? [Required(finder), value] : [Required(finder), value, options.Validated()];

    private static JsonElement ObjectJson(JsonElement value) =>
        value.ValueKind == JsonValueKind.Object ? value.Clone() : throw new ArgumentException("Expected a JSON object.");

    private ValueTask<T> ReadAsync<T>(string method, object?[] arguments, Func<JsonElement, T> read, CancellationToken token) =>
        MethodAsync(method, arguments, (_, e) => ValueTask.FromResult(read(e.GetProperty("value"))), token);

    private async ValueTask VoidAsync(string method, object?[] arguments, CancellationToken token) =>
        await ReadAsync(method, arguments, _ => true, token).ConfigureAwait(false);

    private async ValueTask<T> MethodAsync<T>(
        string method,
        object?[] arguments,
        Func<IChartMethodTransport, JsonElement, ValueTask<T>> read,
        CancellationToken cancellationToken)
    {
        EnsureActive();
        cancellationToken.ThrowIfCancellationRequested();
        var preparation = _serialization.CreatePreparation();
        var args = MethodJson.Create(w =>
        {
            w.WriteStartArray();
            for (var i = 0; i < arguments.Length; i++)
                preparation.WriteArrayItem(w, arguments[i], "$", i);

            w.WriteEndArray();
        });
        if (preparation.Bindings.Any())
            throw new NotSupportedException("Method input bindings require the binding bridge.");

        T? result = default;
        bool abandoned = false;
        bool produced = false;
        var ownership = new object();
        try
        {
            await _commands.Enqueue(async (revision, token) =>
            {
                await _readiness.WaitAsync(token).ConfigureAwait(false);
                EnsureActive();
                token.ThrowIfCancellationRequested();
                if (_transport is not IChartMethodTransport transport)
                    throw new NotSupportedException("The transport does not support instance methods.");

                var envelope = await transport.InvokeMethodAsync(Id, method, args, revision).ConfigureAwait(false);
                T value;
                try
                {
                    value = await read(transport, envelope).ConfigureAwait(false);
                }
                catch
                {
                    await transport.ReleaseResultAsync(envelope).ConfigureAwait(false);
                    throw;
                }

                bool release;
                lock (ownership)
                {
                    release = abandoned || cancellationToken.IsCancellationRequested || IsDisposed;
                    if (!release)
                    {
                        result = value;
                        produced = true;
                    }
                }

                if (release)
                {
                    if (value is IAsyncDisposable owned)
                        await owned.DisposeAsync().ConfigureAwait(false);
                    else
                        await transport.ReleaseResultAsync(envelope).ConfigureAwait(false);
                }
                else if (value is not IAsyncDisposable)
                    await transport.ReleaseResultAsync(envelope).ConfigureAwait(false);
            }, cancellationToken: cancellationToken, renders: method is "clear" or "resize" or "showLoading" or "hideLoading" or "appendData" or "updateLabelLayout" or "setTheme" or "setGroup" or "trigger" or "triggerWithContext").ConfigureAwait(false);
            return result!;
        }
        catch
        {
            IAsyncDisposable? release;
            lock (ownership)
            {
                abandoned = true;
                release = produced ? result as IAsyncDisposable : null;
            }

            if (release is not null)
                await release.DisposeAsync().ConfigureAwait(false);

            throw;
        }
    }
}
