using System.Text.Json;
using BlazorECharts.Runtime;

namespace DocumentationExamples.Guides;

internal static class LocaleExamples
{
    internal static async Task German(EChartsRuntime runtime, string langDeJson)
    {
        // snippet: Guides.Extensions.Locale
        // langDeJson: the object of echarts/i18n/langDE-obj.js (ECharts 6.1.0) saved as JSON.
        using var locale = JsonDocument.Parse(langDeJson);
        await runtime.RegisterLocaleAsync("DE", locale.RootElement);
        // Then: InitOptions = new ChartInitOptions { Locale = "DE" }
        // endsnippet
    }
}
