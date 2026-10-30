using System.Collections;
using System.Reflection;
using System.Text.Json;
using BlazorECharts.Events;
using BlazorECharts.Serialization;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Api;

/// <summary>
/// Payloads of the pinned ECharts 6.1.0 captured by tests/browser/event-conformance.spec.ts, read through every public
/// member of their typed events. The spec checks member names and primitive kinds; this test runs the typed getters.
/// </summary>
public sealed class EventPayloadReadTests
{
    private static readonly string Fixture = Path.Combine(AppContext.BaseDirectory, "Fixtures", "echarts-6.1.0-events.json");

    /// <summary>A getter that may throw on these payloads, by "Event.Member" path without indices, with its reason.</summary>
    private static readonly Dictionary<string, string> Allowed = new(StringComparer.Ordinal);

    private static Dictionary<string, object> Descriptors() =>
        typeof(ChartEvents).GetProperties(BindingFlags.Public | BindingFlags.Static)
            .Select(p => p.GetValue(null)!)
            .ToDictionary(d => (string)d.GetType().GetProperty(nameof(ChartEvent<object>.Name))!.GetValue(d)!, StringComparer.Ordinal);

    [Fact]
    public void EveryTypedMember_ReadsTheCapturedPayloads()
    {
        // Arrange
        using var fixture = JsonDocument.Parse(File.ReadAllText(Fixture));

        // Act
        var descriptors = Descriptors();

        // Assert
        Assert.Equal(52, descriptors.Count);
        Assert.Equal(
            descriptors.Keys.Order(StringComparer.Ordinal),
            fixture.RootElement.EnumerateObject().Select(e => e.Name).Order(StringComparer.Ordinal));

        // Arrange
        var walk = new MemberWalk();

        // Act
        foreach (var captured in fixture.RootElement.EnumerateObject())
        {
            var descriptor = descriptors[captured.Name];
            var read = descriptor.GetType().GetMethod("Read", BindingFlags.NonPublic | BindingFlags.Instance)!;
            var i = 0;
            foreach (var payload in captured.Value.EnumerateArray())
            {
                var value = read.Invoke(descriptor, [payload.GetProperty("json")])!;
                walk.Visit(value, value.GetType().Name, $"{captured.Name}#{i++}");
            }
        }

        // Assert
        Assert.True(walk.Failures.Count == 0, string.Join(Environment.NewLine, walk.Failures));
        Assert.Empty(Allowed.Keys.Except(walk.Allowed));
        Assert.True(walk.Members > 1500, $"{walk.Members} members read");
    }

    [Fact]
    public void BrushCoordRange_ReadsCategoriesDatesAndMixedPoints()
    {
        // Arrange
        using var json = JsonDocument.Parse("""
            {"type":"brush","areas":[{"brushType":"lineX","coordRange":["2026-01-01","2026-02-01"]},{"brushType":"polygon","coordRange":[["x",3],["y",5]],"coordRanges":[[["x",3]]]}]}
            """);

        // Act
        var areas = new BrushEvent(json.RootElement).Areas!;

        // Assert
        Assert.True(areas[0].CoordRange!.Value.TryGetStrings(out var dates));
        Assert.Equal(["2026-01-01", "2026-02-01"], dates);
        Assert.Equal(JsonValueKind.Array, areas[1].CoordRange!.Value.Json[0].ValueKind);
        Assert.Equal(3, areas[1].CoordRanges!.Value.Json[0][0][1].GetDouble());
    }

    [Fact]
    public void BrushSelectedBatch_FieldThatFailsToRead_DoesNotHideTheOthers()
    {
        // Arrange
        using var json = JsonDocument.Parse("""
            {"type":"brushselected","batch":[{"brushId":"b","areas":[{"brushType":"rect","coordRange":{"x":1}}],"selected":[{"seriesIndex":0,"dataIndex":[1]}]}]}
            """);

        // Act
        var item = Assert.Single(new BrushSelectedEvent(json.RootElement).Batch!);

        // Assert
        Assert.Equal([1], Assert.Single(item.Selected!).DataIndex!);
        var area = Assert.Single(item.Areas!);
        Assert.True(area.BrushType!.Value.TryGetString(out var type) && type == "rect");
        var error = Assert.Throws<JsonException>(() => area.CoordRange);
        Assert.Contains("coordRange", error.Message, StringComparison.Ordinal);

        // Act
        area.CoordRange = new[] { 1d, 2d };

        // Assert
        Assert.Equal(2, area.CoordRange!.Value.Json.GetArrayLength());
    }

    /// <summary>Reads every public member recursively; a getter that throws is a failure unless allowed.</summary>
    private sealed class MemberWalk
    {
        public List<string> Failures { get; } = [];
        public HashSet<string> Allowed { get; } = [];
        public int Members { get; private set; }

        public void Visit(object? value, string member, string at)
        {
            switch (value)
            {
                case null or string or double or bool or int or JsonElement or EChartsValue or EventActionValue:
                    return;
                case IDictionary dictionary:
                    foreach (DictionaryEntry entry in dictionary)
                        Visit(entry.Value, member, $"{at}[{entry.Key}]");

                    return;
                case Array array:
                    for (var i = 0; i < array.Length; i++)
                        Visit(array.GetValue(i), member, $"{at}[{i}]");

                    return;
                case ChartEventPayload or OptionObject:
                    foreach (var property in value.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                        if (property.GetIndexParameters().Length == 0
                            && property.DeclaringType != typeof(ChartEventPayload)
                            && property.DeclaringType != typeof(OptionObject))
                            Read(value, property, $"{member}.{property.Name}", $"{at}.{property.Name}");

                    return;
            }

            var type = value.GetType();

            // OneOrMany<T> and the generated XOneOrMany structs of a union X.
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(OneOrMany<>)
                || type.Name.EndsWith("OneOrMany", StringComparison.Ordinal))
            {
                var i = 0;
                foreach (var item in (IEnumerable)type.GetProperty(nameof(OneOrMany<int>.Items))!.GetValue(value)!)
                    Visit(item, member, $"{at}[{i++}]");

                return;
            }

            foreach (var tryGet in type.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(m => m.Name == "TryGet" && m.GetParameters().Length == 1))
            {
                var arguments = new object?[] { null };
                if ((bool)tryGet.Invoke(value, arguments)!)
                    Visit(arguments[0], $"{member}<{tryGet.GetParameters()[0].ParameterType.GetElementType()!.Name}>", at);
            }

            foreach (var item in type.GetProperties()
                .Where(p => p.Name.StartsWith("Item", StringComparison.Ordinal) && p.GetIndexParameters().Length == 0))
                Read(value, item, $"{member}.{item.Name}", $"{at}.{item.Name}");
        }

        private void Read(object owner, PropertyInfo property, string member, string at)
        {
            Members++;
            object? value;
            try
            {
                value = property.GetValue(owner);
            }
            catch (TargetInvocationException error) when (error.InnerException is { } inner)
            {
                if (EventPayloadReadTests.Allowed.ContainsKey(member))
                    Allowed.Add(member);
                else
                    Failures.Add($"{at}: {inner.GetType().Name}: {inner.Message}");

                return;
            }

            Visit(value, member, at);
        }
    }
}
