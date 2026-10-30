using System.Reflection;
using System.Xml.Linq;
using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class StaticAssetPathTests
{
    [Fact]
    public void CoreAssetPath_MatchesStaticWebAssetBasePath() =>
        Assert.Equal(StaticAssets.BasePath, BasePath("src/BlazorECharts/BlazorECharts.csproj"));

    [Fact]
    public void WordCloudAssetPath_MatchesStaticWebAssetBasePath()
    {
        // Act
        var field = typeof(WordCloudExtension).GetField("AssetBasePath", BindingFlags.NonPublic | BindingFlags.Static);

        // Assert
        Assert.NotNull(field);
        Assert.Equal(BasePath("src/BlazorECharts.WordCloud/BlazorECharts.WordCloud.csproj"), field.GetRawConstantValue());
        Assert.StartsWith((string)field.GetRawConstantValue()! + "/", new WordCloudExtension().ModuleUrl, StringComparison.Ordinal);
    }

    private static string BasePath(string project)
    {
        var path = Path.Combine(RepositoryRoot(), project);
        var value = XDocument.Load(path).Descendants("StaticWebAssetBasePath").Select(element => element.Value).SingleOrDefault();
        return value ?? throw new InvalidOperationException($"{project} must set StaticWebAssetBasePath explicitly.");
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "BlazorECharts.slnx")))
            directory = directory.Parent;

        return directory?.FullName ?? throw new InvalidOperationException("Repository root was not found.");
    }
}
