using BlazorECharts.Runtime;

namespace BlazorECharts.Examples;

/// <summary>A fictional office floor plan in GeoJSON, shared by the map series and the geo component examples.</summary>
public static class OfficeMap
{
    /// <summary>The name the floor plan is registered under.</summary>
    public const string Name = "examples-office";

    // Room coordinates are arbitrary map units.
    private const string GeoJson = """
        {"type":"FeatureCollection","features":[
          {"type":"Feature","properties":{"name":"Lobby"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[40,0],[40,30],[0,30],[0,0]]]}},
          {"type":"Feature","properties":{"name":"Design"},"geometry":{"type":"Polygon","coordinates":[[[40,0],[100,0],[100,30],[40,30],[40,0]]]}},
          {"type":"Feature","properties":{"name":"Support"},"geometry":{"type":"Polygon","coordinates":[[[0,30],[60,30],[60,60],[0,60],[0,30]]]}},
          {"type":"Feature","properties":{"name":"Kitchen"},"geometry":{"type":"Polygon","coordinates":[[[60,30],[100,30],[100,60],[60,60],[60,30]]]}},
          {"type":"Feature","properties":{"name":"Rooftop"},"geometry":{"type":"Polygon","coordinates":[[[0,0],[300,0],[300,200],[0,200],[0,0]]]}}
        ]}
        """;

    // The rooftop polygon is much larger than the floor; a special area places it in a small inset instead.
    private static readonly Dictionary<string, GeoSpecialArea> SpecialAreas = new()
    {
        ["Rooftop"] = new(Left: 104, Top: 0, Width: 20, Height: null),
    };

    /// <summary>Registers the floor plan on the page runtime. Registering it again replaces it with the same data.</summary>
    public static ValueTask RegisterAsync(EChartsRuntime runtime) => runtime.RegisterMapAsync(Name, GeoJson, SpecialAreas);
}
