using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Microsoft.JSInterop;

namespace DocumentationExamples.Guides;

internal static class ErrorsExamples
{
    internal static async Task Awaited(EChartInstance chart, ChartOptions options)
    {
        // snippet: Guides.Errors.Awaited
        try
        {
            await chart.SetOptionAsync(options);
            await chart.GetDataUrlAsync();
        }
        catch (OptionSerializationException error)
        {
            Console.WriteLine($"Invalid option at {error.Path}: {error.Message}");
        }
        catch (TimeoutException)
        {
            Console.WriteLine("The chart did not become stable in time.");
        }
        catch (JSException error) when (error.Message.StartsWith("[ExportRendererUnsupported]", StringComparison.Ordinal))
        {
            Console.WriteLine("PNG export needs the canvas renderer.");
        }
        catch (JSDisconnectedException)
        {
            // Interactive Server: the circuit is gone; the browser cleans up the chart itself.
        }
        // endsnippet
    }

    internal static void Serialization()
    {
        // snippet: Guides.Errors.Serialization
        var options = new ChartOptions { Title = new TitleOption { Text = "A" } };
        options.AdditionalProperties["title"] = EChartsValue.From("B");   // collides with the typed Title

        try
        {
            OptionSerializer.Serialize(options, OptionMetadata.CreateContext());
        }
        catch (OptionSerializationException error)
        {
            Console.WriteLine(error.Path);
        }   // $.title
        // endsnippet
    }
}
