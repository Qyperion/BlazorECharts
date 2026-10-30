using BrowserHost.Client.Shared;
using Bunit;
using Microsoft.AspNetCore.Components;
using Xunit;

namespace BlazorECharts.ComponentTests.Harness;

public sealed class InteractiveProbeTests : BunitContext
{
    [Fact]
    public void Increment_RendersNewCount()
    {
        // Arrange
        SetRendererInfo(new RendererInfo("Server", true));
        var component = Render<InteractiveProbe>();
        Assert.Equal("0", component.Find("[data-testid=count]").TextContent);

        // Act
        component.Find("[data-testid=increment]").Click();

        // Assert
        Assert.Equal("1", component.Find("[data-testid=count]").TextContent);
    }
}
