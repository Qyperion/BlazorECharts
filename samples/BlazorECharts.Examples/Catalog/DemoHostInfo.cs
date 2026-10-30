namespace BlazorECharts.Examples.Catalog;

/// <summary>Describes the host that renders the demo pages and the render modes it can switch between.</summary>
/// <param name="Name">The host kind shown in the diagnostics.</param>
/// <param name="Modes">The selectable modes: <c>server</c>, <c>wasm</c> and <c>auto</c>. Empty for a host with a single
/// fixed mode.</param>
public sealed record DemoHostInfo(string Name, IReadOnlyList<string> Modes)
{
    /// <summary>A Blazor Web App selecting Interactive Server, WebAssembly or Auto per page load.</summary>
    public static DemoHostInfo WebApp { get; } = new("Blazor Web App", ["server", "wasm", "auto"]);

    /// <summary>A standalone WebAssembly app served as static files.</summary>
    public static DemoHostInfo Standalone { get; } = new("Standalone WebAssembly", []);
}
