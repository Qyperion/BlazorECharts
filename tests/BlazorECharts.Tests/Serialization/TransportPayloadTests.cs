using System.Text;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>setOption bytes go to TextDecoder and JSON.parse, never into HTML: only JSON itself needs escaping there.</summary>
[Collection(nameof(ReadCostTests))]
public sealed class TransportPayloadTests
{
    [Theory]
    [InlineData("Продажі")]
    [InlineData("销售额")]
    [InlineData("<b>&'+`</b>")]
    public void Utf8_CarriesTextUnescaped(string text)
    {
        // Act
        var prepared = OptionSerializer.Serialize(new ChartOptions { Title = new TitleOption { Text = text } }, OptionMetadata.CreateContext());

        // Assert
        var expected = $$$"""{"title":{"text":"{{{text}}}"}}""";
        Assert.Equal(expected, Encoding.UTF8.GetString(prepared.Utf8));
        Assert.Equal(Encoding.UTF8.GetByteCount(expected), prepared.Utf8.Length);
    }

    [Fact]
    public void Utf8_StaysValidJson_ForQuotesBackslashesAndControlCharacters()
    {
        // Arrange
        const string text = "a\"b\\c\n\t\u0001\u2028";

        // Act
        var prepared = OptionSerializer.Serialize(new ChartOptions { Title = new TitleOption { Text = text } }, OptionMetadata.CreateContext());

        // Assert
        using var parsed = JsonDocument.Parse(prepared.Utf8);
        Assert.Equal(text, parsed.RootElement.GetProperty("title").GetProperty("text").GetString());
    }

    [Fact]
    public void Json_KeepsItsHtmlSafeEscaping()
    {
        // Act
        var prepared = OptionSerializer.Serialize(
            new ChartOptions { Title = new TitleOption { Text = "Продажі 销售额 <b>&'+\"" } },
            OptionMetadata.CreateContext());

        // Assert
        Assert.Equal(
            """{"title":{"text":"\u041F\u0440\u043E\u0434\u0430\u0436\u0456 \u9500\u552E\u989D \u003Cb\u003E\u0026\u0027\u002B\u0022"}}""",
            prepared.Json.GetRawText());
    }

    [Fact]
    public void RawJson_SendsUnescapedBytes_AndKeepsItsOwnText()
    {
        // Arrange
        const string raw = """{"title":{"text":"\u041F <b>"}}""";
        using var document = JsonDocument.Parse(raw);

        // Act
        var prepared = OptionSerializer.Serialize(document.RootElement, OptionMetadata.CreateContext());

        // Assert
        Assert.Equal("""{"title":{"text":"П <b>"}}""", Encoding.UTF8.GetString(prepared.Utf8));
        Assert.Equal(raw, prepared.Json.GetRawText());
    }

    [Fact]
    public void Serialize_Line100k_AllocatesLittleBeyondThePayload()
    {
        // Arrange
        var options = Line(100_000);
        var context = OptionMetadata.CreateContext();
        OptionSerializer.Serialize(options, context);
        GC.Collect();

        // Act
        var before = GC.GetAllocatedBytesForCurrentThread();
        var prepared = OptionSerializer.Serialize(options, context);
        var overhead = GC.GetAllocatedBytesForCurrentThread() - before - prepared.Utf8.Length;

        // Assert
        Assert.True(overhead < 256 * 1024, $"Serializing line-100k ({prepared.Utf8.Length} B) allocated {overhead / 1024} KiB beyond the payload.");
    }

    // The line-100k workload of tests/browser/performance.
    internal static ChartOptions Line(int points)
    {
        var random = new Random(20261023);
        var data = new LineSeriesOptionDataItem?[points];
        var value = 100d;
        for (var i = 0; i < points; i++)
        {
            value += random.NextDouble() - 0.5;
            data[i] = Math.Round(value, 2);
        }

        return new ChartOptions { Series = new LineSeriesOption { Data = data } };
    }
}
