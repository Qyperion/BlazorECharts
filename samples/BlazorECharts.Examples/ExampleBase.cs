using BlazorECharts.Options;
using BlazorECharts.Runtime;
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

namespace BlazorECharts.Examples;

/// <summary>Base class of interactive examples: renderer selection, accessibility defaults and status reporting.</summary>
public abstract class ExampleBase : ComponentBase
{
    private const string PageVisibilityModule = "_content/BlazorECharts.Examples/catalog/page-visibility.js";

    private static readonly ChartStabilityOptions Stability = new() { Timeout = TimeSpan.FromSeconds(30) };

    [Inject] private IJSRuntime Scripts { get; set; } = default!;

    /// <summary>Gets or sets the example being rendered.</summary>
    [Parameter, EditorRequired] public ExampleDescriptor Descriptor { get; set; } = default!;

    /// <summary>Gets or sets the ECharts renderer, <c>canvas</c> or <c>svg</c>. A change remounts the example.</summary>
    [Parameter] public string Renderer { get; set; } = "canvas";

    /// <summary>Gets or sets the ECharts theme of an example that renders its options directly, such as <c>dark</c>; null
    /// is the default theme. Interactive examples choose their own theme. A change remounts the example.</summary>
    [Parameter] public string? Theme { get; set; }

    /// <summary>Receives loading, ready and error states.</summary>
    [Parameter] public EventCallback<ExampleStatus> StatusChanged { get; set; }

    /// <summary>Gets the initialization options for the selected renderer.</summary>
    protected ChartInitOptions InitOptions { get; private set; } = new();

    /// <inheritdoc />
    protected override void OnInitialized() => InitOptions = new ChartInitOptions { Renderer = Renderer };

    /// <summary>Enables the ECharts accessibility description unless the example configured it.</summary>
    protected static ChartOptions Accessible(ChartOptions options)
    {
        // ECharts ignores the root components of an option that declares a base option, as timeline and media charts do.
        var target = options.BaseOption ?? options;
        target.Aria ??= new AriaOption { Enabled = true };
        return options;
    }

    /// <summary>Reports ready once the chart has a stable layout.</summary>
    protected Task ReadyAsync(EChartInstance chart) => ReadyAsync([chart]);

    /// <summary>Reports ready once every chart has a stable layout. On a hidden page the wait continues after the page
    /// is shown.</summary>
    protected async Task ReadyAsync(IReadOnlyList<EChartInstance> charts)
    {
        if (Descriptor.ContinuousAnimation)
        {
            await ReportAsync(new ExampleStatus(ExampleState.Ready, "the effect animation runs continuously, so the layout never settles"));
            return;
        }

        try
        {
            await using var visibility = await Scripts.InvokeAsync<IJSObjectReference>("import", $"./{Assets[PageVisibilityModule]}");
            foreach (var chart in charts)
                await AwaitStableAsync(chart, visibility);

            await ReportAsync(new ExampleStatus(ExampleState.Ready));
        }
        catch (ObjectDisposedException)
        {
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception error)
        {
            await ReportAsync(new ExampleStatus(ExampleState.Error, error.Message));
        }
    }

    // A hidden page gets no animation frames, so a stability timeout there waits for the page to be shown and tries again.
    private static async Task AwaitStableAsync(EChartInstance chart, IJSObjectReference visibility)
    {
        while (true)
        {
            var started = await visibility.InvokeAsync<double>("mark");
            try
            {
                await chart.AwaitStableAsync(Stability);
                return;
            }
            catch (TimeoutException)
            {
                if (!await visibility.InvokeAsync<bool>("hiddenSince", started))
                    throw;
            }

            // Without its own token, the call fails after the one-minute JS interop timeout of Blazor Server.
            await visibility.InvokeVoidAsync("whenVisible", CancellationToken.None);
        }
    }

    /// <summary>Reports a library error.</summary>
    protected Task FailAsync(EChartsError error) => ReportAsync(new ExampleStatus(ExampleState.Error, $"{error.Code}: {error.Message}"));

    /// <summary>Reports an operation failure.</summary>
    protected Task FailAsync(Exception error) => ReportAsync(new ExampleStatus(ExampleState.Error, error.Message));

    /// <summary>Runs an operation, reporting its failure instead of throwing into the renderer.</summary>
    protected async Task RunAsync(Func<Task> operation)
    {
        try
        {
            await operation();
        }
        catch (ObjectDisposedException)
        {
        }
        catch (Exception error)
        {
            await FailAsync(error);
        }
    }

    private Task ReportAsync(ExampleStatus status) => StatusChanged.InvokeAsync(status);
}
