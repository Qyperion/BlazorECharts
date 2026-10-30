using BlazorECharts.Serialization;

namespace BlazorECharts.Options;

/// <summary>Extensible action base with an immutable native discriminator.</summary>
public abstract class ChartAction : OptionObject
{
    private string _type;

    /// <summary>Creates an explicit action discriminator.</summary>
    protected ChartAction(string type)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(type);
        _type = type;
        SetProperty(ref _type, type, "type");
    }

    /// <summary>Gets the exact native action type.</summary>
    public string Type => _type;
}
