using BlazorECharts.Serialization;
using BlazorECharts.Values;

namespace BlazorECharts.Tests.Fixtures.Serialization;

// Handwritten transport fixtures, not production ECharts models.
internal sealed class FixtureOptions : OptionObject
{
    private string? _text;
    private bool _animation;
    private decimal _z;
    private EChartsValue[]? _data;
    private FixtureNestedOptions? _nested;
    private OneOrMany<FixtureNestedOptions> _components;
    private EChartsValue _value;

    public string? Text { get => _text; set => SetProperty(ref _text, value, "text"); }
    public bool Animation { get => _animation; set => SetProperty(ref _animation, value, "animation"); }
    public decimal Z { get => _z; set => SetProperty(ref _z, value, "z"); }
    public EChartsValue[]? Data { get => _data; set => SetProperty(ref _data, value, "data"); }
    public FixtureNestedOptions? Nested { get => _nested; set => SetProperty(ref _nested, value, "nested"); }
    public OneOrMany<FixtureNestedOptions> Components { get => _components; set => SetProperty(ref _components, value, "components"); }
    public EChartsValue Value { get => _value; set => SetProperty(ref _value, value, "value"); }

    public static EChartsSerializationContext CreateContext()
    {
        var context = new EChartsSerializationContext();
        context.Register(new OptionTypeRegistration<FixtureOptions>((writer, value, ctx, path) =>
        {
            ctx.WriteProperty(writer, value, "text", value.Text, path);
            ctx.WriteProperty(writer, value, "animation", value.Animation, path);
            ctx.WriteProperty(writer, value, "z", value.Z, path);
            ctx.WriteProperty(writer, value, "data", value.Data, path);
            ctx.WriteProperty(writer, value, "nested", value.Nested, path);
            ctx.WriteProperty(writer, value, "components", value.Components, path);
            ctx.WriteProperty(writer, value, "value", value.Value, path);
        }));
        context.Register(new OptionTypeRegistration<FixtureNestedOptions>((writer, value, ctx, path) =>
        {
            ctx.WriteProperty(writer, value, "show", value.Show, path);
            ctx.WriteProperty(writer, value, "data", value.Data, path);
        }));
        return context;
    }
}
