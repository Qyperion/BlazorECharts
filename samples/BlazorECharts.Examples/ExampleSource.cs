namespace BlazorECharts.Examples;

/// <summary>Reads the versioned example source files embedded in this assembly at build time.</summary>
public static class ExampleSource
{
    private const string Prefix = "Source/";

    /// <summary>Gets the embedded text of a source path relative to the examples project.</summary>
    public static string Read(string sourcePath)
    {
        var expected = Prefix + Normalize(sourcePath);
        var assembly = typeof(ExampleSource).Assembly;
        var name = assembly.GetManifestResourceNames().SingleOrDefault(resource => Normalize(resource) == expected)
            ?? throw new FileNotFoundException($"Example source '{sourcePath}' is not embedded.", sourcePath);
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static string Normalize(string path) => path.Replace('\\', '/');
}
