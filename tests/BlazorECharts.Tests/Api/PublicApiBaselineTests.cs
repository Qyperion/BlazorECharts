using System.ComponentModel;
using BlazorECharts.WordCloud;
using Microsoft.AspNetCore.Components;
using Xunit;

namespace BlazorECharts.Tests.Api;

public sealed class PublicApiBaselineTests
{
    private const string AcceptVariable = "BLAZOR_ECHARTS_ACCEPT_PUBLIC_API";

    public static TheoryData<string> Assemblies => ["BlazorECharts", "BlazorECharts.WordCloud"];

    [Theory]
    [MemberData(nameof(Assemblies))]
    public void PublicSurface_MatchesApprovedBaseline(string assemblyName)
    {
        // Arrange
        var assembly = assemblyName == "BlazorECharts" ? typeof(EChart).Assembly : typeof(WordCloudSeriesOption).Assembly;

        // Act
        var actual = PublicApiSnapshot.Render(assembly);

        // Assert
        var root = RepositoryRoot();
        var baselinePath = Path.Combine(root, "tests", "BlazorECharts.Tests", "Api", "PublicApi", assemblyName + ".txt");
        if (Environment.GetEnvironmentVariable(AcceptVariable) == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(baselinePath)!);
            File.WriteAllText(baselinePath, actual);
        }

        var expected = File.Exists(baselinePath) ? File.ReadAllText(baselinePath).ReplaceLineEndings("\n") : "";
        if (expected == actual)
            return;

        var received = Path.Combine(root, "artifacts", "public-api", assemblyName + ".received.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(received)!);
        File.WriteAllText(received, actual);
        var expectedLines = PublicApiSnapshot.Qualify(expected);
        var actualLines = PublicApiSnapshot.Qualify(actual);
        var removed = expectedLines.Except(actualLines).ToArray();
        var added = actualLines.Except(expectedLines).ToArray();
        Assert.Fail(
            $"The public API of {assemblyName} differs from {Path.GetRelativePath(root, baselinePath)}: {removed.Length} removed, {added.Length} added. "
            + $"Review the change, then rerun with {AcceptVariable}=1 to accept it. Received: {Path.GetRelativePath(root, received)}\n"
            + string.Join("\n", removed.Take(25).Select(l => "- " + l).Concat(added.Take(25).Select(l => "+ " + l))));
    }

    [Fact]
    public void Snapshot_RendersSignatureDetailsThatAffectCompatibility()
    {
        // Act
        var text = PublicApiSnapshot.RenderType(typeof(SnapshotFixture));

        // Assert
        Assert.Equal("""
            public abstract class BlazorECharts.Tests.Api.SnapshotFixture : ComponentBase, IDisposable
              [EditorRequired] [Parameter] string Title { get; set; }
              [Obsolete("Use Title.")] string? Caption { get; init; }
              [Parameter] EventCallback<string?> Changed { get; set; }
              abstract ValueTask<int[]?> RunAsync(string? name, params int[] values)
              const int Limit = 3
              event EventHandler<Mode>? ModeChanged
              protected ctor(int seed = 2, Mode mode = Mode.B)
              protected virtual void OnMode(in Mode mode, out string? text, ref int counter)
              required int Seed { get; set; }
              static readonly IReadOnlyDictionary<string, object?> Empty
              string? Name { get; protected set; }
              void Dispose()
            """.ReplaceLineEndings("\n"), text);
        Assert.Equal("public enum BlazorECharts.Tests.Api.Mode : byte\n  A = 0\n  B = 2", PublicApiSnapshot.RenderType(typeof(Mode)));
        Assert.Equal(
            "public sealed record class BlazorECharts.Tests.Api.SnapshotRecord : IEquatable<SnapshotRecord>\n  ctor(string? Value)\n  string? Value { get; init; }",
            string.Join(
                "\n",
                PublicApiSnapshot.RenderType(typeof(SnapshotRecord))
                    .Split('\n')
                    .Where(
                        l => !l.Contains("Equals")
                            && !l.Contains("GetHashCode")
                            && !l.Contains("ToString")
                            && !l.Contains("op_")
                            && !l.Contains("Deconstruct"))));
        Assert.Equal(
            "public readonly struct BlazorECharts.Tests.Api.SnapshotValue<T> where T : class\n  T? Value { get; }",
            PublicApiSnapshot.RenderType(typeof(SnapshotValue<>)));
        Assert.Equal(
            "public delegate ValueTask BlazorECharts.Tests.Api.SnapshotHandler(string? value)",
            PublicApiSnapshot.RenderType(typeof(SnapshotHandler)));
        Assert.Equal("""
            public sealed class BlazorECharts.Tests.Api.SnapshotGeneric<T>
              IReadOnlyList<T> Items { get; }
              IReadOnlyList<T?> MaybeItems { get; }
              T Plain { get; }
              T? Maybe { get; }
              U Map<U>(Func<T, U> map, U? fallback) where U : notnull
              bool TryGet(out T value)
              ctor()
              static SnapshotGeneric<T> One(T value)
            """.ReplaceLineEndings("\n"), PublicApiSnapshot.RenderType(typeof(SnapshotGeneric<>)));
        Assert.Equal(
            "public static class BlazorECharts.Tests.Api.SnapshotExtensions\n  static bool TryRead(this IReadOnlyList<int?> values, out int? first)",
            PublicApiSnapshot.RenderType(typeof(SnapshotExtensions)));
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "BlazorECharts.slnx")))
            directory = directory.Parent;

        return directory?.FullName ?? throw new InvalidOperationException("Repository root was not found.");
    }
}

public enum Mode : byte { A = 0, B = 2 }

public sealed record SnapshotRecord(string? Value);

public readonly struct SnapshotValue<T> where T : class
{
    public T? Value { get; }
}

public delegate ValueTask SnapshotHandler(string? value);

public sealed class SnapshotGeneric<T>
{
    public T Plain { get; } = default!;
    public T? Maybe { get; }
    public IReadOnlyList<T> Items { get; } = [];
    public IReadOnlyList<T?> MaybeItems { get; } = [];

    public static SnapshotGeneric<T> One(T value) => new();

    public bool TryGet(out T value)
    {
        value = Plain;
        return true;
    }

    public U Map<U>(Func<T, U> map, U? fallback) where U : notnull => map(Plain);
}

public static class SnapshotExtensions
{
    public static bool TryRead(this IReadOnlyList<int?> values, out int? first)
    {
        first = values.Count > 0 ? values[0] : null;
        return first is not null;
    }
}

public abstract class SnapshotFixture : ComponentBase, IDisposable
{
    public const int Limit = 3;
    public static readonly IReadOnlyDictionary<string, object?> Empty = new Dictionary<string, object?>();

    protected SnapshotFixture(int seed = 2, Mode mode = Mode.B) { }

    [Parameter, EditorRequired] public string Title { get; set; } = "";
    [Obsolete("Use Title.")] public string? Caption { get; init; }
    [Parameter] public EventCallback<string?> Changed { get; set; }
    public required int Seed { get; set; }
    public string? Name { get; protected set; }
    internal int Hidden { get; set; }
    [EditorBrowsable(EditorBrowsableState.Never)] private protected int PrivateProtected { get; set; }

    public event EventHandler<Mode>? ModeChanged;

    public abstract ValueTask<int[]?> RunAsync(string? name, params int[] values);

    protected virtual void OnMode(in Mode mode, out string? text, ref int counter)
    {
        text = null;
        ModeChanged?.Invoke(this, mode);
    }

    public void Dispose() => GC.SuppressFinalize(this);
}
