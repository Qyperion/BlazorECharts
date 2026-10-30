using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using BlazorECharts.Runtime;
using BlazorECharts.WordCloud;
using Microsoft.JSInterop;
using Xunit;

namespace BlazorECharts.Tests.Runtime;

public sealed class TrimmingContractTests
{
    // With the default partial trim mode a consumer trims only assemblies that declare themselves trimmable.
    [Theory]
    [InlineData(typeof(EChart))]
    [InlineData(typeof(WordCloudSeriesOption))]
    public void PackagedAssembly_DeclaresTrimmable(Type marker)
    {
        // Act
        var metadata = marker.Assembly.GetCustomAttributes<AssemblyMetadataAttribute>();

        // Assert
        Assert.Contains(metadata, attribute => attribute.Key == "IsTrimmable" && attribute.Value == "True");
    }

    // IL2091: the result type reaches IJSObjectReference.InvokeAsync<TValue>, which deserializes it by reflection.
    [Fact]
    public void RuntimeCall_ResultTypeCarriesJsInteropAnnotation()
    {
        // Arrange
        var invoke = typeof(IJSObjectReference).GetMethods().Single(method => method.Name == nameof(IJSObjectReference.InvokeAsync)
            && method.GetParameters().Select(parameter => parameter.ParameterType).SequenceEqual([typeof(string), typeof(object[])]));
        var required = MemberTypes(invoke);
        var call = typeof(EChartsRuntime).GetMethod("RuntimeCallAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;

        // Assert
        Assert.NotEqual(DynamicallyAccessedMemberTypes.None, required);
        Assert.Equal(required, MemberTypes(call) & required);
    }

    private static DynamicallyAccessedMemberTypes MemberTypes(MethodInfo method) =>
        method.GetGenericArguments()[0].GetCustomAttribute<DynamicallyAccessedMembersAttribute>()?.MemberTypes ?? DynamicallyAccessedMemberTypes.None;
}
