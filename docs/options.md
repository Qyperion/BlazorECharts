# Chart options

`ChartOptions` is the typed form of the ECharts
[option object](https://echarts.apache.org/en/option.html). Its models are generated from the
pinned ECharts 6.1.0 TypeScript declarations and documentation, so the members, value
alternatives and JSON names follow ECharts exactly. The C# property is the PascalCase JSON name:
`series.itemStyle.borderRadius` is `ItemStyle.BorderRadius` on a series option.

## Build options

<!-- snippet: Guides.Options.Build -->
```csharp
using BlazorECharts.Options;
using BlazorECharts.Values;

var options = new ChartOptions
{
    Title = new TitleOption { Text = "Revenue and orders", Left = "center" },
    Tooltip = new TooltipOption { Trigger = "axis" },
    Legend = new LegendOption { Bottom = 0 },
    XAxis = new XAxisCategoryOption { Data = ["Q1", "Q2", "Q3", "Q4"] },
    // A collection expression writes a JSON array, also with one element; a single value writes an object.
    YAxis =
    [
        new YAxisValueOption { Name = "Revenue" },
        new YAxisValueOption { Name = "Orders", Position = "right" },
    ],
    Series =
    [
        new BarSeriesOption { Name = "Revenue", Data = [320, 410, 380, 520] },
        new LineSeriesOption { Name = "Orders", YAxisIndex = 1, Smooth = true, Data = [12, 18, 15, 21] },
    ],
};
```

- **One or many.** Components that ECharts accepts as one object or an array of objects (`title`,
  `xAxis`, `series`, `dataZoom` and so on) use `OneOrMany<T>`. A single value converts to
  `OneOrMany<T>.One` and writes an object; an array or a collection expression converts to
  `OneOrMany<T>.Many` and writes an array, even with one element. A variant such as
  `XAxisCategoryOption` converts directly to its component list. A value or array of a union with
  a scalar alternative has its own struct, named after the union: `Color` is `ZRColorOneOrMany`,
  `Radius` and `BorderRadius` are `NumberOrStringOneOrMany`, a pie item `Value` is
  `OptionDataValueNumericOneOrMany`. Every alternative of the union converts to it directly, so
  `Color = "#5470c6"`, `Radius = "50%"`, `BorderRadius = 6` and `Value = 1048` need no `One`, and
  `Radius = ["40%", "70%"]` is the array form.
- **Type names.** Components and series are named after ECharts: `TitleOption`, `LegendOption`,
  `LineSeriesOption`. Variants that a `type` field selects are named after it:
  `XAxisCategoryOption`, `XAxisValueOption`, `XAxisTimeOption`, `XAxisLogOption`,
  `ContinuousVisualMapOption`, `PiecewiseVisualMapOption`. The union of the variants is the
  component: `XAxisOption`, `YAxisOption`, `DataZoomOption`, `VisualMapOption`, and
  `LegendComponentOption` (as in ECharts, `LegendOption` is the plain legend). Shared types keep
  their upstream TypeScript name, such as `ItemStyleOption`, `SeriesLabelOption`, `ZRColor` or
  `LabelOption`. Published names are locked: an ECharts upgrade does not rename them.
- **Discriminators.** Series and every variant model that a `type` field selects write their
  `type` themselves: axes, data zoom, legends, visual maps, dataset transforms, gradients,
  patterns and graphic elements. `new XAxisTimeOption()` is a time axis and
  `new InsideDataZoomOption()` an inside zoom, without ECharts falling back to its default.
  Reading a `getOption` snapshot keeps the type the snapshot contains.

The Components group of the demo catalog uses the variants: the
[`piecewise-visual-map` example](../samples/BlazorECharts.Examples/Examples/Components/PiecewiseVisualMapExample.cs)
colors a line with the pieces of a `PiecewiseVisualMapOption`, and the
[`axis-variants` example](../samples/BlazorECharts.Examples/Examples/Components/AxisVariantsExample.cs)
puts a `YAxisLogOption` next to value axes with a break.

The series types are `Bar`, `Boxplot`, `Candlestick`, `Chord`, `Custom`, `EffectScatter`,
`Funnel`, `Gauge`, `Graph`, `Heatmap`, `Line`, `Lines`, `Map`, `Parallel`, `PictorialBar`, `Pie`,
`Radar`, `Sankey`, `Scatter`, `Sunburst`, `ThemeRiver`, `Tree` and `Treemap` (each
`<Name>SeriesOption`), plus `WordCloudSeriesOption` from the
[WordCloud package](extensions.md#wordcloud).

## Union values

Where ECharts accepts several kinds of value, the property type is a union struct with an
implicit conversion from each alternative, for example a number or a percentage string, or a
color string, a gradient or a pattern:

<!-- snippet: Guides.Options.Unions -->
```csharp
var bar = new BarSeriesOption
{
    Name = "Revenue",
    BarWidth = "40%",
    ItemStyle = new()
    {
        Color = new LinearGradientObject
        {
            X = 0,
            Y = 0,
            X2 = 0,
            Y2 = 1,
            ColorStops = [new() { Offset = 0, Color = "#83bff6" }, new() { Offset = 1, Color = "#188df0" }],
        },
        BorderRadius = [4, 4, 0, 0],
    },
    Data = [320, 410, 380, 520],
};
```

Where ECharts accepts a union value or an array of them, such as the palette `color`, a pie
`radius` or a data item `value`, each alternative converts to the scalar form and a collection
expression to the array form:

<!-- snippet: Guides.Options.UnionLists -->
```csharp
var options = new ChartOptions
{
    Color = "#5470c6",
    Series = new PieSeriesOption
    {
        Radius = ["40%", "70%"],
        ItemStyle = new() { BorderRadius = 6 },
        Data = [new PieDataItemOption { Name = "Search", Value = 1048 }, new PieDataItemOption { Name = "Direct", Value = 735 }],
    },
};
```

Literal unions validate their value: `AnimationEasing` accepts only the easing names of ECharts,
and an unknown name throws `ArgumentException`. Each union has a static `From` for every
alternative, which helps when an implicit conversion is ambiguous. A browser callback alternative
takes a [`JsFunction<TSignature>`](functions.md).

Read a union with `TryGet`, one overload per alternative. It also decodes values read from JSON,
such as a [`GetOptionAsync` snapshot](updates.md#read-the-current-options). For a value read from
JSON, `TryGet` keeps the decoded object or array, so later calls return the same instance and
your edits to it are written. `Value` returns the alternative you assigned; for a value read from
JSON it is the alternative that `TryGet` decoded, otherwise the raw `EChartsValue`.

<!-- snippet: Guides.Options.Read -->
```csharp
NumberOrString width = bar.BarWidth!.Value;
if (width.TryGet(out string? percent))
    Console.WriteLine($"Relative width {percent}");
else if (width.TryGet(out double pixels))
    Console.WriteLine($"Width {pixels}px");

object? color = bar.ItemStyle!.Color!.Value.Value;   // the assigned LinearGradientObject
```

A union with a date alternative also converts a `DateTimeOffset`, a `DateTime` and a `DateOnly`;
see [dates and time zones](#dates-and-time-zones).

Union structs do not define value equality; compare the alternative that `TryGet` returns.
Fixed-length tuples, such as gauge color stops, expose their elements as `Item0`, `Item1`, ...

## Collections

`OneOrMany<T>` and the union structs such as `ZRColorOneOrMany` report their shape with
`IsMany`, the scalar with `TryGetOne`, and the elements with `Items` (a scalar is one item). Normalized options from ECharts use arrays for every
component, so read them through `Items`:

<!-- snippet: Guides.Options.ReadCollections -->
```csharp
foreach (var title in options.Title?.Items ?? [])
    Console.WriteLine(title?.Text);

foreach (var series in options.Series?.Items ?? [])
{
    if (series is LineSeriesOption { Name: { } name } && name.TryGet(out string? text))
        Console.WriteLine($"line {text}");
}
```

- `OptionDictionary<T>` is a string-keyed object such as `rich` text styles or `visualMap`
  categories. Keys keep their exact spelling, including dots and numeric-looking names.
  Options that combine named members with free keys (`OptionEncode`, toolbox features) put the
  free keys into `Entries`.
- `OptionArrayLike<T>` is an array of managed values (`From(T[])`) or a browser `ArrayLike` such
  as a `Float64Array` (`From(EChartsObjectReference)`); read it with `TryGetValues` or
  `TryGetReference`. Where a union also takes a plain array, as series `data` does, a JSON array
  of a snapshot reads as the plain array.

## Unset, null and unknown fields

Only assigned properties are written. Assigning `null`, `false`, zero or an empty array is an
assignment and is written as such; to omit a property, leave it unset on a new object.
`AdditionalProperties` holds fields without a typed member and is written after the typed fields.

<!-- snippet: Guides.Options.Presence -->
```csharp
var line = new LineSeriesOption
{
    Smooth = false,                 // written as "smooth": false
    Label = new() { Show = null },  // written as "label": { "show": null }
};
bool assigned = line.IsAssigned("smooth");   // true; unassigned properties are not written

// A field without a typed member, written next to the typed fields.
line.AdditionalProperties["futureOption"] = EChartsValue.From(true);
```

An additional field with the same name as an assigned typed property is an error
(`OptionSerializationException`). Names are case-sensitive.

Some members exist only in the ECharts TypeScript declarations and are not described in the
ECharts documentation. Their XML documentation says "Not described by echarts-doc"; their
contract is the pinned TypeScript declaration. They are versioned like other members, but
ECharts may change them in a minor release, which makes the library upgrade a major version;
prefer documented members where one exists.

## Datasets and open values

Values that ECharts leaves open, such as data items, use `OptionDataValue` (number, string or
date) or `EChartsValue`. `EChartsValue.From` wraps a scalar, an array, an option model or a
registered custom value; `EChartsValue.Array`, `EChartsValue.Object` and `EChartsValue.FromJson`
build JSON values explicitly. Numbers and dates are written with the invariant culture; see
[dates and time zones](#dates-and-time-zones) and [missing values](#missing-values).

<!-- snippet: Guides.Options.OpenValues -->
```csharp
var options = new ChartOptions
{
    Dataset = new DatasetOption
    {
        Source = new OptionDataValue?[][]
        {
            ["Product", "2025", "2026"],
            ["Tea", 43.3, 85.8],
            ["Coffee", 83.1, 73.4],
        },
    },
    XAxis = new XAxisCategoryOption(),
    YAxis = new YAxisValueOption(),
    Series = [new BarSeriesOption(), new BarSeriesOption()],
};
```

The [`dataset` example](../samples/BlazorECharts.Examples/Examples/Components/DatasetExample.cs) of the
demo catalog maps dataset columns to series with `Encode` and derives a second dataset with
`FilterTransformOption` and `SortTransformOption`, which a pie reads through `DatasetIndex`.

## Dates and time zones

Option data, `EChartsValue`, arguments of global helpers and the `CoordinateValue` of coordinate
conversion write dates the same way. In a `CoordinateValue`, an instant becomes a JavaScript `Date`
of that moment.

| Value | Written as | ECharts reads it as |
|---|---|---|
| `DateTimeOffset`, or `DateTime` with `DateTimeKind.Utc` or `Local` | The instant in UTC with three millisecond digits: `2026-10-19T08:30:00.500Z` | That instant |
| `DateTime` with `DateTimeKind.Unspecified`, such as a value from a database | The wall-clock time without offset: `2026-10-19T08:30:00.500` | That time in the browser's time zone |
| `DateOnly` | `2026-10-19` | Midnight in the browser's time zone |
| A number | The number | Milliseconds since the Unix epoch |

- **Local times.** A `DateTime` with `DateTimeKind.Local` is converted to UTC with
  `TimeZoneInfo.Local` of the process that serializes the options: the server's time zone on
  Interactive Server, the browser's in WebAssembly. A WebAssembly app published with
  `<InvariantTimezone>true</InvariantTimezone>` (or `BlazorEnableTimeZoneSupport` `false`) has no
  time zone data, and `TimeZoneInfo.Local` is UTC there. With Interactive Auto, the same page
  moves from one to the other. `DateTime.Now` on a server is server time. Use `DateTimeOffset` or UTC values
  for instants, and `Unspecified` only for wall-clock values that should read the same in every
  time zone.
- **Display.** ECharts formats time axis labels and tooltips in the browser's time zone;
  `ChartOptions.UseUTC = true` formats them in UTC.

<!-- snippet: Guides.Options.Dates -->
```csharp
var options = new ChartOptions
{
    // Axis labels and tooltips in UTC instead of the browser's time zone.
    UseUTC = true,
    XAxis = new XAxisTimeOption(),
    YAxis = new YAxisValueOption(),
    Series = new LineSeriesOption
    {
        Data =
        [
            // Instants: written in UTC, the same moment on every machine.
            new OptionDataValue?[] { new DateTimeOffset(2026, 10, 19, 8, 30, 0, TimeSpan.FromHours(2)), 12 },
            new OptionDataValue?[] { DateTime.SpecifyKind(fromDatabase, DateTimeKind.Utc), 15 },
        ],
    },
};
```

- **Reading back.** A snapshot keeps the date strings you sent. Values that ECharts computes on a
  time axis, such as the results of `ConvertFromPixelAsync`, are milliseconds since the epoch:

<!-- snippet: Guides.Options.ReadDates -->
```csharp
// A time axis converts pixels to epoch milliseconds.
ChartPixelValue value = await chart.ConvertFromPixelAsync(ChartFinder.Select("grid", index: 0), [120, 80]);
DateTimeOffset at = DateTimeOffset.FromUnixTimeMilliseconds((long)value.Numbers![0]);
```

- **Unions.** `TryGet(out DateTimeOffset)` succeeds only for a string with an explicit offset
  (`Z` or `+02:00`); `TryGet(out string)` reads every date string unchanged.

## Missing values

- `null` and `"-"` mark a missing data value. A line breaks there unless `ConnectNulls = true`;
  a bar or a point is not drawn.
- JSON has no `NaN` or infinity, so they are rejected with the path of the value. A `NaN` that
  ECharts returns in an event or a snapshot arrives as `null`.
- Numbers are doubles in JavaScript. A `long` above 2^53 (9 007 199 254 740 992) loses digits in
  the browser, although `EChartsValue` writes it exactly: send such identifiers as strings. A
  `float` assigned to a typed member widens to `double`, so `36.6f` is written as
  `36.599998474121094`: round it or keep the data as `double`. `EChartsValue.From(36.6f)` and
  `float` fields of [custom data types](#custom-data-types) keep the `float` and write `36.6`.

<!-- snippet: Guides.Options.MissingValues -->
```csharp
var options = new ChartOptions
{
    XAxis = new XAxisCategoryOption { Data = ["Mon", "Tue", "Wed", "Thu", "Fri"] },
    YAxis = new YAxisValueOption(),
    Series = new LineSeriesOption
    {
        // JavaScript numbers are doubles: an identifier above 2^53 keeps its digits only as a string.
        Id = messageId.ToString(CultureInfo.InvariantCulture),
        // null and "-" are missing values; the line breaks there unless ConnectNulls is true.
        // A float widens to 36.599998474121094 for 36.6f: round it or store the data as double.
        Data = [12, null, 18, "-", Math.Round((double)reading, 1)],
        ConnectNulls = false,
    },
};
```

## Custom data types

Your own types are serialized with source-generated `System.Text.Json` metadata, never with
reflection, so they work in trimmed and AOT-compiled WebAssembly. Register the metadata once per
runtime, before the data is used:

<!-- snippet: Guides.Options.CustomData -->
```csharp
using System.Text.Json.Serialization;

runtime.Serialization.Register(SalesJsonContext.Default.SalesPointArray);

// Object rows: ECharts takes the dimension names "week" and "amount" from the JSON keys.
var dataset = new DatasetOption();
dataset.AdditionalProperties["source"] = EChartsValue.From(new SalesPoint[] { new(1, 120), new(2, 200) });

public sealed record SalesPoint([property: JsonPropertyName("week")] double Week, [property: JsonPropertyName("amount")] double Amount);

[JsonSerializable(typeof(SalesPoint[]))]
public partial class SalesJsonContext : JsonSerializerContext;
```

The additional `source` field stands in for the typed `Source`, which stays unset. Registered
array metadata also covers its element type. Inside a custom type, `System.Text.Json`
owns the graph: library values such as `EChartsValue`, `OneOrMany<T>` or option models need an
explicit converter there.

## Raw JSON

`RawOptions` takes a JSON object instead of `Options`; the two parameters are mutually exclusive.
JSON is passed through as data; strings that look like code are never executed.

<!-- snippet: Guides.Options.RawJson -->
```razor
<EChart RawOptions="_options" Style="height:300px" />

@code {
    private readonly JsonElement _options = JsonDocument.Parse("""
        {
          "xAxis": { "type": "category", "data": ["A", "B", "C"] },
          "yAxis": { "type": "value" },
          "series": [{ "type": "line", "data": [3, 5, 4] }]
        }
        """).RootElement.Clone();
}
```

`RawSeriesOption` adds an untyped series to typed options: `new RawSeriesOption("myType")` with
`AdditionalProperties`, or `RawSeriesOption.FromJson(json)`. It is meant for series types that
an [extension](extensions.md#custom-series-types) installs without a typed model. A
`GetOptionAsync` snapshot reads such a series as a `RawSeriesOption` too.
