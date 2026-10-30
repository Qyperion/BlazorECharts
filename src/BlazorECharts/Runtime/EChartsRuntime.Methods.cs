using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Microsoft.AspNetCore.Components;

namespace BlazorECharts.Runtime;

public partial class EChartsRuntime
{
    // The requirements of IJSObjectReference.InvokeAsync<TValue>, which deserializes the result by reflection.
    private const DynamicallyAccessedMemberTypes JsonSerialized =
        DynamicallyAccessedMemberTypes.PublicConstructors
        | DynamicallyAccessedMemberTypes.PublicFields
        | DynamicallyAccessedMemberTypes.PublicProperties;

    private bool _extensionsConfigured;

    private void ConfigureExtensions()
    {
        lock (_gate)
        {
            if (_extensionsConfigured)
                return;

            _serialization.SetInlinePolicy(_options.Freeze().AllowInlineJavaScript);
            foreach (var extension in _options.Extensions.DistinctBy(e => e.Id))
                extension.ConfigureSerialization(_serialization);

            _extensionsConfigured = true;
        }
    }

    /// <summary>Registers native GeoJSON, the {geoJSON,specialAreas} form, or the {svg} form.</summary>
    public ValueTask RegisterMapAsync(
        string name,
        JsonElement geoJson,
        JsonElement? specialAreas = null,
        CancellationToken cancellationToken = default) =>
        GlobalVoidAsync("registerMap", [Name(name), geoJson.Clone(), specialAreas?.Clone()], cancellationToken);

    /// <summary>Creates an owned chart with a native theme object.</summary>
    public async ValueTask<EChartInstance> CreateInstanceWithThemeAsync(
        ElementReference element,
        JsonElement theme,
        ChartInitOptions? initOptions = null,
        CancellationToken cancellationToken = default) =>
        await CreateCoreAsync(element, initOptions, theme.Clone(), null, cancellationToken).ConfigureAwait(false)
        ?? throw new InvalidOperationException("Native chart allocation returned no handle.");

    /// <summary>Creates an owned chart with a theme serialized through explicit metadata.</summary>
    public ValueTask<EChartInstance> CreateInstanceWithThemeAsync(
        ElementReference element,
        ChartOptions theme,
        ChartInitOptions? initOptions = null,
        CancellationToken cancellationToken = default) =>
        CreateInstanceWithThemeAsync(element, PrepareGlobalOption(theme), initOptions, cancellationToken);

    /// <summary>Registers JSON text using the native legacy overload.</summary>
    public ValueTask RegisterMapAsync(string name, string geoJson, JsonElement? specialAreas = null, CancellationToken cancellationToken = default) =>
        GlobalVoidAsync("registerMap", [Name(name), geoJson, specialAreas?.Clone()], cancellationToken);

    /// <summary>Registers native GeoJSON and relocates the named regions to typed special-area rectangles.</summary>
    public ValueTask RegisterMapAsync(
        string name,
        JsonElement geoJson,
        IReadOnlyDictionary<string, GeoSpecialArea> specialAreas,
        CancellationToken cancellationToken = default) =>
        GlobalVoidAsync("registerMap", [Name(name), geoJson.Clone(), GeoSpecialArea.ToJson(specialAreas)], cancellationToken);

    /// <summary>Registers GeoJSON text and relocates the named regions to typed special-area rectangles.</summary>
    public ValueTask RegisterMapAsync(
        string name,
        string geoJson,
        IReadOnlyDictionary<string, GeoSpecialArea> specialAreas,
        CancellationToken cancellationToken = default) =>
        GlobalVoidAsync("registerMap", [Name(name), geoJson, GeoSpecialArea.ToJson(specialAreas)], cancellationToken);

    /// <summary>Registers SVG text. Native getMap returns false for SVG resources.</summary>
    public ValueTask RegisterSvgMapAsync(string name, string svg, CancellationToken cancellationToken = default) =>
        GlobalVoidAsync(
            "registerMap",
            [Name(name), EChartsValue.Object(new Dictionary<string, EChartsValue> { ["svg"] = EChartsValue.From(svg) })],
            cancellationToken);

    /// <summary>Reads the native map result: null for missing resources, IsGeoJson=false for SVG.</summary>
    public ValueTask<EChartsMapResult?> GetMapAsync(string name, CancellationToken cancellationToken = default) =>
        GlobalReadAsync("getMap", [Name(name)], v => v.ValueKind == JsonValueKind.Null ? null : new EChartsMapResult(v), cancellationToken);

    /// <summary>Registers a native theme object on the shared runtime.</summary>
    public ValueTask RegisterThemeAsync(string name, JsonElement theme, CancellationToken cancellationToken = default) =>
        GlobalVoidAsync("registerTheme", [Name(name), theme.Clone()], cancellationToken);

    /// <summary>Registers a theme using the facade's explicit option serializers.</summary>
    public ValueTask RegisterThemeAsync(string name, ChartOptions theme, CancellationToken cancellationToken = default) =>
        RegisterThemeAsync(name, PrepareGlobalOption(theme), cancellationToken);

    /// <summary>Registers native locale data on the shared runtime.</summary>
    public ValueTask RegisterLocaleAsync(string name, JsonElement locale, CancellationToken cancellationToken = default) =>
        GlobalVoidAsync("registerLocale", [Name(name), locale.Clone()], cancellationToken);

    /// <summary>Gets the dimensions registered by a coordinate system.</summary>
    internal ValueTask<ChartDimensionDefinition[]?> GetCoordinateSystemDimensionsAsync(string type, CancellationToken cancellationToken = default) =>
        GlobalReadAsync(
            "getCoordinateSystemDimensions",
            [Name(type)],
            v => v.ValueKind == JsonValueKind.Null ? null : v.EnumerateArray().Select(x => new ChartDimensionDefinition(x)).ToArray(),
            cancellationToken);

    /// <summary>Connects native charts already assigned to this group.</summary>
    public async ValueTask<string> ConnectAsync(string group, CancellationToken cancellationToken = default) =>
        (await RuntimeCallAsync<string>("connect", [Name(group)], cancellationToken).ConfigureAwait(false));

    /// <summary>Connects live managed charts from compatible facades on this browser page.</summary>
    public async ValueTask<string> ConnectAsync(IReadOnlyList<EChartInstance> members, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(members);
        var captured = members.ToArray();
        await EnsureInitializedAsync(false, cancellationToken).ConfigureAwait(false);
        foreach (var chart in captured)
        {
            ArgumentNullException.ThrowIfNull(chart);
            if (chart.IsDisposed)
                throw new ObjectDisposedException(nameof(EChartInstance));

            if (chart.RuntimeOwner?.RuntimeId != RuntimeId)
                throw new ArgumentException("Members must belong to the same browser page runtime.", nameof(members));

            await chart.GetGroupAsync(cancellationToken).ConfigureAwait(false);
        }

        return await RuntimeCallAsync<string>("connect", [captured.Select(c => c.Id).ToArray()], cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Disables event forwarding for a group while preserving membership.</summary>
    public async ValueTask DisconnectAsync(string group, CancellationToken cancellationToken = default) =>
        await RuntimeCallAsync<object?>("disconnect", [Name(group)], cancellationToken).ConfigureAwait(false);

    /// <summary>Finds an existing handle owned by this facade, without adopting another owner's native chart.</summary>
    internal ValueTask<EChartInstance?> GetInstanceByIdAsync(string nativeId, CancellationToken cancellationToken = default) =>
        FindInstanceAsync("id", Name(nativeId), cancellationToken);

    /// <summary>Finds an existing handle owned by this facade by its DOM container.</summary>
    public ValueTask<EChartInstance?> GetInstanceByDomAsync(ElementReference element, CancellationToken cancellationToken = default) =>
        FindInstanceAsync("dom", element, cancellationToken);

    /// <summary>Disposes a chart of this facade through its queue, as its own <see cref="EChartInstance.DisposeAsync"/>
    /// does.</summary>
    /// <remarks>A chart of an <see cref="EChart"/> component moves that component to <see cref="ChartState.Failed"/>.</remarks>
    public ValueTask DisposeChartAsync(EChartInstance chart, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(chart);
        if (chart.RuntimeOwner != this)
            throw new ArgumentException("Chart belongs to another facade.", nameof(chart));

        cancellationToken.ThrowIfCancellationRequested();
        return chart.DisposeAsync();
    }

    /// <summary>Disposes a chart of this facade identified by its native ID; an unknown ID is ignored.</summary>
    public async ValueTask DisposeChartAsync(string nativeId, CancellationToken cancellationToken = default)
    {
        var chart = await GetInstanceByIdAsync(nativeId, cancellationToken).ConfigureAwait(false);
        if (chart is not null)
            await chart.DisposeAsync().ConfigureAwait(false);
    }

    /// <summary>Disposes a chart of this facade identified by its DOM container; an element without one is ignored.</summary>
    public async ValueTask DisposeChartAsync(ElementReference element, CancellationToken cancellationToken = default)
    {
        var chart = await GetInstanceByDomAsync(element, cancellationToken).ConfigureAwait(false);
        if (chart is not null)
            await chart.DisposeAsync().ConfigureAwait(false);
    }

    private async ValueTask<EChartInstance?> FindInstanceAsync(string kind, object value, CancellationToken token)
    {
        var id = await RuntimeCallAsync<string?>("findInstance", [kind, value], token).ConfigureAwait(false);
        lock (_gate)
            return id is not null && _instances.TryGetValue(id, out var chart) ? chart : null;
    }

    private JsonElement PrepareGlobalOption(OptionObject option)
    {
        ConfigureExtensions();
        var prepared = OptionSerializer.Serialize(option, Serialization);
        if (prepared.Bindings.Count != 0)
            throw new NotSupportedException("Global bindings require the binding bridge.");

        return prepared.Json;
    }

    private static string Name(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        return name;
    }

    internal ValueTask<JsonElement> InvokeGlobalAsync(
        string method,
        object?[] arguments,
        CancellationToken token,
        Action<JsonElement>? validate = null)
    {
        ConfigureExtensions();
        var preparation = Serialization.CreatePreparation();
        var args = MethodJson.Create(w =>
        {
            w.WriteStartArray();
            for (var i = 0; i < arguments.Length; i++)
                GlobalArgument.Write(w, arguments[i], preparation, "$");

            w.WriteEndArray();
        });
        if (preparation.Bindings.Any())
            throw new NotSupportedException("Global bindings require the binding bridge.");

        validate?.Invoke(args);
        var omitted = arguments.Select((value, index) => (value, index))
            .Where(x => x.value is GlobalArgument { IsOmitted: true })
            .Select(x => x.index)
            .ToArray();
        var numbers = arguments.Select((value, index) => (value, index))
            .Where(x => GlobalArgument.TryGetNumber(x.value, out var number) && !double.IsFinite(number))
            .Select(x => x.index)
            .ToArray();
        return RuntimeCallAsync<JsonElement>("invokeGlobalMethod", [method, args, omitted, numbers], token);
    }

    internal async ValueTask<T> GlobalReadAsync<T>(
        string method,
        object?[] args,
        Func<JsonElement, T> read,
        CancellationToken token,
        Action<JsonElement>? validate = null) => read(await InvokeGlobalAsync(method, args, token, validate).ConfigureAwait(false));

    private async ValueTask GlobalVoidAsync(string method, object?[] args, CancellationToken token) =>
        await InvokeGlobalAsync(method, args, token).ConfigureAwait(false);

    private async ValueTask<T> RuntimeCallAsync<[DynamicallyAccessedMembers(JsonSerialized)] T>(
        string method,
        object?[] args,
        CancellationToken token)
    {
        await EnsureInitializedAsync(false, token).ConfigureAwait(false);
        token.ThrowIfCancellationRequested();
        BeginHandleUse();
        try
        {
            // Disposal waits for the call until actual completion, even if its caller cancels.
            var result = await WithReplyTimeoutAsync(method, _module!.InvokeAsync<T>(method, [_ownerId, .. args])).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            return result;
        }
        finally
        {
            EndHandleUse();
        }
    }
}

/// <summary>A source-defined dimension name or {name,type,displayName} definition.</summary>
internal sealed class ChartDimensionDefinition
{
    internal ChartDimensionDefinition(JsonElement json) => Json = json.Clone();

    /// <summary>Gets the exact native definition.</summary>
    public JsonElement Json { get; }

    /// <summary>Gets the dimension name from either source shape.</summary>
    public string? Name => Json.ValueKind == JsonValueKind.String ? Json.GetString() : Field("name");

    /// <summary>Gets the optional native data-store dimension type.</summary>
    public string? Type => Field("type");

    /// <summary>Gets the optional display name.</summary>
    public string? DisplayName => Field("displayName");

    private string? Field(string name) =>
        Json.ValueKind == JsonValueKind.Object && Json.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

/// <summary>The exact native getMap result, including its false SVG sentinel.</summary>
public sealed class EChartsMapResult
{
    internal EChartsMapResult(JsonElement json) => Json = json.Clone();

    /// <summary>Gets the original native result.</summary>
    public JsonElement Json { get; }

    /// <summary>Gets whether this resource has a GeoJSON result.</summary>
    public bool IsGeoJson => Json.ValueKind == JsonValueKind.Object;

    /// <summary>Gets the GeoJSON data, if supported by native getMap.</summary>
    public JsonElement? GeoJson => IsGeoJson && Json.TryGetProperty("geoJSON", out var geo) ? geo : null;

    /// <summary>Gets the special-area mapping.</summary>
    public JsonElement? SpecialAreas => IsGeoJson && Json.TryGetProperty("specialAreas", out var areas) ? areas : null;

    /// <summary>Reads the special-area mapping as typed rectangles; null for SVG resources or maps without special
    /// areas.</summary>
    /// <exception cref="JsonException">An area is not a {left, top, width?, height?} number object.</exception>
    public IReadOnlyDictionary<string, GeoSpecialArea>? GetSpecialAreas()
    {
        if (SpecialAreas is not { ValueKind: JsonValueKind.Object } areas)
            return null;

        var result = new Dictionary<string, GeoSpecialArea>(StringComparer.Ordinal);
        foreach (var area in areas.EnumerateObject())
            result.Add(area.Name, GeoSpecialArea.Read(area.Value));

        return result;
    }
}

/// <summary>The rectangle in map coordinates that a registered GeoJSON region is transformed to, as in native
/// registerMap specialAreas.</summary>
/// <param name="Left">The target left coordinate.</param>
/// <param name="Top">The target top coordinate.</param>
/// <param name="Width">The target width; when null, ECharts derives it from Height and the region aspect ratio.</param>
/// <param name="Height">The target height; when null, ECharts derives it from Width and the region aspect ratio.</param>
public sealed record GeoSpecialArea(double Left, double Top, double? Width, double? Height)
{
    internal static JsonElement ToJson(IReadOnlyDictionary<string, GeoSpecialArea> areas)
    {
        ArgumentNullException.ThrowIfNull(areas);
        foreach (var (name, area) in areas)
        {
            if (area is null)
                throw new ArgumentException($"Special area '{name}' is null.", nameof(areas));

            if (!double.IsFinite(area.Left)
                || !double.IsFinite(area.Top)
                || area.Width is { } w && !double.IsFinite(w)
                || area.Height is { } h && !double.IsFinite(h))
                throw new ArgumentException($"Special area '{name}' requires finite coordinates.", nameof(areas));

            if (area.Width is null && area.Height is null)
                throw new ArgumentException($"Special area '{name}' requires Width or Height.", nameof(areas));
        }

        return MethodJson.Create(writer =>
        {
            writer.WriteStartObject();
            foreach (var (name, area) in areas)
            {
                writer.WriteStartObject(name);
                writer.WriteNumber("left", area.Left);
                writer.WriteNumber("top", area.Top);
                if (area.Width is { } width)
                    writer.WriteNumber("width", width);

                if (area.Height is { } height)
                    writer.WriteNumber("height", height);

                writer.WriteEndObject();
            }

            writer.WriteEndObject();
        });
    }

    internal static GeoSpecialArea Read(JsonElement json)
    {
        if (json.ValueKind != JsonValueKind.Object)
            throw new JsonException("A special area must be an object.");

        return new(Required(json, "left"), Required(json, "top"), Optional(json, "width"), Optional(json, "height"));

        static double Required(JsonElement json, string name) =>
            Optional(json, name) ?? throw new JsonException($"A special area requires numeric '{name}'.");

        static double? Optional(JsonElement json, string name) =>
            !json.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null ? null
            : value.ValueKind == JsonValueKind.Number ? value.GetDouble() : throw new JsonException($"Special area '{name}' must be a number.");
    }
}
