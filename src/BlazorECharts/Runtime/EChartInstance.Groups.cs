namespace BlazorECharts.Runtime;

public partial class EChartInstance
{
    internal EChartsRuntime? RuntimeOwner => _transport as EChartsRuntime;

    /// <summary>Reads the current native group through the ordered instance queue.</summary>
    public ValueTask<string?> GetGroupAsync(CancellationToken cancellationToken = default) =>
        ReadAsync("getGroup", [], v => v.ValueKind == System.Text.Json.JsonValueKind.Null ? null : v.GetString(), cancellationToken);

    /// <summary>Sets native group membership. Connecting and disconnecting a group do not erase membership.</summary>
    public ValueTask SetGroupAsync(string group, CancellationToken cancellationToken = default) =>
        VoidAsync("setGroup", [group ?? throw new ArgumentNullException(nameof(group))], cancellationToken);
}
