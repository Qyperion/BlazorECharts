using System.Text.RegularExpressions;
using BlazorECharts.Options;

namespace DocumentationExamples.Guides;

internal static class SecurityExamples
{
    internal static TitleOption Title(string productName, string? productUrl)
    {
        // snippet: Guides.Security.Links
        // ECharts opens title and node links with window.open: accept only absolute http(s) URLs.
        static string? SafeLink(string? url) =>
            Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
                ? uri.AbsoluteUri
                : null;

        var title = new TitleOption { Text = productName, Link = SafeLink(productUrl), Target = "blank" };
        // endsnippet
        return title;
    }

    internal static PieDataItemOption TagItem(string tag, int count, string? userColor)
    {
        // snippet: Guides.Security.Colors
        // Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() and named colors; anything else falls back to the palette.
        static string? SafeColor(string? color) =>
            color is not null && Regex.IsMatch(color,
                @"^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d{1,3}%?(\s*,\s*\d{1,3}%?){2}(\s*,\s*(0|1|0?\.\d+))?\s*\)|[a-zA-Z]{3,20})$")
                ? color
                : null;

        var item = new PieDataItemOption
        {
            Name = tag,
            Value = count,
            ItemStyle = SafeColor(userColor) is { } color ? new() { Color = color } : null,
        };
        // endsnippet
        return item;
    }

    internal static TooltipOption PlainTooltip()
    {
        // snippet: Guides.Security.RichText
        // Draws the tooltip on the chart instead of inserting HTML into the page.
        var tooltip = new TooltipOption { Trigger = "item", RenderMode = "richText" };
        // endsnippet
        return tooltip;
    }
}
