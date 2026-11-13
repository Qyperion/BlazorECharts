namespace BlazorECharts.Values.Signatures;

/// <summary>Marks a browser event handler with the parameters <c>event</c>, the native ECharts event, and
/// <c>chart</c>, the native ECharts instance.</summary>
public readonly struct ChartEventHandlerSignature : IJsFunctionSignature
{
    /// <summary>Gets the stable signature identifier.</summary>
    public static string Id => "runtime:chart-event-handler";
}
