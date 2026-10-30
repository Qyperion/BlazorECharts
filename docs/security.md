# Security

Razor encodes every value it renders, but a chart is drawn by ECharts in the browser. Some
ECharts features insert strings into the page as HTML or open URLs, and callbacks are code. This
page lists those places and the Content Security Policy that charts need.

## HTML in tooltips and data views

ECharts draws text on the canvas or into SVG, where it is never HTML, with these exceptions:

| Feature | What becomes HTML |
|---|---|
| Default tooltip (`Tooltip.RenderMode` `"html"`, the default) | The color of the item, in the `style` of the tooltip arrow, when the tooltip has an arrow: `Tooltip.Position` is `"top"`, `"bottom"`, `"left"` or `"right"`, or `ShowTipAction` shows the tooltip of a data item. ECharts encodes series names, data names and values, including the result of `ValueFormatter`. |
| `Tooltip.Formatter` as a string template | The template itself. ECharts encodes the values it substitutes for `{a}`, `{b}`, `{c}` and the other placeholders. |
| `Tooltip.Formatter` as a function | The string the function returns, unchanged. |
| A tooltip shown by `ShowTipAction` at `x` and `y` with its own `tooltip` object | Its `content`, unless `encodeHTMLContent` is `true`, and its `formatter`, always: `encodeHTMLContent` encodes only `content`, and the formatter stays an HTML template. |
| Toolbox data view (`ToolboxDataViewFeatureOption`) | `Title`, the `Lang` strings and the string that `OptionToContent` returns. |

So a function formatter must encode every value that comes from data: series and item names,
category labels, and anything else a user can enter. Use `encodeHTML` of the page's ECharts
instance in your callback module:

```javascript
// wwwroot/js/chart-callbacks.js
import { getECharts } from '../_content/BlazorECharts/js/blazor-echarts.js';

export function messagesTooltip(params) {
  const encode = text => getECharts().format.encodeHTML(String(text));
  return params.map(item => `${item.marker}${encode(item.seriesName)}: ${encode(item.value)}`).join('<br/>');
}
```

Never build a string template (`Formatter = "..."`) from user input: the template is HTML. To
avoid HTML entirely, draw the tooltip on the chart:

<!-- snippet: Guides.Security.RichText -->
```csharp
// Draws the tooltip on the chart instead of inserting HTML into the page.
var tooltip = new TooltipOption { Trigger = "item", RenderMode = "richText" };
```

### Colors and fonts from data

ECharts writes colors and font families into `style` attributes and CSS of the HTML tooltip.
The arrow of the default tooltip takes the color of the item without encoding, so a color such as
`red"><img src=x onerror=...>` inserts markup. Accept a color or a `FontFamily` that users can
set, for example the color of a tag or a category, only after validating it:

<!-- snippet: Guides.Security.Colors -->
```csharp
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
```

Validate a font family the same way, for example against a list of fonts that your application
offers.

## Links

`TitleOption.Link`, `TitleOption.Sublink` and the `link` of sunburst and treemap data items (with
`NodeClick = "link"`) are opened with `window.open` when the user clicks them. ECharts does not check the URL scheme, so a
`javascript:` URL runs script in your page. Accept only absolute `http` and `https` URLs:

<!-- snippet: Guides.Security.Links -->
```csharp
// ECharts opens title and node links with window.open: accept only absolute http(s) URLs.
static string? SafeLink(string? url) =>
    Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        ? uri.AbsoluteUri
        : null;

var title = new TitleOption { Text = productName, Link = SafeLink(productUrl), Target = "blank" };
```

## Inline functions

`JsFunction.Inline` compiles its source in the browser; it is code, not data. Write inline sources
yourself, never build them from user input, configuration that users can change, or a database.
Inline functions are off unless the host sets `AllowInlineJavaScript` (see
[JavaScript functions](functions.md#inline-functions)). Prefer
[module functions](functions.md#module-functions), which receive data as arguments.

The library never evaluates other strings as JavaScript: a formatter written as a string is a
template, and `RawOptions` passes JSON through as data. Strings that ECharts inserts as HTML or
opens as URLs, listed above, can still run script.

## SVG export

`RenderToSvgStringAsync` returns SVG markup as ECharts writes it. ZRender encodes text, but
writes attribute values such as colors unchanged, so a color from data can add an event handler
attribute to an element. Do not insert the markup into the page with `MarkupString`, and do not
serve it as an `.svg` file from your application's origin. Show the export as an image instead,
where the browser runs no script: `<img src="@dataUrl">` with the result of
`GetSvgDataUrlAsync`. See [export](export.md#svg).

## Content Security Policy

These policies run charts with module functions, `renderItem` and HTML tooltips. They are
verified on Blazor pages for Interactive Server and Interactive WebAssembly; Interactive Auto runs
both, so it needs the WebAssembly policy.

| Render mode | Policy |
|---|---|
| Interactive Server | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; object-src 'none'` |
| Interactive WebAssembly, Auto, standalone WebAssembly | The same with `script-src 'self' 'wasm-unsafe-eval'` |

- **`script-src`.** The library and module functions need no `'unsafe-eval'` and no
  `'unsafe-inline'`. Blazor WebAssembly needs `'wasm-unsafe-eval'`. Inline functions need
  `'unsafe-eval'`.
- **`style-src`.** ECharts' HTML tooltip writes inline `style` attributes. Without
  `'unsafe-inline'` the browser blocks them (`style-src-attr`): the tooltip still shows its text,
  but loses its layout and the colored series markers. The chart itself renders. Under
  `style-src 'self'`, also size the chart container with `Class` and a stylesheet, because the
  `Style` parameter is an inline style too, or use the `richText` tooltip shown above.
- **Template components.** Under `script-src 'self'` the project templates need changes; see
  [Enforce a Content Security Policy for ASP.NET Core Blazor](https://learn.microsoft.com/aspnet/core/blazor/security/content-security-policy).
  - The Blazor Web App template renders an inline import map (`<ImportMap />`). It needs a nonce
    or the hash of its content.
  - Its navigation menu has an inline `onclick` handler. A nonce does not apply to event handler
    attributes: allow it with `'unsafe-hashes'` and its hash, or move the handler to a script
    file.
  - The standalone WebAssembly template has an inline `<script type="importmap">` in
    `wwwroot/index.html`, which the build fills. Without its hash in `script-src` the browser
    blocks it and the app does not start. The browser reports the hash in the violation; it
    changes when the fingerprinted files change, so take it from the published `index.html`. The
    library itself needs no import map.
- **Other origins.** A `Module` or `Custom` [runtime provider](extensions.md#runtime-providers),
  an extension or a module function on another origin needs that origin in `script-src`, for
  example `script-src 'self' https://cdn.jsdelivr.net`. Images from other origins need it in
  `img-src`.

## Modules from other origins

The runtime imports ECharts, extensions and module functions with `import()`, which has no
`integrity` attribute. A module from a CDN therefore runs with the rights of your page, and a
compromised or changed CDN file runs too. The default `Local` provider loads the ECharts module
of the package from your own origin; keep it unless you need another build. When you load a
module from another origin, pin an exact version in the URL and, in browsers that support it,
add the file's hash to the `integrity` map of an import map.

An `integrity` entry covers only its exact URL. After a failed import, a retry of a module from
your own origin appends `__blazorecharts_retry=<n>` to its URL, which has no `integrity` entry
(see [extensions](extensions.md#runtime-providers)). A module from another origin is imported
again from the same URL, so its `integrity` entry still applies.

## WordCloud

The first registration of `BlazorECharts.WordCloud` installs global `window.setImmediate` and
`window.clearImmediate` functions, a polyfill from wordcloud2.js kept as `@qyperion/echarts-wordcloud`
ships it. Each call posts a `zero-timeout-message<id>` message to the window with target origin
`*`, and a capture-phase `message` listener runs the scheduled callback and stops the event; the
listener does not check the sender. The animated layout posts one message per word. Nothing is
disclosed: another frame that posts such a message can only run a scheduled layout step early.
Other scripts that look for `setImmediate` find and use the polyfill. A `message` listener of
the page receives these messages only if it listens in the capture phase and was added before
the registration.

## Interactive Server message size

On Interactive Server, every result and every event payload travels from the browser to the
server as one SignalR message. Raising `MaximumReceiveMessageSize` lets larger results through,
but every circuit can then send messages of that size, which costs server memory and raises the
risk of denial of service. Raise it only as far as your largest result needs; see
[render modes](render-modes.md#message-size-on-interactive-server).
