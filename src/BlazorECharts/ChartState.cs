namespace BlazorECharts;

/// <summary>The initialization and disposal state of an <see cref="EChart"/>.</summary>
public enum ChartState
{
    /// <summary>Waiting for interactive rendering and an option input.</summary>
    NotInitialized,

    /// <summary>Waiting for the runtime, container size, or initial option application.</summary>
    Initializing,

    /// <summary>The native instance and initial options are ready. Animation or layout may still be running.</summary>
    Ready,

    /// <summary>Initialization failed. Call InitializeAsync to retry explicitly.</summary>
    Failed,

    /// <summary>Releasing this component's resources.</summary>
    Disposing,

    /// <summary>The component has been disposed.</summary>
    Disposed,
}
