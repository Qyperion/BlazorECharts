using System.Text.Json;

namespace BlazorECharts.Events;

/// <summary>A pointer event of the ZRender surface of a chart: the plain fields of a ZRender <c>ElementEvent</c>.</summary>
/// <remarks>ZRender raises it anywhere on the chart, also where ECharts raises no component event, such as on the cover of
/// a brush selection or above a bar. Map the position to data with <c>ContainPixelAsync</c> and
/// <c>ConvertFromPixelAsync</c>. The native event and the target element stay in the browser.</remarks>
public sealed class ZrEvent(JsonElement json) : ChartEventPayload(json)
{
    /// <summary>Gets the ZRender event type, such as <c>click</c>.</summary>
    public string? Type => Text("type");

    /// <summary>Gets the horizontal pointer position relative to the chart container, in CSS pixels.</summary>
    public double OffsetX => Number("offsetX") ?? double.NaN;

    /// <summary>Gets the vertical pointer position relative to the chart container, in CSS pixels.</summary>
    public double OffsetY => Number("offsetY") ?? double.NaN;

    /// <summary>Gets <c>MouseEvent.button</c>: 0 for the main button, 1 for the wheel, 2 for the secondary button; null
    /// for a touch.</summary>
    public int? Button => Integer("button");

    /// <summary>Gets whether Control was held.</summary>
    public bool CtrlKey => Boolean("ctrlKey") == true;

    /// <summary>Gets whether Shift was held.</summary>
    public bool ShiftKey => Boolean("shiftKey") == true;

    /// <summary>Gets whether Alt was held.</summary>
    public bool AltKey => Boolean("altKey") == true;

    /// <summary>Gets whether the Meta key (Command, Windows) was held.</summary>
    public bool MetaKey => Boolean("metaKey") == true;

    /// <summary>Gets the ZRender wheel delta of <c>mousewheel</c>: positive when the wheel turns away from the user; 0 for
    /// other events.</summary>
    public double WheelDelta => Number("wheelDelta") ?? 0;

    /// <summary>Gets whether a touch produced the event.</summary>
    public bool ByTouch => Boolean("byTouch") == true;

    /// <summary>Gets whether the pointer is over a ZRender element, such as a bar, a label or the brush cover.</summary>
    public bool HasTarget => Boolean("hasTarget") == true;
}
