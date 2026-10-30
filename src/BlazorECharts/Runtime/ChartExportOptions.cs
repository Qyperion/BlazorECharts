using System.Text.Json;
using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Runtime;

/// <summary>Image formats declared by ECharts 6.1.0. SVG requires the SVG renderer; PNG/JPEG require Canvas.</summary>
public enum ChartImageFormat
{
    /// <summary>PNG, Canvas renderer only.</summary>
    Png,

    /// <summary>JPEG, Canvas renderer only.</summary>
    Jpeg,

    /// <summary>SVG, SVG renderer only.</summary>
    Svg,
}

/// <summary>Native renderToCanvas settings. The result is an independently retained browser canvas.</summary>
public sealed class ChartCanvasExportOptions : IOptionValue
{
    /// <summary>Gets or sets the export background using the native ZRColor contract.</summary>
    public ZRColor? BackgroundColor { get; set; }

    /// <summary>Gets or sets the native pixel ratio. Omission uses the renderer default.</summary>
    public double? PixelRatio { get; set; }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        writer.WriteStartObject();
        ExportJson.WriteCanvas(writer, context, path, BackgroundColor, PixelRatio);
        writer.WriteEndObject();
    }
}

/// <summary>Native getDataURL options. An omitted format follows the current renderer.</summary>
public sealed class ChartDataUrlOptions : IOptionValue
{
    /// <summary>Gets or sets the export background using the native ZRColor contract.</summary>
    public ZRColor? BackgroundColor { get; set; }

    /// <summary>Gets or sets the native pixel ratio. Omission uses the renderer default.</summary>
    public double? PixelRatio { get; set; }

    /// <summary>Gets or sets PNG, JPEG or SVG.</summary>
    public ChartImageFormat? Type { get; set; }

    /// <summary>Gets or sets component main types to exclude during native capture.</summary>
    public string[]? ExcludeComponents { get; set; }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        writer.WriteStartObject();
        ExportJson.WriteDataUrl(writer, context, path, BackgroundColor, PixelRatio, Type, ExcludeComponents);
        writer.WriteEndObject();
    }
}

/// <summary>Native getConnectedDataURL options. Every included chart must support the selected format.</summary>
public sealed class ChartConnectedDataUrlOptions : IOptionValue
{
    /// <summary>Gets or sets the export background using the native ZRColor contract.</summary>
    public ZRColor? BackgroundColor { get; set; }

    /// <summary>Gets or sets the native pixel ratio. Omission uses the renderer default.</summary>
    public double? PixelRatio { get; set; }

    /// <summary>Gets or sets PNG, JPEG or SVG.</summary>
    public ChartImageFormat? Type { get; set; }

    /// <summary>Gets or sets component main types to exclude during native capture. ECharts 6.1.0 ignores them for
    /// connected exports.</summary>
    public string[]? ExcludeComponents { get; set; }

    /// <summary>Gets or sets the background between connected charts.</summary>
    public ZRColor? ConnectedBackgroundColor { get; set; }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        writer.WriteStartObject();
        ExportJson.WriteDataUrl(writer, context, path, BackgroundColor, PixelRatio, Type, ExcludeComponents);
        if (ConnectedBackgroundColor.HasValue)
            context.WritePropertyValue(writer, ConnectedBackgroundColor.Value, path, "connectedBackgroundColor");

        writer.WriteEndObject();
    }
}

internal static class ExportJson
{
    internal static void WriteCanvas(
        Utf8JsonWriter writer,
        EChartsSerializationContext context,
        string path,
        ZRColor? backgroundColor,
        double? pixelRatio)
    {
        if (backgroundColor.HasValue)
            context.WritePropertyValue(writer, backgroundColor.Value, path, "backgroundColor");

        if (pixelRatio.HasValue)
            EChartsSerializationContext.WriteFiniteNumber(writer, "pixelRatio", pixelRatio.Value, path);
    }

    internal static void WriteDataUrl(
        Utf8JsonWriter writer,
        EChartsSerializationContext context,
        string path,
        ZRColor? backgroundColor,
        double? pixelRatio,
        ChartImageFormat? type,
        string[]? excludeComponents)
    {
        WriteCanvas(writer, context, path, backgroundColor, pixelRatio);
        if (type.HasValue)
            writer.WriteString(
                "type",
                type.Value switch
                {
                    ChartImageFormat.Png => "png",
                    ChartImageFormat.Jpeg => "jpeg",
                    ChartImageFormat.Svg => "svg",
                    _ => throw new ArgumentOutOfRangeException(nameof(type)),
                });

        if (excludeComponents is not null)
            context.WritePropertyValue(writer, excludeComponents, path, "excludeComponents");
    }
}

/// <summary>Native renderToSVGString settings.</summary>
public sealed class ChartSvgExportOptions : IOptionValue
{
    /// <summary>Gets or sets whether the SVG has a viewBox.</summary>
    public bool? UseViewBox { get; set; }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        writer.WriteStartObject();
        if (UseViewBox.HasValue)
            writer.WriteBoolean("useViewBox", UseViewBox.Value);

        writer.WriteEndObject();
    }
}
