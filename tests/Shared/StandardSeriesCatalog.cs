using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Testing;

public static class StandardSeriesCatalog
{
    // The generator/browser tests compare these runnable factories with the complete pinned partition.
    public static readonly IReadOnlyDictionary<string, int> Cases = new Dictionary<string, int>
    {
        ["bar"] = 2,
        ["boxplot"] = 2,
        ["candlestick"] = 2,
        ["effectScatter"] = 2,
        ["funnel"] = 2,
        ["gauge"] = 2,
        ["heatmap"] = 2,
        ["line"] = 2,
        ["lines"] = 2,
        ["map"] = 2,
        ["parallel"] = 2,
        ["pictorialBar"] = 2,
        ["pie"] = 2,
        ["radar"] = 2,
        ["scatter"] = 2,
        ["themeRiver"] = 4,
    };

    public static ChartOptions Create(string name, string? module = null)
    {
        var (components, series) = name switch
        {
            "bar" => (CategoryAxes, """{"type":"bar","data":[{"name":"A","value":3,"itemStyle":{"color":"#2480cc","borderRadius":[2,3]},"groupId":1},6]}"""),
            "boxplot" => (CategoryAxes, """{"type":"boxplot","data":[[1,2,3,4,5],{"name":"B","value":[2,3,4,5,6],"groupId":2}]}"""),
            "candlestick" => (CategoryAxes, """{"type":"candlestick","data":[[2,3,1,4],[3,2,1,5]]}"""),
            "effectScatter" => (ValueAxes, """{"type":"effectScatter","showEffectOn":"emphasis","symbolSize":16,"data":[[1,2],[3,4]]}"""),
            "funnel" => ("", """{"type":"funnel","data":[{"name":"A","value":8},{"name":"B","value":4}]}"""),
            "gauge" => ("", """{"type":"gauge","data":[{"name":"A","value":40},{"name":"B","value":70}]}"""),
            "heatmap" => ("""
                "xAxis":{"type":"category","data":["A","B"]},"yAxis":{"type":"category","data":["C","D"]},"visualMap":{"show":false,"min":0,"max":10},
                """, """{"type":"heatmap","data":[[0,0,3],[1,1,8]],"itemStyle":{"borderRadius":3}}"""),
            "line" => (CategoryAxes, """{"type":"line","showSymbol":true,"symbolSize":16,"step":"middle","showAllSymbol":"auto","symbolOffset":["10%",0],"data":[{"name":"A","value":3,"itemStyle":{"color":"#2480cc"}},6]}"""),
            "lines" => (ValueAxes, """{"type":"lines","coordinateSystem":"cartesian2d","lineStyle":{"width":4,"opacity":1},"data":[{"coords":[[1,1],[3,4]]},{"coords":[[1,3],[4,2]]}]}"""),
            "map" => ("", """{"type":"map","map":"series-map","roam":false,"data":[{"name":"A","value":3},{"name":"B","value":6}]}"""),
            "parallel" => ("""
                "parallel":{"id":"parallel"},"parallelAxis":[{"dim":0,"type":"value"},{"dim":1,"type":"value"}],
                """, """{"type":"parallel","parallelId":"parallel","lineStyle":{"width":4},"data":[[1,2],[3,4]]}"""),
            "pictorialBar" => (CategoryAxes, """{"type":"pictorialBar","symbol":"rect","symbolRepeat":false,"data":[3,6]}"""),
            "pie" => ("", """{"type":"pie","selectedMode":"single","radius":"65%","data":[{"name":"A","value":3,"itemStyle":{"color":"#2480cc"},"meta":{"source":"synthetic","flag":false}},{"name":"B","value":6}]}"""),
            "radar" => ("""
                "radar":{"id":"radar","indicator":[{"name":"A","max":10},{"name":"B","max":10},{"name":"C","max":10}]},
                """, """{"type":"radar","radarId":"radar","data":[{"value":[2,4,6]},{"value":[3,6,4]}]}"""),
            "scatter" => (ValueAxes, """{"type":"scatter","symbolSize":[22,18],"data":[{"name":"A","value":[1,2],"itemStyle":{"color":"#2480cc"},"meta":{"source":"synthetic","flag":false}},[3,4]]}"""),
            "themeRiver" => ("""
                "singleAxis":{"type":"time","bottom":40},
                """, """{"type":"themeRiver","data":[["2026-10-17",3,"A"],["2026-10-18",5,"A"],["2026-10-17",4,"B"],["2026-10-18",2,"B"]]}"""),
            _ => throw new ArgumentOutOfRangeException(nameof(name)),
        };
        var options = Read("{\"animation\":false," + components + "\"series\":[" + series + "]}");
        var typed = OptionMetadata.CreateContext().ReadSeries(Parse(series));
        options.Series = OneOrMany<SeriesOption>.Many(typed);

        // Explicit id on the concrete option and module callbacks use the existing typed public bridge.
        typed.AdditionalProperties["id"] = EChartsValue.From(name);
        if (typed is LineSeriesOption line && module is not null)
        {
            line.Label = new SeriesLabelOption
            {
                Show = true,
                RichInheritPlainLabel = false,
                Formatter = JsFunction.Module<SeriesLabelFormatterAlternativeSignature>(module, "format"),
            };
            line.ItemStyle = new ItemStyleOption { Color = JsFunction.Module<ItemColorCallbackSignature>(module, "color") };
            line.Emphasis = new LineSeriesOptionEmphasis { Focus = "series", Label = new() { FontSize = 18 } };
        }

        if (typed is FunnelSeriesOption funnel && module is not null)
            funnel.Sort = JsFunction.Module<FunnelSortComparatorSignature>(module, "funnelSort");

        return options;
    }

    public static ChartOptions Mixed(bool update = false) => Read(update
        ? """{"animation":false,"dataset":{"id":"rows","source":[["category","amount"],["A",3],["B",5]]},"series":[{"id":"trend","type":"line","xAxisId":"category","yAxisIndex":0,"data":[4,6]},{"id":"bars","type":"bar","datasetId":"rows","xAxisId":"category","yAxisId":"value","encode":{"x":"category","y":"amount"}}]}"""
        : """{"animation":false,"xAxis":[{"id":"category","type":"category","data":["A","B"]},{"id":"numeric","type":"value"}],"yAxis":{"id":"value","type":"value"},"dataset":{"id":"rows","source":[["category","amount"],["A",2],["B",4]]},"series":[{"id":"trend","type":"line","datasetIndex":0,"xAxisId":"category","yAxisIndex":0,"encode":{"x":"category","y":"amount"}},{"id":"bars","type":"bar","datasetId":"rows","xAxisIndex":0,"yAxisId":"value","encode":{"x":"category","y":"amount"}},{"id":"points","type":"scatter","xAxisId":"numeric","yAxisIndex":0,"data":[[1,3],[3,5]]}]}""");

    public const string Map = """{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"A"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[4,0],[4,8],[0,8],[0,0]]]}},{"type":"Feature","properties":{"name":"B"},"geometry":{"type":"Polygon","coordinates":[[[4,0],[8,0],[8,8],[4,8],[4,0]]]}}]}""";

    private const string CategoryAxes = """
        "xAxis":{"id":"category","type":"category","data":["A","B"]},"yAxis":{"id":"value","type":"value"},
        """;

    private const string ValueAxes = """
        "xAxis":{"type":"value","min":0,"max":5},"yAxis":{"type":"value","min":0,"max":5},
        """;

    public static ChartOptions Read(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return GeneratedOptionMetadata.ReadChartOptions(doc.RootElement);
    }

    public static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
