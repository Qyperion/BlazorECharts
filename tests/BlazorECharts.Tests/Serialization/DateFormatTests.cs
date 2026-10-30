using System.Globalization;
using System.Text;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>ECharts parseDate reads only the first three fraction digits and only the hours of an offset, so an instant
/// is written as UTC with exactly three millisecond digits.</summary>
public sealed class DateFormatTests
{
    public static TheoryData<DateTimeOffset, string> Instants => new()
    {
        { new DateTimeOffset(2026, 10, 19, 8, 30, 0, 100, TimeSpan.Zero), "2026-10-19T08:30:00.100Z" },
        { new DateTimeOffset(2026, 10, 19, 8, 30, 0, 500, TimeSpan.Zero), "2026-10-19T08:30:00.500Z" },
        { new DateTimeOffset(2026, 10, 19, 8, 30, 0, TimeSpan.Zero), "2026-10-19T08:30:00.000Z" },
        { new DateTimeOffset(2026, 10, 19, 14, 0, 0, 120, new TimeSpan(5, 30, 0)), "2026-10-19T08:30:00.120Z" },
        { new DateTimeOffset(2026, 10, 19, 5, 0, 0, 7, new TimeSpan(-3, -30, 0)), "2026-10-19T08:30:00.007Z" },
        { new DateTimeOffset(2026, 10, 19, 8, 30, 0, 999, TimeSpan.Zero).AddTicks(9999), "2026-10-19T08:30:00.999Z" },
    };

    [Theory]
    [MemberData(nameof(Instants))]
    public void DateTimeOffset_IsWrittenAsUtcWithThreeMillisecondDigits(DateTimeOffset value, string expected)
    {
        // Act & Assert
        Assert.Equal(expected, WriteData(value));
        Assert.Equal(expected, WriteValue(EChartsValue.From(value)));
        Assert.Equal(expected, WriteGlobal(value));
    }

    [Theory]
    [InlineData(100)]
    [InlineData(500)]
    [InlineData(0)]
    public void DateTime_UtcAndLocal_AreInstants(int milliseconds)
    {
        // Arrange
        var utc = new DateTime(2026, 10, 19, 8, 30, 0, milliseconds, DateTimeKind.Utc);
        var local = utc.ToLocalTime();
        var expected = "2026-10-19T08:30:00." + milliseconds.ToString("000", CultureInfo.InvariantCulture) + "Z";

        // Act & Assert
        Assert.Equal(expected, WriteData(utc));
        Assert.Equal(expected, WriteData(local));
        Assert.Equal(expected, WriteValue(EChartsValue.From(utc)));
        Assert.Equal(expected, WriteValue(EChartsValue.From(local)));
    }

    [Theory]
    [InlineData(100)]
    [InlineData(500)]
    [InlineData(0)]
    public void DateTime_Unspecified_IsWallClockWithThreeMillisecondDigits(int milliseconds)
    {
        // Arrange
        var value = new DateTime(2026, 10, 19, 8, 30, 0, milliseconds, DateTimeKind.Unspecified);
        var expected = "2026-10-19T08:30:00." + milliseconds.ToString("000", CultureInfo.InvariantCulture);

        // Act & Assert
        Assert.Equal(expected, WriteData(value));
        Assert.Equal(expected, WriteValue(EChartsValue.From(value)));
    }

    [Fact]
    public void WrittenInstant_ReadsBackAsTheSameMillisecond()
    {
        // Arrange
        var value = new DateTimeOffset(2026, 10, 19, 14, 0, 0, 500, new TimeSpan(5, 30, 0));

        // Act
        using var document = JsonDocument.Parse($$"""{"series":[{"type":"bar","data":["{{WriteData(value)}}"]}]}""");
        var bar = Assert.IsType<BarSeriesOption>(
            BlazorECharts.Serialization.Generated.GeneratedOptionMetadata.ReadChartOptions(document.RootElement).Series!.Value.Items[0]);

        // Assert
        Assert.True(bar.Data![0]!.Value.TryGet(out DateTimeOffset read));
        Assert.Equal(value.ToUnixTimeMilliseconds(), read.ToUnixTimeMilliseconds());
    }

    [Theory]
    [InlineData(DateTimeKind.Utc)]
    [InlineData(DateTimeKind.Local)]
    public void CoordinateValue_UtcAndLocalDateTime_AreNativeDateInstants(DateTimeKind kind)
    {
        // Arrange
        var utc = new DateTime(2026, 10, 19, 8, 30, 0, 120, DateTimeKind.Utc);
        var value = kind == DateTimeKind.Utc ? utc : utc.ToLocalTime();
        var expected = $$"""{"$date":{{new DateTimeOffset(utc).ToUnixTimeMilliseconds()}}}""";

        // Act & Assert
        Assert.Equal(expected, WriteCoordinate(CoordinateValue.From(value)));
        CoordinateValue converted = value;
        Assert.Equal(expected, WriteCoordinate(converted));
        CoordinateValue offset = new DateTimeOffset(utc);
        Assert.Equal(expected, WriteCoordinate(offset));
    }

    [Fact]
    public void CoordinateValue_UnspecifiedDateTime_IsWallClockIndependentOfTheProcessTimeZone()
    {
        // Arrange
        var value = new DateTime(2026, 10, 19, 8, 30, 0, 5, DateTimeKind.Unspecified);

        // Act & Assert
        Assert.Equal("\"2026-10-19T08:30:00.005\"", WriteCoordinate(CoordinateValue.From(value)));
        CoordinateValue converted = value;
        Assert.Equal("\"2026-10-19T08:30:00.005\"", WriteCoordinate(converted));
        Assert.Equal(WriteData(value), JsonDocument.Parse(WriteCoordinate(converted)).RootElement.GetString());
    }

    [Fact]
    public void DateOnly_IsACalendarDateEverywhere()
    {
        // Arrange
        var day = new DateOnly(2026, 10, 19);

        // Act & Assert
        Assert.Equal("\"2026-10-19\"", WriteCoordinate(CoordinateValue.From(day)));
        CoordinateValue converted = day;
        Assert.Equal("\"2026-10-19\"", WriteCoordinate(converted));
        Assert.Equal("2026-10-19", WriteData(day));
        Assert.Equal("2026-10-19", WriteValue(EChartsValue.From(day)));
        Assert.Equal("2026-10-19", WriteGlobal(day));
        Assert.Equal("""["2026-10-19"]""", GlobalArgument.Json(new[] { day }).GetRawText());
    }

    private static string WriteCoordinate(CoordinateValue value) =>
        MethodJson.Create(w => OptionMetadata.CreateContext().WriteValue(w, value, "$")).GetRawText();

    private static string WriteData(OptionDataValue value)
    {
        var item = new RadarSeriesDataItemOption { Value = [value] };
        return OptionSerializer.Serialize(item, OptionMetadata.CreateContext()).Json.GetProperty("value")[0].GetString()!;
    }

    private static string WriteValue(EChartsValue value)
    {
        var options = new ChartOptions();
        options.AdditionalProperties["when"] = value;
        return OptionSerializer.Serialize(options, OptionMetadata.CreateContext()).Json.GetProperty("when").GetString()!;
    }

    private static string WriteGlobal(object value)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
            GlobalArgument.Write(writer, value, OptionMetadata.CreateContext(), "$");

        return JsonDocument.Parse(Encoding.UTF8.GetString(stream.ToArray())).RootElement.GetString()!;
    }
}
