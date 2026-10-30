using BlazorECharts.Options;

namespace BlazorECharts.Testing;

public static class CompleteSeriesCatalog
{
    public static readonly IReadOnlyDictionary<string, int> Cases = StandardSeriesCatalog.Cases
        .Concat(AdvancedSeriesCatalog.Cases).ToDictionary(pair => pair.Key, pair => pair.Value);

    public static ChartOptions Create(string name, string standardModule, string customModule) =>
        StandardSeriesCatalog.Cases.ContainsKey(name)
            ? StandardSeriesCatalog.Create(name, standardModule)
            : AdvancedSeriesCatalog.Create(name, customModule);
}
