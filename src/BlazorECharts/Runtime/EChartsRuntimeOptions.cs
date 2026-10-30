namespace BlazorECharts.Runtime;

/// <summary>Selects where the page runtime loads ECharts from.</summary>
public enum EChartsRuntimeProvider
{
    /// <summary>The ECharts module of the package. <see cref="EChartsRuntimeOptions.ModuleUrl"/> and
    /// <see cref="EChartsRuntimeOptions.ExportName"/> stay unset.</summary>
    Local,

    /// <summary>An ESM module at <see cref="EChartsRuntimeOptions.ModuleUrl"/> whose namespace, or export
    /// <see cref="EChartsRuntimeOptions.ExportName"/>, is ECharts.</summary>
    Module,

    /// <summary>A module at <see cref="EChartsRuntimeOptions.ModuleUrl"/> whose <c>load()</c> export, or export
    /// <see cref="EChartsRuntimeOptions.ExportName"/>, returns ECharts asynchronously.</summary>
    Custom,
}

/// <summary>Configures a page runtime before its first use. Relative URLs use the application base URI.</summary>
public sealed class EChartsRuntimeOptions
{
    private readonly object _gate = new();
    private bool _frozen;
    private string _version = "6.1.0";
    private EChartsRuntimeProvider _provider = EChartsRuntimeProvider.Local;
    private string? _moduleUrl;
    private string? _exportName;
    private IReadOnlyList<IChartExtension> _extensions = [];
    private bool _allowInlineJavaScript;
    private long? _maximumServerResultSize = 32 * 1024;

    /// <summary>Gets or sets the largest browser result, in bytes, that an Interactive Server circuit may send to .NET;
    /// default 32 KiB, the SignalR default.</summary>
    /// <remarks>Set it to the hub's <c>HubOptions.MaximumReceiveMessageSize</c>. A larger result, such as a big
    /// <c>GetOptionAsync</c> snapshot,
    /// fails with <c>ResultTooLarge</c> instead of closing the circuit. Null disables the check. WebAssembly ignores
    /// it.</remarks>
    public long? MaximumServerResultSize
    {
        get => _maximumServerResultSize;
        set
        {
            if (value is <= 0)
                throw new ArgumentOutOfRangeException(nameof(value), value, "The result size limit must be positive, or null for no limit.");

            lock (_gate)
            {
                EnsureWritable();
                _maximumServerResultSize = value;
            }
        }
    }

    /// <summary>Allows explicit inline function descriptors. Requires a CSP permitting unsafe-eval; default false.</summary>
    public bool AllowInlineJavaScript
    {
        get => _allowInlineJavaScript;
        set
        {
            lock (_gate)
            {
                EnsureWritable();
                _allowInlineJavaScript = value;
            }
        }
    }

    /// <summary>Gets or sets the exact version the loaded ECharts must report; default 6.1.0, the packaged and tested
    /// version.</summary>
    /// <remarks>An escape hatch for a <see cref="EChartsRuntimeProvider.Module"/> or
    /// <see cref="EChartsRuntimeProvider.Custom"/> build of another version:
    /// the typed API still describes ECharts 6.1.0, and a runtime that reports another version fails with
    /// <c>RuntimeVersionMismatch</c>.</remarks>
    public string Version
    {
        get => _version;
        set
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(value);
            lock (_gate)
            {
                EnsureWritable();
                _version = value;
            }
        }
    }

    /// <summary>Gets or sets where ECharts is loaded from; default <see cref="EChartsRuntimeProvider.Local"/>.</summary>
    public EChartsRuntimeProvider Provider
    {
        get => _provider;
        set
        {
            if (!Enum.IsDefined(value))
                throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown runtime provider.");

            lock (_gate)
            {
                EnsureWritable();
                _provider = value;
            }
        }
    }

    /// <summary>Gets or sets the module URL of the <see cref="EChartsRuntimeProvider.Module"/> and
    /// <see cref="EChartsRuntimeProvider.Custom"/> providers.</summary>
    public string? ModuleUrl
    {
        get => _moduleUrl;
        set
        {
            NullOrText(value);
            lock (_gate)
            {
                EnsureWritable();
                _moduleUrl = value;
            }
        }
    }

    /// <summary>Gets or sets a named runtime export, or the custom provider load function name.</summary>
    public string? ExportName
    {
        get => _exportName;
        set
        {
            NullOrText(value);
            lock (_gate)
            {
                EnsureWritable();
                _exportName = value;
            }
        }
    }

    /// <summary>Gets or sets page extensions. Descriptors are copied at first use.</summary>
    public IReadOnlyList<IChartExtension> Extensions
    {
        get => _extensions;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            lock (_gate)
            {
                EnsureWritable();
                _extensions = value;
            }
        }
    }

    private RuntimeConfiguration? _configuration;

    internal RuntimeConfiguration Freeze()
    {
        lock (_gate)
        {
            if (_configuration is not null)
                return _configuration;

            if (_provider != EChartsRuntimeProvider.Local && _moduleUrl is null)
                throw new ArgumentException($"The {_provider} provider requires ModuleUrl.");

            if (_provider == EChartsRuntimeProvider.Local && (_moduleUrl is not null || _exportName is not null))
                throw new ArgumentException("Local assets cannot override module URL or export name.");

            var extensions = _extensions.Select(extension => new ExtensionConfiguration(extension.Id, extension.Version,
                extension.Dependencies.ToArray(), extension.ModuleUrl)).ToArray();
            var provider = _provider switch { EChartsRuntimeProvider.Module => "module", EChartsRuntimeProvider.Custom => "custom", _ => "local" };
            _configuration = new(_version, provider, _moduleUrl, _exportName, extensions, _allowInlineJavaScript);
            _frozen = true;
            return _configuration;
        }
    }

    private static void NullOrText(string? value)
    {
        if (value is not null)
            ArgumentException.ThrowIfNullOrWhiteSpace(value);
    }

    private void EnsureWritable()
    {
        if (_frozen)
            throw new InvalidOperationException("Runtime configuration cannot change after first use.");
    }
}

internal sealed record ExtensionConfiguration(string Id, string Version, string[] Dependencies, string ModuleUrl);

internal sealed record RuntimeConfiguration(
    string Version,
    string Provider,
    string? ModuleUrl,
    string? ExportName,
    ExtensionConfiguration[] Extensions,
    bool AllowInlineJavaScript);
