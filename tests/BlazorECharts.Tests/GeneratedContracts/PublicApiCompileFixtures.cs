using BlazorECharts.Options;
using BlazorECharts.Values;
using BlazorECharts.Values.Signatures;

namespace BlazorECharts.Tests.GeneratedContracts;

// Compiled as part of every unit-test build. INVALID_CALLBACK is an intentional negative build probe.
internal static class PublicApiCompileFixtures
{
    public static ChartOptions Create() => new()
    {
        Title = OneOrMany<TitleOption>.Many(new TitleOption { Text = "Generated public API" }),
        Series = OneOrMany<SeriesOption>.Many(new LineSeriesOption(), new RawSeriesOption("consumer")),
        Tooltip = OneOrMany<TooltipOption>.One(new()
        {
#if INVALID_CALLBACK
            ValueFormatter = "function(value) { return value; }"
#else
            ValueFormatter = JsFunction.Module<TooltipValueFormatterSignature>("/callbacks.js", "format"),
#endif
        }),
    };
}
