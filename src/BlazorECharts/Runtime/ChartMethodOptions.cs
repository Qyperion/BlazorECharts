using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Runtime;

/// <summary>Native ResizeOpts from ECharts 6.1.0.</summary>
public sealed class ChartResizeOptions : IOptionValue
{
    /// <summary>Gets or sets a number or 'auto'.</summary>
    public EventActionValue? Width { get; set; }

    /// <summary>Gets or sets a number or 'auto'.</summary>
    public EventActionValue? Height { get; set; }

    /// <summary>Gets or sets native resize animation settings.</summary>
    public ChartPayloadAnimation? Animation { get; set; }

    /// <summary>Gets or sets event suppression.</summary>
    public bool? Silent { get; set; }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        Width?.Validate("number|auto");
        Height?.Validate("number|auto");
        writer.WriteStartObject();
        if (Width is { } w)
        {
            writer.WritePropertyName("width");
            w.Json.WriteTo(writer);
        }

        if (Height is { } h)
        {
            writer.WritePropertyName("height");
            h.Json.WriteTo(writer);
        }

        if (Silent.HasValue)
            writer.WriteBoolean("silent", Silent.Value);

        if (Animation is not null)
            context.WritePropertyValue(writer, Animation, path, "animation");

        writer.WriteEndObject();
    }
}

/// <summary>Native setTheme settings.</summary>
public sealed class ChartSetThemeOptions : IOptionValue
{
    /// <summary>Gets or sets event suppression.</summary>
    public bool? Silent { get; set; }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        writer.WriteStartObject();
        if (Silent.HasValue)
            writer.WriteBoolean("silent", Silent.Value);

        writer.WriteEndObject();
    }
}

/// <summary>Options of the built-in default loading effect of <c>showLoading</c>. Custom effects can use the JSON
/// overload.</summary>
public sealed class ChartLoadingOptions : IOptionValue
{
    /// <summary>Gets or sets the loading text.</summary>
    public string? Text { get; set; }

    /// <summary>Gets or sets the spinner color.</summary>
    public string? Color { get; set; }

    /// <summary>Gets or sets the text color.</summary>
    public string? TextColor { get; set; }

    /// <summary>Gets or sets the overlay color.</summary>
    public string? MaskColor { get; set; }

    /// <summary>Gets or sets the font size.</summary>
    public double? FontSize { get; set; }

    /// <summary>Gets or sets a numeric or string font weight.</summary>
    public EventActionValue? FontWeight { get; set; }

    /// <summary>Gets or sets the font style.</summary>
    public string? FontStyle { get; set; }

    /// <summary>Gets or sets the font family.</summary>
    public string? FontFamily { get; set; }

    /// <summary>Gets or sets spinner visibility.</summary>
    public bool? ShowSpinner { get; set; }

    /// <summary>Gets or sets the spinner radius.</summary>
    public double? SpinnerRadius { get; set; }

    /// <summary>Gets or sets the spinner line width.</summary>
    public double? LineWidth { get; set; }

    /// <summary>Gets or sets the loading effect zlevel.</summary>
    public double? Zlevel { get; set; }

    void IOptionValue.Write(Utf8JsonWriter w, EChartsSerializationContext context, string path)
    {
        FontWeight?.Validate("number|string");
        w.WriteStartObject();
        if (Text is not null)
            w.WriteString("text", Text);

        if (Color is not null)
            w.WriteString("color", Color);

        if (TextColor is not null)
            w.WriteString("textColor", TextColor);

        if (MaskColor is not null)
            w.WriteString("maskColor", MaskColor);

        if (FontSize.HasValue)
            EChartsSerializationContext.WriteFiniteNumber(w, "fontSize", FontSize.Value, path);

        if (FontWeight is { } weight)
        {
            w.WritePropertyName("fontWeight");
            weight.Json.WriteTo(w);
        }

        if (FontStyle is not null)
            w.WriteString("fontStyle", FontStyle);

        if (FontFamily is not null)
            w.WriteString("fontFamily", FontFamily);

        if (ShowSpinner.HasValue)
            w.WriteBoolean("showSpinner", ShowSpinner.Value);

        if (SpinnerRadius.HasValue)
            EChartsSerializationContext.WriteFiniteNumber(w, "spinnerRadius", SpinnerRadius.Value, path);

        if (LineWidth.HasValue)
            EChartsSerializationContext.WriteFiniteNumber(w, "lineWidth", LineWidth.Value, path);

        if (Zlevel.HasValue)
            EChartsSerializationContext.WriteFiniteNumber(w, "zlevel", Zlevel.Value, path);

        w.WriteEndObject();
    }
}

/// <summary>Native matrix clamp modes for coordinate conversion; serialized as their numeric values.</summary>
public enum ChartMatrixClamp
{
    /// <summary>Out-of-range or missing parts produce NaN.</summary>
    None = 0,

    /// <summary>Clamps within the entire matrix.</summary>
    All = 1,

    /// <summary>Clamps within the matrix body.</summary>
    Body = 2,

    /// <summary>Clamps within the matrix corner.</summary>
    Corner = 3,
}

/// <summary>The optional third argument of convertToPixel, convertFromPixel and convertToLayout. ECharts 6.1.0
/// coordinate systems other than matrix ignore it.</summary>
public sealed class ChartConvertOptions : IOptionValue
{
    /// <summary>Gets or sets how out-of-range matrix coordinates are clamped.</summary>
    public ChartMatrixClamp? Clamp { get; set; }

    /// <summary>Gets or sets whether a result intersecting merged cells is not expanded to cover them.</summary>
    public bool? IgnoreMergeCells { get; set; }

    internal ChartConvertOptions Validated()
    {
        if (Clamp is { } clamp && !Enum.IsDefined(clamp))
            throw new ArgumentOutOfRangeException(nameof(Clamp), clamp, "Unknown matrix clamp mode.");

        return this;
    }

    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)
    {
        Validated();
        writer.WriteStartObject();
        if (Clamp is { } value)
            writer.WriteNumber("clamp", (int)value);

        if (IgnoreMergeCells.HasValue)
            writer.WriteBoolean("ignoreMergeCells", IgnoreMergeCells.Value);

        writer.WriteEndObject();
    }
}
