using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Tests.Fixtures.Serialization;

internal class FixtureNestedOptions : OptionObject
{
    private bool _show;
    private EChartsValue _data;

    public bool Show { get => _show; set => SetProperty(ref _show, value, "show"); }
    public EChartsValue Data { get => _data; set => SetProperty(ref _data, value, "data"); }
}

internal sealed class FixtureExtensionOptions : FixtureNestedOptions
{
    private string? _extension;

    public string? Extension { get => _extension; set => SetProperty(ref _extension, value, "extension"); }
}
