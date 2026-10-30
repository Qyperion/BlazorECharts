using BlazorECharts.Examples.Capabilities;
using BlazorECharts.Examples.Components;
using BlazorECharts.Examples.Scenarios;
using BlazorECharts.Examples.Series;
using BlazorECharts.Options;
using BlazorECharts.Runtime;

namespace BlazorECharts.Examples;

/// <summary>The catalog of examples shared by every demo host.</summary>
public static class ExampleRegistry
{
    private const string Functions = ExampleModules.Functions;
    private const string WordCloud = "echarts-wordcloud";

    /// <summary>Gets every example in catalog order.</summary>
    public static IReadOnlyList<ExampleDescriptor> All { get; } = Validate(
    [
        // Standard series, each with a typed option graph. Sunburst, graph, Sankey and custom series are in the examples below.
        Series("bar", "Bar", "Stacked bars compare sent and received messages for each weekday.",
            ["cartesian", "stack"], BarExample.Create),
        Series("line", "Line", "A smooth area line of monthly active members against a stepped, dashed target line.",
            ["cartesian", "area", "step"], LineExample.Create),
        Series("pie", "Pie", "A donut chart splits messages into text, photo, sticker, voice and video types.",
            ["donut"], PieExample.Create),
        Series("scatter", "Scatter", "Sixty synthetic messages plotted by hour of day against their length.",
            ["cartesian"], ScatterExample.Create),
        Series("effect-scatter", "Effect scatter", "Ordinary hourly points with the two busiest hours drawn as rippling effect points.",
            ["cartesian", "animation"], EffectScatterExample.Create, continuous: true),
        Series("boxplot", "Boxplot", "Reply time distributions for four participants: minimum, quartiles, median and maximum.",
            ["cartesian", "statistics"], BoxplotExample.Create),
        Series("candlestick", "Candlestick", "Daily member counts drawn as open, close, low and high candles.",
            ["cartesian", "finance"], CandlestickExample.Create),
        Series("heatmap", "Heatmap", "Message activity for every weekday and hour, colored by a continuous visual map.",
            ["cartesian", "visualmap"], HeatmapExample.Create),
        Series("lines", "Lines", "Animated routes between rooms on a value grid, with moving effect symbols.",
            ["cartesian", "animation"], LinesExample.Create, continuous: true),
        Series("parallel", "Parallel", "Four participants across messages, words, replies and role on parallel axes.",
            ["parallel"], ParallelExample.Create),
        Series("pictorial-bar", "Pictorial bar", "Sticker counts drawn as repeated rounded symbols on horizontal bars.",
            ["cartesian", "symbol"], PictorialBarExample.Create),
        Series("radar", "Radar", "Two communication styles compared across five indicators.",
            ["radar"], RadarExample.Create),
        Series("funnel", "Funnel", "Conversation steps from opened to forwarded, narrowing at each stage.",
            ["conversion"], FunnelExample.Create),
        Series("gauge", "Gauge", "A response rate of 72 percent with a progress arc.",
            ["kpi"], GaugeExample.Create),
        Series("theme-river", "Theme river", "Three topics flowing over twelve weeks on a single time axis.",
            ["time"], ThemeRiverExample.Create),
        Series("tree", "Tree", "A thread of replies to one announcement as a left-to-right tree.",
            ["hierarchy"], TreeExample.Create),
        Series("treemap", "Treemap", "Shared files nested by type and format, sized by megabytes.",
            ["hierarchy"], TreemapExample.Create),
        Series("chord", "Chord", "Replies between four members as ribbons around a circle.",
            ["relation"], ChordExample.Create),
        Interactive("map", "Map", "A synthetic office floor plan registered as GeoJSON, with a special area and a visual map of messages per room.",
            ["series", "maps", "registration", "visualmap"], MapExample.CreateOptions, typeof(MapExample),
            "Capabilities/MapExample.razor", prepare: OfficeMap.RegisterAsync),

        // Components and coordinate systems, each in a basic typed form.
        Component("polar", "Polar coordinates", "Stacked bars and a line around the week on a polar coordinate system.",
            ["polar", "stack"], PolarExample.Create),
        Interactive("geo", "Geo component", "Desks, the busiest desks and hand-off routes on a registered office floor plan that you can zoom and pan.",
            ["component", "geo", "maps", "roam"], GeoExample.CreateOptions, typeof(GeoExample), "Components/GeoExample.razor",
            prepare: OfficeMap.RegisterAsync),
        Component("dataset", "Dataset and transforms", "Bars and a line encoded from one dataset, and a pie that reads a second dataset filtering and sorting the first.",
            ["dataset", "transform", "encode", "aria"], DatasetExample.Create),
        Component("markers", "Mark points, lines and areas", "The busiest and quietest months, an average and a goal line, and a highlighted summer break.",
            ["markers", "cartesian"], MarkersExample.Create),
        Component("piecewise-visual-map", "Piecewise visual map", "A line colored by activity level, with the days above the last level in gray.",
            ["visualmap", "piecewise"], PiecewiseVisualMapExample.Create),
        Interactive("timeline", "Timeline", "Four quarters as timeline steps over a shared base option; the page shows the step from the typed timelinechanged event.",
            ["component", "timeline", "events", "actions"], TimelineExample.CreateOptions, typeof(TimelineExample),
            "Components/TimelineExample.razor"),
        Interactive("media", "Media queries", "A pie whose legend moves under it when its container gets narrow, without resizing the window.",
            ["component", "media", "layout"], MediaExample.CreateOptions, typeof(MediaExample), "Components/MediaExample.razor"),
        Component("matrix", "Matrix", "A heatmap on a matrix coordinate system with two levels of headers on each side.",
            ["matrix", "heatmap"], MatrixExample.Create),
        Component("thumbnail", "Thumbnail", "A reply network that you can zoom and pan, with a thumbnail of the visible window.",
            ["thumbnail", "graph", "roam"], ThumbnailExample.Create),
        Component("linked-grids", "Linked grids", "Two grids with one linked axis pointer, one axis tooltip and one data zoom slider.",
            ["axis-pointer", "grid", "datazoom"], LinkedGridsExample.Create),
        Component("axis-variants", "Axis variants", "A log axis, a second value axis, an axis break and jittered scatter points on a category axis.",
            ["axis", "log", "breaks", "jitter"], AxisVariantsExample.Create),
        Component("legend-toolbox", "Scroll legend and toolbox", "Twelve series with a paged legend and selector buttons, and a toolbox that switches the chart type and zooms.",
            ["legend", "toolbox", "magictype"], LegendToolboxExample.Create),

        // Library capabilities.
        Options("callback-modules", "Callback modules", "Bar colors, labels and tooltip values computed by functions imported from a browser module.",
            ["functions", "modules", "csp"], CallbackModulesExample.Create, "Capabilities/CallbackModulesExample.cs", modules: [Functions]),
        Options("inline-functions", "Inline functions (opt-in)", "The same callbacks written as inline source, allowed only by an explicit host opt-in.",
            ["functions", "inline"], InlineFunctionsExample.Create, "Capabilities/InlineFunctionsExample.cs"),
        Interactive("updates", "Updates", "Replacing options, mutating with UpdateAsync, merging a partial option and removing a series with replaceMerge.",
            ["updates", "setoption"], UpdatesExample.CreateOptions, typeof(UpdatesExample), "Capabilities/UpdatesExample.razor"),
        Interactive("events-actions", "Events and actions", "Typed click and legend events, and buttons that dispatch highlight, tooltip and legend actions.",
            ["events", "actions"], EventsActionsExample.CreateOptions, typeof(EventsActionsExample), "Capabilities/EventsActionsExample.razor"),
        Interactive("theme-locale", "Themes and locales", "A registered theme and locale: switch between the default, dark and custom themes at runtime.",
            ["theme", "locale", "registration"], ThemeLocaleExample.CreateOptions, typeof(ThemeLocaleExample),
            "Capabilities/ThemeLocaleExample.razor"),
        Options("custom-render-item", "Custom renderItem", "A custom series draws online-hour ranges with a renderItem function from a browser module.",
            ["custom", "functions", "graphic"], CustomRenderItemExample.Create, "Capabilities/CustomRenderItemExample.cs", modules: [Functions]),
        Interactive("registered-custom-series", "Registered custom series", "A custom series type registered once on the page and selected by name in the options.",
            ["custom", "registration", "graphic"], RegisteredCustomSeriesExample.CreateOptions, typeof(RegisteredCustomSeriesExample),
            "Capabilities/RegisteredCustomSeriesExample.razor", modules: [Functions], prepare: RegisteredCustomSeriesExample.RegisterAsync),
        Options("consumer-extension", "Consumer extension", "A new progress series type added by a page extension with its own typed model and serializer.",
            ["extensions", "registration", "series"], ConsumerExtensionExample.Create, "Capabilities/ConsumerExtensionExample.cs",
            extensions: ["examples-progress-series"]),
        Interactive("graphic-references", "Graphic and references", "A graphic component annotation with a browser image created and decoded through a reference.",
            ["graphic", "references"], GraphicReferencesExample.CreateOptions, typeof(GraphicReferencesExample),
            "Capabilities/GraphicReferencesExample.razor"),
        Interactive("lifecycle-lab", "Lifecycle lab", "Charts in tabs and beside a collapsible panel: removed and restored, recreated with another renderer, with a second runtime facade.",
            ["lifecycle", "layout", "events", "updates"], LifecycleLabExample.CreateOptions, typeof(LifecycleLabExample),
            "Capabilities/LifecycleLabExample.razor"),
        Interactive("exports", "PNG, SVG and connected exports", "Two connected charts exported as PNG, SVG or one connected image after their layout is stable.",
            ["export", "connect"], ExportsExample.CreateOptions, typeof(ExportsExample), "Capabilities/ExportsExample.razor"),

        // Application scenarios on synthetic data.
        Interactive("wordcloud", "Word cloud", "Fifty frequent words in a shaped cloud with module colors; exports wait for the finished layout.",
            ["scenario", "wordcloud", "extensions", "export"], WordCloudScenario.CreateOptions, typeof(WordCloudScenario), "Scenarios/WordCloudScenario.razor",
            modules: [Functions], extensions: [WordCloud]),
        Options("calendar-heatmap", "Activity calendar", "Daily activity across three years, one calendar per year, colored by a typed visual map.",
            ["scenario", "calendar", "heatmap", "visualmap"], CalendarHeatmapScenario.Create, "Scenarios/CalendarHeatmapScenario.cs",
            modules: [Functions], height: CalendarHeatmapScenario.ChartHeight(3)),
        Interactive("sunburst-drilldown", "Sunburst drill-down", "Shared media by type and format; click a category to drill into it and the center to go back.",
            ["scenario", "sunburst", "hierarchy", "events"], SunburstScenario.CreateOptions, typeof(SunburstScenario), "Scenarios/SunburstScenario.razor"),
        Interactive("force-graph", "Force graph", "Who replies to whom as a force-directed graph you can zoom, pan and rearrange.",
            ["scenario", "graph", "roam", "events"], ForceGraphScenario.CreateOptions, typeof(ForceGraphScenario),
            "Scenarios/ForceGraphScenario.razor"),
        Interactive("mirrored-time-area", "Mirrored time areas", "Monthly messages of two people mirrored around zero, or four people stacked, on a time axis.",
            ["scenario", "time", "area", "stack", "functions"], MirroredTimeAreaScenario.CreateOptions, typeof(MirroredTimeAreaScenario),
            "Scenarios/MirroredTimeAreaScenario.razor", modules: [Functions]),
        Options("sankey-flow", "Conversation hand-offs", "A Sankey diagram of who ends a conversation and who restarts it.",
            ["scenario", "sankey", "flow"], SankeyScenario.Create, "Scenarios/SankeyScenario.cs"),
        Interactive("brush-period-picker", "Brush period picker", "Drag across monthly bars to select a period; the typed brush event reports the months.",
            ["scenario", "brush", "events"], BrushPeriodScenario.CreateOptions, typeof(BrushPeriodScenario), "Scenarios/BrushPeriodScenario.razor"),
    ]);

    /// <summary>Finds an example by its slug.</summary>
    public static ExampleDescriptor? Find(string slug) => All.FirstOrDefault(example => example.Slug == slug);

    /// <summary>Gets the examples whose title or tags match every query term.</summary>
    public static IReadOnlyList<ExampleDescriptor> Search(string? query) => [.. All.Where(example => example.Matches(query))];

    private static ExampleDescriptor Series(
        string slug,
        string title,
        string summary,
        string[] tags,
        Func<ChartOptions> create,
        bool continuous = false) =>
        Options(slug, title, summary, ["series", .. tags], create, $"Series/{create.Method.DeclaringType!.Name}.cs", continuous: continuous);

    private static ExampleDescriptor Component(string slug, string title, string summary, string[] tags, Func<ChartOptions> create) =>
        Options(slug, title, summary, ["component", .. tags], create, $"Components/{create.Method.DeclaringType!.Name}.cs");

    private static ExampleDescriptor Options(
        string slug,
        string title,
        string summary,
        string[] tags,
        Func<ChartOptions> create,
        string source,
        string[]? modules = null,
        string[]? extensions = null,
        int? height = null,
        bool continuous = false) => new()
        {
            Slug = slug,
            Title = title,
            Summary = summary,
            Tags = tags,
            CreateOptions = create,
            SourcePath = $"Examples/{source}",
            Modules = modules ?? [],
            Extensions = extensions ?? [],
            Height = height,
            ContinuousAnimation = continuous,
        };

    private static ExampleDescriptor Interactive(
        string slug,
        string title,
        string summary,
        string[] tags,
        Func<ChartOptions> create,
        Type component,
        string source,
        string[]? modules = null,
        string[]? extensions = null,
        Func<EChartsRuntime, ValueTask>? prepare = null) => new()
        {
            Slug = slug,
            Title = title,
            Summary = summary,
            Tags = tags,
            CreateOptions = create,
            Component = component,
            Prepare = prepare,
            SourcePath = $"Examples/{source}",
            Modules = modules ?? [],
            Extensions = extensions ?? [],
        };

    private static IReadOnlyList<ExampleDescriptor> Validate(ExampleDescriptor[] examples)
    {
        var duplicate = examples.GroupBy(example => example.Slug).FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidOperationException($"Duplicate example slug '{duplicate.Key}'.");

        return examples;
    }
}
