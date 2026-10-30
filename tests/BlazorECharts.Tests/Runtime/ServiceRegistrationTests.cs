using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class ServiceRegistrationTests
{
    [Fact]
    public void AddECharts_OverOptionsFromAFactory_Throws()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(_ => new EChartsRuntimeOptions());

        // Act
        var error = Assert.Throws<InvalidOperationException>(() => services.AddECharts(options => options.AllowInlineJavaScript = true));

        // Assert
        Assert.Contains(nameof(EChartsRuntimeOptions), error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void AddECharts_IgnoresKeyedOptions_AndConfiguresTheRegisteredInstance()
    {
        // Arrange
        var services = new ServiceCollection();
        var registered = new EChartsRuntimeOptions();
        var keyed = new EChartsRuntimeOptions();
        services.AddSingleton(registered);
        services.AddKeyedSingleton("reports", keyed);

        // Act
        var builder = services.AddECharts(options => options.AllowInlineJavaScript = true);
        using var provider = services.BuildServiceProvider();

        // Assert
        Assert.Same(registered, builder.Options);
        Assert.Same(registered, provider.GetRequiredService<EChartsRuntimeOptions>());
        Assert.True(registered.AllowInlineJavaScript);
        Assert.False(keyed.AllowInlineJavaScript);
    }

    [Fact]
    public void AddECharts_WithOnlyKeyedOptions_RegistersItsOwnInstance()
    {
        // Arrange
        var services = new ServiceCollection();
        var keyed = new EChartsRuntimeOptions();
        services.AddKeyedSingleton("reports", keyed);

        // Act
        var builder = services.AddECharts(options => options.AllowInlineJavaScript = true);
        using var provider = services.BuildServiceProvider();

        // Assert
        Assert.NotSame(keyed, builder.Options);
        Assert.Same(builder.Options, provider.GetRequiredService<EChartsRuntimeOptions>());
        Assert.True(builder.Options.AllowInlineJavaScript);
        Assert.Same(keyed, provider.GetRequiredKeyedService<EChartsRuntimeOptions>("reports"));
    }

    [Fact]
    public async Task SynchronousScopeDisposal_ReleasesTheRuntime()
    {
        // Arrange
        var js = new Browser();
        var services = new ServiceCollection();
        services.AddSingleton<IJSRuntime>(js);
        services.AddSingleton<NavigationManager>(new TestNavigation());
        services.AddECharts();
        using var provider = services.BuildServiceProvider();
        var scope = provider.CreateScope();
        var runtime = scope.ServiceProvider.GetRequiredService<EChartsRuntime>();
        await runtime.InitializeAsync();

        // Act
        scope.Dispose();

        // Assert
        Assert.Throws<ObjectDisposedException>(() => runtime.InitializeAsync());
        await runtime.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(1, js.FacadeReleases);
    }

    private sealed class TestNavigation : NavigationManager
    {
        public TestNavigation() => Initialize("https://example.test/", "https://example.test/");
    }

    private sealed class Browser : IJSRuntime, IJSObjectReference
    {
        public int FacadeReleases;

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args) => InvokeAsync<TValue>(identifier, default, args);

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args)
        {
            if (identifier == "releaseFacade")
                Interlocked.Increment(ref FacadeReleases);

            object? result = identifier switch { "import" => this, "openFacade" => "page", _ => null };
            return ValueTask.FromResult((TValue)result!);
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
