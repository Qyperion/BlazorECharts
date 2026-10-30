using System.Collections;
using System.Reflection;
using System.Text.Json;
using BlazorECharts.Options;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Values;
using Xunit;

namespace BlazorECharts.Tests.Serialization;

/// <summary>getOption() snapshots of the pinned ECharts 6.1.0 (tools/Snapshots/echarts-snapshots.mjs) read into typed
/// options.</summary>
public sealed class SnapshotReadTests
{
    private static readonly string Directory = Path.Combine(AppContext.BaseDirectory, "Fixtures", "echarts-6.1.0-snapshots");

    public static TheoryData<string> Snapshots() =>
        [.. System.IO.Directory.GetFiles(Directory, "*.json").Select(file => Path.GetFileNameWithoutExtension(file)).Order()];

    private static ChartOptions Read(string name)
    {
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(Directory, name + ".json")));
        return GeneratedOptionMetadata.ReadChartOptions(json.RootElement);
    }

    [Theory]
    [MemberData(nameof(Snapshots))]
    public void EveryUnionValue_ReadsAsExactlyOneAlternative(string snapshot)
    {
        // Arrange
        var walk = new UnionWalk();

        // Act
        walk.Visit(Read(snapshot), "option");

        // Assert
        Assert.True(walk.Ambiguous.Count == 0, string.Join(Environment.NewLine, walk.Ambiguous));
        Assert.True(walk.Unions > 10, $"{snapshot} checked {walk.Unions} union values");
    }

    [Fact]
    public void Snapshots_CoverTheUnionsOfTypicalCharts()
    {
        // Arrange
        var walk = new UnionWalk();

        // Act
        foreach (var snapshot in Snapshots())
            walk.Visit(Read(snapshot), snapshot + ":option");

        // Assert
        Assert.True(walk.Types.Count > 80, $"{walk.Types.Count} union types: {string.Join(", ", walk.Types.Order())}");
    }

    [Fact]
    public void RadarDataItem_ReadsNameAndValueVector()
    {
        // Act
        var radar = Assert.Single(Read("shapes").Series!.Value.Items.OfType<RadarSeriesOption>());

        // Assert
        Assert.True(radar.Data![0]!.Value.TryGet(out RadarSeriesDataItemOption? item));
        Assert.True(item.Name!.Value.TryGet(out string? name) && name == "One");
        Assert.Equal(3, item.Value!.Length);
    }

    [Fact]
    public void OptionalTypeLiteral_ThatDoesNotSelectTheForm_MayBeMissing()
    {
        // Arrange
        using var json = JsonDocument.Parse("""
            {"graphic":{"elements":[{"type":"rect","shape":{"width":4,"height":2},"textContent":{"style":{"text":"A"}}}]},
             "series":[{"type":"bar","itemStyle":{"color":{"image":"data:,","repeat":"repeat"}}}],
             "matrix":{"x":{"data":["A"]},"y":{"type":"category","data":["B"]}}}
            """);

        // Act
        var options = GeneratedOptionMetadata.ReadChartOptions(json.RootElement);

        // Assert
        Assert.True(options.Graphic!.Value.Items[0]!.Value.TryGet(out GraphicComponentOption? graphic));
        Assert.True(graphic.Elements![0]!.Value.TryGet(out GraphicRectOption? rect));
        Assert.NotNull(rect.TextContent!.Style);
        var bar = Assert.IsType<BarSeriesOption>(options.Series!.Value.Items[0]);
        Assert.True(bar.ItemStyle!.Color!.Value.TryGet(out ImagePatternObject? pattern));
        Assert.NotNull(pattern.Image);
        Assert.NotNull(options.Matrix!.Value.Items[0].X!.Data);
    }

    /// <summary>Visits typed members; a union read from JSON must match exactly one alternative.</summary>
    private sealed class UnionWalk
    {
        public List<string> Ambiguous { get; } = [];
        public HashSet<string> Types { get; } = [];
        public int Unions { get; private set; }

        private readonly HashSet<object> _seen = new(ReferenceEqualityComparer.Instance);

        public void Visit(object? value, string path)
        {
            switch (value)
            {
                case null:
                    return;
                case string or double or bool or int or EChartsValue or JsonElement:
                    return;
                case OptionObject model:
                    if (!_seen.Add(model))
                        return;

                    foreach (var property in model.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                        if (property.GetIndexParameters().Length == 0 && property.Name != nameof(OptionObject.AdditionalProperties))
                            Visit(property.GetValue(model), $"{path}.{property.Name}");

                    return;
                case IDictionary dictionary:
                    foreach (DictionaryEntry entry in dictionary)
                        Visit(entry.Value, $"{path}[{entry.Key}]");

                    return;
                case Array array:
                    for (var i = 0; i < array.Length; i++)
                        Visit(array.GetValue(i), $"{path}[{i}]");

                    return;
            }

            var type = value.GetType();

            // OneOrMany<T> and the generated XOneOrMany structs of a union X.
            if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(OneOrMany<>)
                || type.Name.EndsWith("OneOrMany", StringComparison.Ordinal))
            {
                var items = (IEnumerable)type.GetProperty(nameof(OneOrMany<int>.Items))!.GetValue(value)!;
                var i = 0;
                foreach (var item in items)
                    Visit(item, $"{path}[{i++}]");

                return;
            }

            if (type.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IReadableOptionValue<>)))
                Union(value, type, path);
        }

        private void Union(object value, Type type, string path)
        {
            var tryGets = type.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(m => m.Name == "TryGet" && m.GetParameters().Length == 1)
                .ToArray();
            if (tryGets.Length == 0) // A tuple: its items are typed values.
            {
                foreach (var item in type.GetProperties().Where(p => p.Name.StartsWith("Item", StringComparison.Ordinal)))
                    Visit(item.GetValue(value), $"{path}.{item.Name}");

                return;
            }

            if (type.GetProperty("Value")!.GetValue(value) is not EChartsValue)
                return;

            Unions++;
            Types.Add(type.Name);
            var matched = new List<(Type Type, object? Value)>();
            foreach (var tryGet in tryGets)
            {
                var arguments = new object?[] { null };
                if ((bool)tryGet.Invoke(value, arguments)!)
                    matched.Add((tryGet.GetParameters()[0].ParameterType.GetElementType()!, arguments[0]));
            }

            // TryGet(out string) also reads a date string that TryGet(out DateTimeOffset) reads as an instant; EChartsValue is the open fallback.
            var alternatives = matched.Where(m => m.Type != typeof(EChartsValue) || matched.Count == 1)
                .Where(m => m.Type != typeof(DateTimeOffset) || !matched.Any(o => o.Type == typeof(string))).ToList();

            // Models with the same members are one JSON shape (AxisLabelOption instantiations, slider and base timeline).
            static string Members(Type model) => string.Join(",", model.GetProperties().Select(p => p.Name).Order());

            if (alternatives.Count > 1
                && alternatives.All(a => a.Type.IsSubclassOf(typeof(OptionObject)))
                && alternatives.Select(a => Members(a.Type)).Distinct().Count() == 1)
                alternatives = [alternatives[0]];

            if (alternatives.Count != 1)
                Ambiguous.Add($"{path}: {type.Name} matches {(alternatives.Count == 0 ? "no alternative" : string.Join(", ", alternatives.Select(a => a.Type.Name)))}");

            foreach (var alternative in alternatives)
                Visit(alternative.Value, $"{path}<{alternative.Type.Name}>");
        }
    }
}
