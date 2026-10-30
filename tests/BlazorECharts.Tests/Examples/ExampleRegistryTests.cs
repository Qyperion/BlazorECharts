using System.Collections;
using System.Reflection;
using System.Text.RegularExpressions;
using BlazorECharts.Examples;
using BlazorECharts.Examples.Capabilities;
using BlazorECharts.Options;
using BlazorECharts.Runtime;
using BlazorECharts.Serialization;
using BlazorECharts.Serialization.Generated;
using BlazorECharts.Testing;
using BlazorECharts.Values;
using BlazorECharts.WordCloud;
using Xunit;

namespace BlazorECharts.Tests.Examples;

public sealed class ExampleRegistryTests
{
    private static readonly string[] Scenarios =
        ["wordcloud", "calendar-heatmap", "sunburst-drilldown", "force-graph", "mirrored-time-area", "sankey-flow", "brush-period-picker"];

    private static readonly string[] Components =
        ["polar", "geo", "dataset", "markers", "piecewise-visual-map", "timeline", "media", "matrix", "thumbnail", "linked-grids", "axis-variants", "legend-toolbox"];

    private const string Appearance = "a global appearance setting, not a component";
    private const string Animation = "a global animation setting; the examples keep the ECharts defaults";
    private const string Compatibility = "a compatibility switch for charts written for older ECharts versions";

    // Every other public property of ChartOptions is a component that the catalog must show.
    private static readonly Dictionary<string, string> GlobalSettings = new(StringComparer.Ordinal)
    {
        [nameof(ChartOptions.Animation)] = Animation,
        [nameof(ChartOptions.AnimationDelay)] = Animation,
        [nameof(ChartOptions.AnimationDelayUpdate)] = Animation,
        [nameof(ChartOptions.AnimationDuration)] = Animation,
        [nameof(ChartOptions.AnimationDurationUpdate)] = Animation,
        [nameof(ChartOptions.AnimationEasing)] = Animation,
        [nameof(ChartOptions.AnimationEasingUpdate)] = Animation,
        [nameof(ChartOptions.AnimationThreshold)] = Animation,
        [nameof(ChartOptions.StateAnimation)] = Animation,
        [nameof(ChartOptions.Color)] = Appearance,
        [nameof(ChartOptions.ColorLayer)] = Appearance,
        [nameof(ChartOptions.BackgroundColor)] = Appearance,
        [nameof(ChartOptions.TextStyle)] = Appearance,
        [nameof(ChartOptions.DarkMode)] = Appearance,
        [nameof(ChartOptions.BlendMode)] = Appearance,
        [nameof(ChartOptions.RichInheritPlainLabel)] = Appearance,
        [nameof(ChartOptions.UseUTC)] = "a global time zone switch; the examples use instants that do not depend on it",
        [nameof(ChartOptions.HoverLayerThreshold)] = "a global rendering threshold for very large charts",
        [nameof(ChartOptions.LegacyMinMaxDontInverseAxis)] = Compatibility,
        [nameof(ChartOptions.LegacyViewCoordSysCenterBase)] = Compatibility,
    };

    public static TheoryData<string> Slugs => [.. ExampleRegistry.All.Select(example => example.Slug)];

    [Fact]
    public void Slugs_AreUniqueStableKebabCase()
    {
        // Act
        var slugs = ExampleRegistry.All.Select(example => example.Slug).ToArray();

        // Assert
        Assert.Equal(slugs.Length, slugs.Distinct(StringComparer.Ordinal).Count());
        Assert.All(slugs, slug => Assert.Matches(new Regex("^[a-z0-9]+(-[a-z0-9]+)*$"), slug));
        Assert.All(slugs, slug => Assert.Same(ExampleRegistry.All.Single(example => example.Slug == slug), ExampleRegistry.Find(slug)));
    }

    [Fact]
    public void Descriptors_HaveEnglishTitleSummaryAndLowercaseTags()
    {
        // Act & Assert
        Assert.All(ExampleRegistry.All, example =>
        {
            Assert.False(string.IsNullOrWhiteSpace(example.Title));
            Assert.EndsWith(".", example.Summary);
            Assert.NotEmpty(example.Tags);
            Assert.All(example.Tags, tag => Assert.Matches(new Regex("^[a-z0-9-]+$"), tag));
            Assert.DoesNotMatch(new Regex(@"\p{IsCyrillic}"), example.Title + example.Summary);
        });
    }

    [Fact]
    public void EveryStandardSeries_HasATypedExample()
    {
        // Act
        var covered = ExampleRegistry.All.Where(example => example.Tags.Contains("series"))
            .SelectMany(example => SeriesTypes(example.CreateOptions())).ToHashSet(StringComparer.Ordinal);

        // Assert
        Assert.All(StandardSeriesCatalog.Cases.Keys, series => Assert.Contains(series, covered));
    }

    [Fact]
    public void EverySeriesTypeOfTheLibrary_AppearsInTheCatalog()
    {
        // Act
        var types = typeof(SeriesOption).Assembly.GetExportedTypes()
            .Where(
                type => type.IsSealed
                    && type.IsSubclassOf(typeof(SeriesOption))
                    && type != typeof(RawSeriesOption)
                    && type.GetConstructor(Type.EmptyTypes) is not null)
            .Select(type => ((SeriesOption)Activator.CreateInstance(type)!).Type).ToArray();

        // Assert
        Assert.Equal(23, types.Length);

        // Act
        var covered = ExampleRegistry.All.SelectMany(example => SeriesTypes(example.CreateOptions())).ToHashSet(StringComparer.Ordinal);

        // Assert
        Assert.Empty(types.Where(type => !covered.Contains(type)).Order());
    }

    [Fact]
    public void ApplicationScenarios_ArePresent()
    {
        // Act
        var scenarios = ExampleRegistry.All.Where(example => example.Tags.Contains("scenario")).Select(example => example.Slug).ToArray();

        // Assert
        Assert.Equal(Scenarios.Order(), scenarios.Order());
    }

    [Fact]
    public void ComponentExamples_ArePresent()
    {
        // Act
        var components = ExampleRegistry.All.Where(example => example.Tags.Contains("component")).Select(example => example.Slug).ToArray();

        // Assert
        Assert.Equal(Components.Order(), components.Order());
    }

    [Fact]
    public void EveryComponentOfTheLibrary_AppearsInTheCatalog()
    {
        // Act
        var properties = typeof(ChartOptions).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.Name != nameof(OptionObject.AdditionalProperties)).ToArray();

        // Assert
        Assert.All(GlobalSettings.Keys, name => Assert.Contains(properties, property => property.Name == name));

        // Act
        var options = CatalogOptions();
        var missing = string.Join(", ", properties.Where(property => !GlobalSettings.ContainsKey(property.Name))
            .Where(property => !options.Any(option => Items(property.GetValue(option)).Any()))
            .Select(property => property.Name).Order());

        // Assert
        Assert.True(missing.Length == 0, $"No example sets {missing}.");
    }

    [Fact]
    public void EveryUnionVariant_AppearsInTheCatalog()
    {
        // Arrange
        var present = CatalogOptions()
            .SelectMany(options => new object?[] { options.VisualMap, options.DataZoom, options.XAxis, options.YAxis }.SelectMany(Items))
            .Select(component => component.GetType()).ToHashSet();
        (string Variant, Type[] Types)[] variants =
        [
            ("visualMap continuous", [typeof(ContinuousVisualMapOption)]),
            ("visualMap piecewise", [typeof(PiecewiseVisualMapOption)]),
            ("dataZoom slider", [typeof(SliderDataZoomOption)]),
            ("dataZoom inside", [typeof(InsideDataZoomOption)]),
            ("category axis", [typeof(XAxisCategoryOption), typeof(YAxisCategoryOption)]),
            ("value axis", [typeof(XAxisValueOption), typeof(YAxisValueOption)]),
            ("time axis", [typeof(XAxisTimeOption), typeof(YAxisTimeOption)]),
            ("log axis", [typeof(XAxisLogOption), typeof(YAxisLogOption)]),
        ];

        // Act & Assert
        Assert.Empty(variants.Where(variant => !variant.Types.Any(present.Contains)).Select(variant => variant.Variant));
    }

    [Fact]
    public void SeriesMarkers_AppearInTheCatalog()
    {
        // Arrange
        var series = CatalogOptions().SelectMany(options => Items(options.Series)).ToArray();
        string[] markers = [nameof(BarSeriesOption.MarkPoint), nameof(BarSeriesOption.MarkLine), nameof(BarSeriesOption.MarkArea)];

        // Act
        var missing = markers.Where(marker => !series.Any(item => item.GetType().GetProperty(marker)?.GetValue(item) is not null)).ToArray();

        // Assert
        Assert.Empty(missing);
    }

    [Fact]
    public void Catalog_CoversTheRequiredCapabilities()
    {
        // Arrange
        string[] tags = ["functions", "modules", "inline", "updates", "events", "actions", "theme", "locale", "maps", "registration",
            "extensions", "custom", "graphic", "references", "export", "connect", "component", "polar", "geo", "dataset", "transform",
            "markers", "visualmap", "timeline", "media", "matrix", "thumbnail", "axis-pointer", "axis", "legend", "toolbox"];

        // Act
        var present = ExampleRegistry.All.SelectMany(example => example.Tags).ToHashSet(StringComparer.Ordinal);

        // Assert
        Assert.All(tags, tag => Assert.Contains(tag, present));
    }

    [Theory]
    [MemberData(nameof(Slugs))]
    public void OptionsFactory_ProducesTypedOptionsWithoutRawFields(string slug)
    {
        // Arrange
        var example = ExampleRegistry.Find(slug)!;

        // Act
        var options = example.CreateOptions();

        // Assert
        Assert.NotSame(options, example.CreateOptions());
        Assert.Empty(RawFields(options, "option"));

        // Act
        var prepared = OptionSerializer.Serialize(options, Context());
        var root = prepared.Json.TryGetProperty("baseOption", out var baseOption) ? baseOption : prepared.Json;

        // Assert
        Assert.True(root.TryGetProperty("series", out _), $"{slug} has no series.");
    }

    [Theory]
    [MemberData(nameof(Slugs))]
    public void FunctionBindings_UseOnlyDeclaredModules(string slug)
    {
        // Arrange
        var example = ExampleRegistry.Find(slug)!;

        // Act
        var bindings = OptionSerializer.Serialize(example.CreateOptions(), Context()).Bindings;

        // Assert
        Assert.All(bindings.Where(binding => binding.Kind == JsBindingKind.Module), binding => Assert.Contains(binding.ModuleUrl!, example.Modules));
        Assert.Equal(slug == "inline-functions", bindings.Any(binding => binding.Kind == JsBindingKind.Inline));
        Assert.All(example.Modules, module => Assert.True(File.Exists(StaticAsset(module)), module));
    }

    [Theory]
    [MemberData(nameof(Slugs))]
    public void SourceView_ShowsTheVersionedSourceFile(string slug)
    {
        // Arrange
        var example = ExampleRegistry.Find(slug)!;
        var path = Path.Combine(RepositoryRoot(), "samples", "BlazorECharts.Examples", example.SourcePath);

        // Act & Assert
        Assert.True(File.Exists(path), path);
        Assert.Equal(Normalize(File.ReadAllText(path)), Normalize(ExampleSource.Read(example.SourcePath)));
        var type = example.Component ?? example.CreateOptions.Method.DeclaringType!;
        Assert.Contains(type.Name, ExampleSource.Read(example.SourcePath) + Path.GetFileNameWithoutExtension(example.SourcePath));
    }

    [Fact]
    public void InteractiveExamples_DeriveFromExampleBase()
    {
        // Act & Assert
        Assert.All(ExampleRegistry.All.Where(example => example.Component is not null),
            example => Assert.True(typeof(ExampleBase).IsAssignableFrom(example.Component), example.Slug));
    }

    [Fact]
    public void ExtensionsAndModules_ReferenceShippedAssets()
    {
        // Arrange
        var builder = new Microsoft.Extensions.DependencyInjection.ServiceCollection().AddECharts().AddExampleCatalog();
        var extensions = builder.Options.Extensions.ToDictionary(extension => extension.Id);

        // Act & Assert
        Assert.All(ExampleRegistry.All.SelectMany(example => example.Extensions), id => Assert.Contains(id, extensions.Keys));
        Assert.True(File.Exists(StaticAsset(extensions["examples-progress-series"].ModuleUrl)));
        Assert.True(File.Exists(StaticAsset(ExampleModules.BadgeImage)));
    }

    [Fact]
    public void Search_MatchesEveryTermByTitleOrTag()
    {
        // Act & Assert
        Assert.Equal(ExampleRegistry.All.Count, ExampleRegistry.Search(null).Count);
        Assert.Equal(["sunburst-drilldown"], ExampleRegistry.Search("sunburst").Select(example => example.Slug));
        Assert.Equal(Scenarios.Order(), ExampleRegistry.Search("scenario").Select(example => example.Slug).Order());
        Assert.Contains("exports", ExampleRegistry.Search("export connect").Select(example => example.Slug));
        Assert.Empty(ExampleRegistry.Search("series nothing-matches"));
    }

    private static EChartsSerializationContext Context()
    {
        var context = new EChartsSerializationContext { AllowInlineJavaScript = true };
        GeneratedOptionMetadata.Register(context);
        WordCloudTypeRegistration.Register(context);
        new ProgressSeriesExtension().ConfigureSerialization(context);
        return context;
    }

    // Every option of every example, with its base option, timeline steps and media options.
    private static ChartOptions[] CatalogOptions() => [.. ExampleRegistry.All.SelectMany(example => Graph(example.CreateOptions()))];

    private static IEnumerable<ChartOptions> Graph(ChartOptions options)
    {
        IEnumerable<ChartOptions?> nested = [options.BaseOption, .. options.Options ?? [], .. (options.Media ?? []).Select(media => media?.Option)];
        return [options, .. nested.OfType<ChartOptions>().SelectMany(Graph)];
    }

    // The option objects of a component property: a value, an array or OneOrMany, and the alternative held by a union.
    private static IEnumerable<object> Items(object? value)
    {
        if (value is null)
            return [];

        var type = value.GetType();
        if (value is IEnumerable items and not string)
            return items.Cast<object?>().SelectMany(Items);

        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(OneOrMany<>))
            return Items(type.GetProperty(nameof(OneOrMany<object>.Items))!.GetValue(value));

        if (type.IsValueType && type.GetProperty("Value") is { } alternative)
            return Items(alternative.GetValue(value));

        return [value];
    }

    private static IEnumerable<string> SeriesTypes(ChartOptions options) =>
        Values(options.Series).OfType<SeriesOption>().Select(series => series.Type);

    // Additional properties are the raw escape hatch; examples must use typed members only.
    private static List<string> RawFields(object? value, string path, HashSet<object>? visited = null)
    {
        visited ??= new(ReferenceEqualityComparer.Instance);
        var found = new List<string>();
        if (value is null or string || value.GetType().IsPrimitive || value is Delegate || (!value.GetType().IsValueType && !visited.Add(value)))
            return found;

        if (value is RawSeriesOption)
            found.Add(path);

        if (value is OptionObject option)
        {
            found.AddRange(option.AdditionalProperties.Keys.Select(key => $"{path}.{key}"));
            foreach (var property in value.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                if (property.GetIndexParameters().Length == 0 && property.Name != nameof(OptionObject.AdditionalProperties))
                    found.AddRange(RawFields(property.GetValue(value), $"{path}.{property.Name}", visited));
        }
        else if (value is IEnumerable items)
        {
            var index = 0;
            foreach (var item in items)
                found.AddRange(RawFields(item, $"{path}[{index++}]", visited));
        }
        else if (value.GetType().IsValueType && value.GetType().Namespace?.StartsWith("BlazorECharts", StringComparison.Ordinal) == true)
        {
            foreach (var field in value.GetType().GetFields(BindingFlags.NonPublic | BindingFlags.Instance))
                found.AddRange(RawFields(field.GetValue(value), path, visited));
        }

        return found;
    }

    private static IEnumerable<object> Values(object? value)
    {
        if (value is null)
            yield break;

        var fields = value.GetType().GetFields(BindingFlags.NonPublic | BindingFlags.Instance);
        foreach (var field in fields)
        {
            var inner = field.GetValue(value);
            if (inner is IEnumerable items and not string)
            {
                foreach (var item in items)
                    if (item is not null)
                        yield return item;
            }
            else if (inner is not null and not bool)
                yield return inner;
        }
    }

    private static string StaticAsset(string url)
    {
        const string prefix = "_content/BlazorECharts.Examples/";
        Assert.StartsWith(prefix, url);
        return Path.Combine(RepositoryRoot(), "samples", "BlazorECharts.Examples", "wwwroot", url[prefix.Length..]);
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "BlazorECharts.slnx")))
            directory = directory.Parent;

        return directory?.FullName ?? throw new DirectoryNotFoundException("The repository root was not found.");
    }

    private static string Normalize(string text) => text.Replace("\r\n", "\n", StringComparison.Ordinal);
}
