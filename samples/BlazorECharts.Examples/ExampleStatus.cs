namespace BlazorECharts.Examples;

/// <summary>The visible state of an example.</summary>
public enum ExampleState
{
    /// <summary>The runtime, layout or a registration is still pending.</summary>
    Loading,

    /// <summary>Every chart of the example has a stable layout.</summary>
    Ready,

    /// <summary>Initialization or an operation failed.</summary>
    Error,
}

/// <summary>An example state with an optional message.</summary>
public sealed record ExampleStatus(ExampleState State, string? Message = null)
{
    /// <summary>Gets the initial loading status.</summary>
    public static ExampleStatus Loading { get; } = new(ExampleState.Loading);
}
