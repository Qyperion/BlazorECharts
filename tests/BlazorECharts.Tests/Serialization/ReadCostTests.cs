using System.Diagnostics;
using System.Text;
using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Tests.Fixtures.Serialization;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

[CollectionDefinition(nameof(ReadCostTests), DisableParallelization = true)]
public sealed class ReadCostCollection;

[Collection(nameof(ReadCostTests))]
public sealed class ReadCostTests
{
    [Fact]
    public void ReadArray_OfStructuredItems_IsLinear()
    {
        // Arrange
        Measure(1_000);

        // Act
        var small = Measure(40_000);
        var large = Measure(80_000);

        // Assert
        Assert.True(large <= 3 * small, $"Reading 80k [x,y] items took {large:F1} ms, 40k took {small:F1} ms.");
    }

    [Theory]
    [InlineData(false, 8)]
    [InlineData(true, 40)]
    public void Serialize_100kPoints_StaysWithinItsAllocationBudget(bool pairs, int megabytes)
    {
        // Arrange
        var data = new LineSeriesOptionDataItem?[100_000];
        for (var i = 0; i < data.Length; i++)
            data[i] = pairs ? new OptionDataValue?[] { i, i % 7 } : i % 7;

        var options = new ChartOptions { Series = new LineSeriesOption { Data = data } };
        var context = OptionMetadata.CreateContext();
        OptionSerializer.Serialize(options, context);
        GC.Collect();

        // Act
        var before = GC.GetAllocatedBytesForCurrentThread();
        OptionSerializer.Serialize(options, context);
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        // Assert
        Assert.True(
            allocated < megabytes * 1024L * 1024,
            $"Serializing 100k {(pairs ? "[x,y] pairs" : "numbers")} allocated {allocated / 1024 / 1024} MB.");
    }

    [Fact]
    public void UnionTryGet_FromJson_ReusesOneReadContext()
    {
        // Arrange
        using var document = JsonDocument.Parse("""{"series":[{"type":"bar","data":[{"value":1,"name":"a"}]}]}""");
        var item = Assert.IsType<BarSeriesOption>(GeneratedOptionMetadata.ReadChartOptions(document.RootElement).Series!.Value.Items[0]).Data![0]!.Value;
        Assert.True(item.TryGet(out BarDataItemOption? _));

        // Act
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < 100; i++)
            Assert.True(item.TryGet(out BarDataItemOption? _));

        // Assert
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        Assert.True(allocated < 2_000_000, $"100 TryGet calls allocated {allocated} bytes.");
    }

    [Fact]
    public void WordCloudUnionTryGet_FromJson_ReusesOneReadContext()
    {
        // Arrange
        using var document = JsonDocument.Parse("""{"textStyle":{"backgroundColor":{"image":"mask.svg"}}}""");
        var series = WordCloudTypeRegistration.ReadWordCloudSeriesOption(document.RootElement, Context());
        var background = series.TextStyle!.BackgroundColor!.Value;
        Assert.True(background.TryGet(out WordCloudImageBackground? _));

        // Act
        var before = GC.GetAllocatedBytesForCurrentThread();
        for (var i = 0; i < 100; i++)
            Assert.True(background.TryGet(out WordCloudImageBackground? _));

        // Assert
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        Assert.True(allocated < 2_000_000, $"100 TryGet calls allocated {allocated} bytes.");
    }

    [Fact]
    public void EventPayloads_ShareAReadOnlyContext()
    {
        // Arrange
        using var json = JsonDocument.Parse("{}");

        // Act
        var first = new Payload(json.RootElement);
        var second = new Payload(json.RootElement);

        // Assert
        Assert.Same(first.Serialization, second.Serialization);
        Assert.Throws<InvalidOperationException>(() => first.Serialization.Register(FixtureJsonContext.Default.FixtureData));
        Assert.Throws<InvalidOperationException>(
            () => first.Serialization.RegisterSeries(
                "custom-probe",
                new OptionTypeRegistration<RawSeriesOption>((w, v, c, p) => { }, (j, c) => RawSeriesOption.FromJson(j))));
    }

    private static EChartsSerializationContext Context()
    {
        var context = OptionMetadata.CreateContext();
        WordCloudTypeRegistration.Register(context);
        return context;
    }

    private static double Measure(int count)
    {
        var json = new StringBuilder("""{"series":[{"type":"line","data":[""");
        for (var i = 0; i < count; i++)
            json.Append(i == 0 ? "" : ",").Append('[').Append(i).Append(',').Append(i % 7).Append(']');

        json.Append("]}]}");
        using var document = JsonDocument.Parse(json.ToString());
        var best = double.MaxValue;
        for (var run = 0; run < 7; run++)
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            var watch = Stopwatch.StartNew();
            var options = GeneratedOptionMetadata.ReadChartOptions(document.RootElement);
            watch.Stop();
            Assert.Equal(count, Assert.IsType<LineSeriesOption>(options.Series!.Value.Items[0]).Data!.Length);
            best = Math.Min(best, watch.Elapsed.TotalMilliseconds);
        }

        return best;
    }

    private sealed class Payload(JsonElement json) : ChartEventPayload(json)
    {
        public EChartsSerializationContext Serialization => PayloadSerialization;
    }
}
