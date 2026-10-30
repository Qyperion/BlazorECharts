using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Testing;

public static class AdvancedSeriesCatalog
{
    public static readonly IReadOnlyDictionary<string, int> Cases = new Dictionary<string, int>
    {
        ["chord"] = 3,
        ["custom"] = 2,
        ["graph"] = 3,
        ["sankey"] = 3,
        ["sunburst"] = 5,
        ["tree"] = 5,
        ["treemap"] = 5,
    };

    public static ChartOptions Create(string name, string? module = null, bool update = false)
    {
        var (components, series) = name switch
        {
            "chord" => ("", """{"type":"chord","data":[{"name":"A"},{"name":"B"},{"name":"C"}],"links":[{"source":"A","target":"B","value":3},{"source":"B","target":"C","value":2}],"itemStyle":{"borderWidth":2}}"""),
            "custom" => ("""
                "xAxis":{"id":"x","type":"value","min":0,"max":5},"yAxis":{"id":"y","type":"value","min":0,"max":5},
                """, """{"type":"custom","coordinateSystem":"cartesian2d","xAxisId":"x","yAxisId":"y","data":[[1,2],{"name":"B","value":[3,4],"groupId":"pair"}],"encode":{"x":0,"y":1}}"""),
            "graph" => ("", """{"type":"graph","layout":"force","force":{"repulsion":[180,240],"edgeLength":[110,150],"layoutAnimation":false},"symbolSize":42,"data":[{"id":"a","name":"A","value":3,"x":180,"y":180,"itemStyle":{"color":"#2480cc"},"meta":{"source":"synthetic","flag":false}},{"id":"b","name":"B","value":4,"x":500,"y":180},{"id":"c","name":"C","value":2,"x":340,"y":340}],"links":[{"source":"a","target":"b","value":3,"lineStyle":{"width":12,"curveness":0}},{"source":"b","target":"c","value":2,"lineStyle":{"width":12,"curveness":0}}],"label":{"show":true},"emphasis":{"focus":"adjacency","blurScope":"series","disabled":false}}"""),
            "sankey" => ("", """{"type":"sankey","data":[{"name":"A"},{"name":"B"},{"name":"C"}],"links":[{"source":"A","target":"B","value":3},{"source":"A","target":"C","value":2}],"levels":[{"depth":0,"itemStyle":{"color":"#2480cc"},"edgeLabel":{"show":true,"position":"inside","distance":0},"emphasis":{"edgeLabel":{"show":true,"position":"inside","distance":0}}}]}"""),
            "sunburst" => ("", """{"type":"sunburst","nodeClick":"rootToNode","radius":[0,"80%"],"data":[{"name":"A","children":[{"name":"A1","value":3},{"name":"A2","value":2}]},{"name":"B","value":4}],"levels":[{}, {"label":{"rotate":"radial"}}]}"""),
            "tree" => ("", """{"type":"tree","initialTreeDepth":3,"expandAndCollapse":true,"symbolSize":24,"data":[{"name":"root","children":[{"name":"A","children":[{"name":"A1","value":3}]},{"name":"B","value":4}]}]}"""),
            "treemap" => ("", """{"type":"treemap","leafDepth":1,"breadcrumb":{"show":false},"data":[{"id":"a","name":"A","children":[{"name":"A1","value":3},{"name":"A2","value":2}]},{"name":"B","value":4}],"levels":[{"itemStyle":{"gapWidth":3,"borderRadius":[2,4]}}]}"""),
            _ => throw new ArgumentOutOfRangeException(nameof(name)),
        };
        if (update)
            series = series.Replace("\"value\":3", "\"value\":7").Replace("[1,2]", "[1,7]");

        var options = Read("{\"animation\":false," + components + "\"series\":[" + series + "]}");
        var typed = OptionMetadata.CreateContext().ReadSeries(Parse(series));
        typed.AdditionalProperties["id"] = EChartsValue.From(name);
        if (update)
            typed.AdditionalProperties["name"] = EChartsValue.From("updated");

        if (typed is CustomSeriesOption custom && module is not null)
            custom.RenderItem = JsFunction.Module<CustomRenderItemSignature>(module, "renderItem");

        options.Series = OneOrMany<SeriesOption>.Many(typed);
        return options;
    }

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
