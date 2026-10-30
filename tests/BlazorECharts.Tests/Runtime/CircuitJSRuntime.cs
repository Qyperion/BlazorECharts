using System.Collections.Concurrent;
using System.Text.Json.Serialization.Metadata;
using Microsoft.JSInterop;
using Microsoft.JSInterop.Infrastructure;

namespace BlazorECharts.Tests.Runtime;

/// <summary>The real JS interop pipeline with an application default call timeout, as on an Interactive Server circuit,
/// and a browser that answers asynchronously or loses a reply.</summary>
internal sealed class CircuitJSRuntime : JSRuntime
{
    private int _charts;

    public CircuitJSRuntime(TimeSpan? defaultTimeout = null)
    {
        DefaultAsyncTimeout = defaultTimeout;

        // The test project disables reflection serialization by default, as trimmed hosts do; hosts supply a resolver.
        JsonSerializerOptions.TypeInfoResolver = new DefaultJsonTypeInfoResolver();
    }

    public ConcurrentQueue<(string Identifier, string Args)> Calls { get; } = new();
    public ConcurrentDictionary<int, byte[]> ByteArrays { get; } = new();

    /// <summary>Returns true to lose the reply of this call.</summary>
    public Func<string, bool> Lose { get; set; } = _ => false;

    public int Count(string identifier) => Calls.Count(c => c.Identifier == identifier);

    protected override void BeginInvokeJS(long taskId, string identifier, string? argsJson, JSCallResultType resultType, long targetInstanceId)
    {
        EndByteArrayCall(identifier);
        Calls.Enqueue((identifier, argsJson ?? "[]"));
        if (Lose(identifier))
            return;

        var result = identifier switch
        {
            "import" => """{"__jsObjectId":1}""",
            "openFacade" => "\"page:1\"",
            "createChart" => $"\"chart:{Interlocked.Increment(ref _charts)}\"",
            "invokeMethod" => """{"value":640,"bindings":[],"leaseId":null}""",
            _ => "null",
        };
        ThreadPool.QueueUserWorkItem(_ => DotNetDispatcher.EndInvokeJS(this, $"[{taskId},true,{result}]"));
    }

    protected override void EndInvokeDotNet(DotNetInvocationInfo invocationInfo, in DotNetInvocationResult invocationResult) { }

    /// <summary>Byte array calls whose initiation (argument serialization through BeginInvokeJS) overlapped another
    /// one.</summary>
    public int OverlappingByteArrayCalls => _overlaps;

    private int _initiating;
    private int _overlaps;

    protected override void SendByteArray(int id, byte[] data)
    {
        ByteArrays[id] = data;
        if (Interlocked.Increment(ref _initiating) > 1)
            Interlocked.Increment(ref _overlaps);

        Thread.SpinWait(500);
    }

    private void EndByteArrayCall(string identifier)
    {
        if (identifier == "setOption")
            Interlocked.Decrement(ref _initiating);
    }
}
