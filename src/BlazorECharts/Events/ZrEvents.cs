namespace BlazorECharts.Events;

/// <summary>Pointer events of the ZRender surface of a chart, for <c>EChartInstance.SubscribeAsync</c>.</summary>
/// <remarks>A subscription listens on <c>chart.getZr()</c> and moves to the new ZRender when the chart is recreated. It
/// takes no query; <see cref="EventQuery.Throttled"/> sets a throttle, which <see cref="MouseMove"/> usually needs.</remarks>
public static class ZrEvents
{
    internal const string Prefix = "zr:";

    /// <summary>Subscribes to the ZRender <c>click</c>. ZRender drops it after a drag of more than 4 pixels.</summary>
    public static ChartEvent<ZrEvent> Click { get; } = Create("click");

    /// <summary>Subscribes to the ZRender <c>dblclick</c>.</summary>
    public static ChartEvent<ZrEvent> DoubleClick { get; } = Create("dblclick");

    /// <summary>Subscribes to the ZRender <c>mousedown</c>.</summary>
    public static ChartEvent<ZrEvent> MouseDown { get; } = Create("mousedown");

    /// <summary>Subscribes to the ZRender <c>mouseup</c>.</summary>
    public static ChartEvent<ZrEvent> MouseUp { get; } = Create("mouseup");

    /// <summary>Subscribes to the ZRender <c>mousemove</c>.</summary>
    public static ChartEvent<ZrEvent> MouseMove { get; } = Create("mousemove");

    /// <summary>Subscribes to the ZRender <c>mousewheel</c>.</summary>
    public static ChartEvent<ZrEvent> MouseWheel { get; } = Create("mousewheel");

    /// <summary>Subscribes to the ZRender <c>contextmenu</c>.</summary>
    public static ChartEvent<ZrEvent> ContextMenu { get; } = Create("contextmenu");

    private static ChartEvent<ZrEvent> Create(string name) => new(Prefix + name, json => new ZrEvent(json));
}
