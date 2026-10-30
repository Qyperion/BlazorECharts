using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;

namespace BlazorECharts.Runtime;

/// <summary>Holds service registrations for ECharts and consumer extension integrations.</summary>
public sealed class EChartsBuilder
{
    internal EChartsBuilder(IServiceCollection services, EChartsRuntimeOptions options)
    {
        Services = services;
        Options = options;
    }

    /// <summary>Gets the configured services.</summary>
    public IServiceCollection Services { get; }

    /// <summary>Gets runtime configuration, writable until first use.</summary>
    public EChartsRuntimeOptions Options { get; }

    /// <summary>Adds a page-owned JS module and its matching managed serialization registrations before first use.</summary>
    public EChartsBuilder AddExtension(IChartExtension extension)
    {
        ArgumentNullException.ThrowIfNull(extension);
        Options.Extensions = [.. Options.Extensions, extension];
        return this;
    }
}

/// <summary>Registers a scoped facade over the shared browser page runtime.</summary>
public static class EChartsServiceCollectionExtensions
{
    /// <summary>Adds ECharts with pinned local assets by default.</summary>
    public static EChartsBuilder AddECharts(this IServiceCollection services, Action<EChartsRuntimeOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        // The application resolves the last unkeyed registration; only an instance can be configured here.
        var descriptor = services.LastOrDefault(item => item.ServiceType == typeof(EChartsRuntimeOptions) && !item.IsKeyedService);
        var options = descriptor is null
            ? new EChartsRuntimeOptions()
            : descriptor.ImplementationInstance as EChartsRuntimeOptions
                ?? throw new InvalidOperationException(
                    "EChartsRuntimeOptions is registered with a factory or an implementation type, so AddECharts cannot "
                    + "configure the options that the application resolves. Register an EChartsRuntimeOptions instance, or let AddECharts register it.");
        configure?.Invoke(options);

        services.TryAddSingleton(options);
        services.TryAddScoped(provider => new EChartsRuntime(
            provider.GetRequiredService<IJSRuntime>(),
            provider.GetRequiredService<NavigationManager>(),
            provider.GetRequiredService<EChartsRuntimeOptions>())
        {
            Loggers = provider.GetService<ILoggerFactory>(),
        });
        return new(services, options);
    }
}
