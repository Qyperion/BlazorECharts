using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using CategoryXAxis = BlazorECharts.Options.XAxisCategoryOption;
using Cell = BlazorECharts.Values.OptionDataValue;
using LogYAxis = BlazorECharts.Options.YAxisLogOption;
using TimeFormatter = BlazorECharts.Values.Signatures.TimeAxisLabelFormatterOptionAlternativeSignature;
using TimeLabels = BlazorECharts.Options.TimeAxisLabelOption;
using TimeXAxis = BlazorECharts.Options.XAxisTimeOption;
using ValueYAxis = BlazorECharts.Options.YAxisValueOption;

namespace BlazorECharts.Testing;

public static class ComponentOptionFixtures
{
    public static ChartOptions Coordinates(string? module = null)
    {
        var time = new TimeXAxis
        {
            Id = "time",
            GridId = "left",
            Min = Day(17),
            AxisLabel = new TimeLabels { Formatter = module is null ? "{yyyy}-{MM}-{dd}" : JsFunction.Module<TimeFormatter>(module, "timeLabel") },
        };
        return new ChartOptions
        {
            Animation = false,
            UseUTC = true,
            Title = OneOrMany<TitleOption>.One(new() { Text = "Time, log and multiple axes" }),
            Grid = OneOrMany<GridOption>.Many(new() { Id = "left", Left = "7%", Width = "36%", Top = 70, Bottom = 75 },
                new() { Id = "right", Left = "58%", Width = "35%", Top = 70, Bottom = 75 }),
            XAxis = OneOrMany<XAxisOption?>.Many(time, new CategoryXAxis { Id = "category", GridId = "right" }),
            YAxis = OneOrMany<YAxisOption?>.Many(new LogYAxis { Id = "log", GridId = "left", Min = 1d, LogBase = 10 },
                new ValueYAxis { Id = "value", GridId = "right" }),
            Dataset = OneOrMany<DatasetOption>.One(new()
            {
                Id = "raw",
                SourceHeader = true,
                Dimensions = [new DimensionDefinitionLooseAlternative { Name = "when", Type = "time" }, "amount"],
                Source = new Cell?[][] { ["when", "amount"], [Day(17), 1d], [Day(18), 10d], [Day(19), 100d] },
            }),
            Series = OneOrMany<SeriesOption>.Many(Line("first", "time", "log"), Line("second", "category", "value")),
            Aria = new AriaOption { Enabled = true, Description = "Synthetic time and logarithmic axes." },
        };
    }

    public static DateTimeOffset Day(int day) => new(2026, 10, day, 0, 0, 0, TimeSpan.Zero);

    // Instants with milliseconds and non-whole-hour offsets, then wall-clock values read in the browser's time zone.
    public static ChartOptions Dates() => new()
    {
        Animation = false,
        XAxis = new TimeXAxis(),
        YAxis = new ValueYAxis(),
        Series = new LineSeriesOption
        {
            Id = "dates",
            Data =
            [
                new Cell?[] { new DateTimeOffset(2026, 10, 19, 8, 30, 0, 100, TimeSpan.Zero), 1d },
                new Cell?[] { new DateTimeOffset(2026, 10, 19, 8, 30, 0, 500, TimeSpan.Zero), 2d },
                new Cell?[] { new DateTimeOffset(2026, 10, 19, 14, 0, 0, 120, new TimeSpan(5, 30, 0)), 3d },
                new Cell?[] { new DateTimeOffset(2026, 10, 19, 5, 0, 0, 7, new TimeSpan(-3, -30, 0)), 4d },
                new Cell?[] { new DateTime(2026, 10, 19, 8, 30, 0, 250, DateTimeKind.Utc), 5d },
                new Cell?[] { new DateTime(2026, 10, 19, 8, 30, 0, 500, DateTimeKind.Unspecified), 6d },
                new Cell?[] { new DateOnly(2026, 10, 19), 7d },
            ],
        },
    };

    private static LineSeriesOption Line(string id, string x, string y) => new()
    {
        Id = id,
        Name = id,
        DatasetId = "raw",
        XAxisId = x,
        YAxisId = y,
        Encode = new OptionEncode
        {
            Entries = {
            ["x"] = "when",
            ["y"] = "amount" },
        },
    };

    public static ChartOptions DatasetMediaAndAria() => new()
    {
        BaseOption = Coordinates(),
        Media =
        [
            new()
            {
                Query = new MediaQuery { MaxWidth = 600 },
                Option = new ChartOptions { Title = OneOrMany<TitleOption>.One(new() { Text = "Compact axes" }) },
            },
        ],
        Options = [],
        Aria = new AriaOption { Enabled = false, Description = null },
    };

    public static ChartOptions Transforms()
    {
        var options = Coordinates();
        options.Dataset = OneOrMany<DatasetOption>.Many(
            new()
            {
                Id = "raw",
                SourceHeader = true,
                Dimensions = ["when", "amount"],
                Source = new Cell?[][] { ["when", "amount"], [Day(17), 1d], [Day(18), 10d], [Day(19), 100d] },
            },
            new()
            {
                Id = "filtered",
                FromDatasetId = "raw",
                Transform = OneOrMany<ComponentTransform?>.Many(
                new FilterTransformOption { Config = new RelationalExpressionOption { Dimension = "amount", Gte = 10d } },
                new SortTransformOption { Config = OneOrMany<SortTransformOptionConfigItem>.One(new() { Dimension = "amount", Order = "desc" }) }),
            });
        var first = Line("first", "time", "log");
        first.DatasetId = "filtered";
        options.Series = OneOrMany<SeriesOption>.One(first);
        return options;
    }

    public static ChartOptions VisualMapChannels()
    {
        var options = GeneratedOptionMetadata.ReadChartOptions(Parse("""
            {"animation":false,"dataset":{"source":[["x","amount"],[1,0],[2,50],[3,100]]},"xAxis":{"type":"value"},"yAxis":{"type":"value"},
             "series":[{"id":"continuous","type":"scatter","datasetIndex":0,"encode":{"x":"x","y":"amount"}},{"id":"categories","type":"scatter","data":[[1,20,"Warden"],[2,60,"Paladin"],[3,80,"Other"]]}]}
            """));
        options.VisualMap = OneOrMany<VisualMapOption?>.Many(
            new ContinuousVisualMapOption
            {
                SeriesIndex = 0d,
                Dimension = "amount",
                Min = 0,
                Max = 100,
                InRange = new VisualMapChannelsOption { Color = new string?[] { "#000000", "#ffffff" }, SymbolSize = new double?[] { 10, 40 } },
                Controller = new ControllerOption { InRange = new VisualMapChannelsOption { Color = new string?[] { "#336699", "#99ccff" } } },
            },
            new PiecewiseVisualMapOption
            {
                SeriesIndex = 1d,
                Dimension = 2d,
                Categories = ["Warden", "Paladin", "Other"],
                InRange = new VisualMapChannelsOption
                {
                    Color = new OptionDictionary<string?> { ["Warden"] = "#ff0000", [""] = "#00ff00" },
                    SymbolSize = new OptionDictionary<double?> { ["Paladin"] = 30, [""] = 12 },
                },
            });
        return options;
    }

    public static ChartOptions DatasetForm(string form, EChartsObjectReference? reference = null)
    {
        var options = Coordinates();
        DatasetOptionSource source = form switch
        {
            "keyed" => new OptionDictionary<OptionArrayLike<Cell?>?>
            {
                ["when"] = OptionArrayLike<Cell?>.From([Day(17), Day(18), Day(19)]),
                ["amount"] = OptionArrayLike<Cell?>.From([1d, 10d, 100d]),
            },
            "objects" => new OptionDictionary<Cell?>[] {
                new() { ["when"]=Day(17),["amount"]=1d },new() { ["when"]=Day(18),["amount"]=10d },new() { ["when"]=Day(19),["amount"]=100d } },
            "native" => OptionArrayLike<double?>.From(reference ?? throw new ArgumentNullException(nameof(reference))),
            _ => throw new ArgumentOutOfRangeException(nameof(form)),
        };
        options.Dataset = OneOrMany<DatasetOption>.One(new()
        {
            Id = "raw",
            SourceHeader = false,
            Dimensions = [new DimensionDefinitionLooseAlternative { Name = "when", Type = "time" }, "amount"],
            Source = source,
        });
        return options;
    }

    // Every catalog input is decoded by the production generated reader, then serialized through its typed contracts.
    // Series data here is an explicit fixture for coordinate behavior; series-family completeness belongs to 19/20.
    public static ChartOptions CoordinateCatalog(string name) => GeneratedOptionMetadata.ReadChartOptions(Parse(name switch
    {
        "polar" => """{"animation":false,"polar":{"id":"p"},"angleAxis":{"type":"value","polarId":"p","max":360},"radiusAxis":{"type":"value","polarId":"p","max":5},"series":[{"type":"scatter","coordinateSystem":"polar","polarId":"p","data":[[2,60],[4,240]]}]}""",
        "calendar" => """{"animation":false,"calendar":{"id":"c","range":"2026-10","cellSize":[20,20]},"visualMap":{"min":0,"max":10,"show":false},"series":[{"type":"heatmap","coordinateSystem":"calendar","calendarId":"c","data":[["2026-10-18",8],["2026-10-19",2]]}]}""",
        "single" => """{"animation":false,"singleAxis":{"id":"s","type":"value","min":0,"max":5},"series":[{"type":"scatter","coordinateSystem":"singleAxis","singleAxisId":"s","data":[1,3,4]}]}""",
        "parallel" => """{"animation":false,"parallel":{"id":"p"},"parallelAxis":[{"dim":0,"type":"value"},{"dim":1,"type":"category","data":["A","B"]},{"dim":2,"type":"log","min":1}],"series":[{"type":"parallel","parallelId":"p","data":[[1,"A",1],[2,"B",100]]}]}""",
        "radar" => """{"animation":false,"radar":{"id":"r","indicator":[{"name":"A","max":10},{"name":"B","max":10},{"name":"C","max":10}]},"series":[{"type":"radar","radarId":"r","data":[{"value":[2,5,8]}]}]}""",
        "matrix" => """{"animation":false,"matrix":{"id":"m","x":{"data":["A","B"]},"y":{"data":["C","D"]}},"series":[{"type":"scatter","coordinateSystem":"matrix","matrixId":"m","data":[[0,0,2],[1,1,4]]}]}""",
        "geo" => """{"animation":false,"geo":{"id":"g","map":"component-map","roam":true},"series":[{"type":"scatter","coordinateSystem":"geo","geoId":"g","data":[[2,3],[6,7]]}]}""",
        _ => throw new ArgumentOutOfRangeException(nameof(name)),
    }));

    // ECharts merges the option of the current timeline step into the base option.
    public static ChartOptions Timeline()
    {
        static ChartOptions Step(double a, double b, double c) => new() { Series = new BarSeriesOption { Id = "yearly", Data = [a, b, c] } };

        return new()
        {
            BaseOption = new ChartOptions
            {
                Animation = false,
                Timeline = OneOrMany<TimelineComponentOption?>.One(
                    new SliderTimelineOption { AxisType = "category", AutoPlay = false, Data = ["2024", "2025", "2026"] }),
                XAxis = new CategoryXAxis { Data = ["A", "B", "C"] },
                YAxis = new ValueYAxis(),
                Series = new BarSeriesOption { Id = "yearly", Name = "yearly" },
            },
            Options = [Step(1, 2, 3), Step(10, 20, 30), Step(100, 200, 300)],
        };
    }

    public static ChartOptions SeriesMarkers() => new()
    {
        Animation = false,
        XAxis = new CategoryXAxis { Data = ["A", "B", "C", "D"] },
        YAxis = new ValueYAxis(),
        Series = new BarSeriesOption
        {
            Id = "marked",
            Data = [5d, 20d, 36d, 10d],
            MarkPoint = new MarkPointOption
            {
                Data = [new MarkPointDataItemOption { Type = "max", Name = "Highest" }, new MarkPointDataItemOption { Type = "min", Name = "Lowest" }],
            },
            MarkLine = new MarkLineOption
            {
                Data = [new MarkLine1DDataItemOption { Type = "average", Name = "Average" },
                    MarkLineOptionDataItemAlternative.Create(
                        new MarkLine2DDataItemDimOption { XAxis = "A", YAxis = 5d },
                        new MarkLine2DDataItemDimOption { XAxis = "D", YAxis = 10d })],
            },
            MarkArea = new MarkAreaOption
            {
                Data =
                [
                    MarkAreaOptionDataItemAlternative.Create(
                        new MarkArea2DDataItemDimOption { XAxis = "B", Name = "Peak" },
                        new MarkArea2DDataItemDimOption { XAxis = "C" }),
                ],
            },
        },
    };

    // The thumbnail of ECharts 6 shows a graph series in a small window.
    public static ChartOptions Thumbnail()
    {
        var options = GeneratedOptionMetadata.ReadChartOptions(Parse("""
            {"animation":false,"series":[{"id":"network","type":"graph","layout":"none","roam":true,
             "data":[{"name":"A","x":0,"y":0},{"name":"B","x":200,"y":40},{"name":"C","x":100,"y":160}],
             "links":[{"source":"A","target":"B"},{"source":"B","target":"C"}]}]}
            """));
        options.Thumbnail = new ThumbnailOption { Width = "30%", Height = "30%", Right = 10, Bottom = 10 };
        return options;
    }

    public static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
