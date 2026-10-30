# Errors

Failures reach you in three ways: an awaited call throws, the component's `OnError` callback runs
for work you did not await, and the chart container raises a DOM event for failures in the browser.

## OnError

`EChart.OnError` receives an `EChartsError` for automatic initialization, parameter updates,
recreation and browser resize failures:

<!-- snippet: Guides.Errors.OnError -->
```razor
<EChart Options="_options" Style="height:300px" OnError="OnErrorAsync" />
@if (_error is not null)
{
    <p role="alert">@_error.Operation failed (@_error.Code): @_error.Message</p>
}

@code {
    private readonly ChartOptions _options = new();
    private EChartsError? _error;

    private Task OnErrorAsync(EChartsError error)
    {
        _error = error;   // Code, Message, Operation, ChartId, UpstreamVersion, Exception
        return Task.CompletedTask;
    }
}
```

| Code | When |
|---|---|
| `ChartInitializationFailed` | The chart could not initialize. `State` becomes `Failed`; `InitializeAsync()` retries. |
| `ChartUpdateFailed` | An automatic update, a theme change, a recreation or `UpdateAsync` failed. |
| `CircuitDisconnected` | Interactive Server lost the circuit during initialization. |
| `CallbackFailed` | Browser event only: a .NET callback of the component, such as a size notification, failed while the circuit was connected. |
| `ChartResizeFailed` | The browser could not resize the chart. |
| `ChartDisposed` | `EChart.Instance` was disposed outside the component. `State` becomes `Failed`; `InitializeAsync()` creates a new chart. |

`Operation` names the failed step (`initialize`, `setOption`, `setTheme`, `recreate`, `resize`,
`dispose`), `ChartId` the chart when one was allocated, and `Exception` the original exception.
`DetailCode` is the [code](#error-codes) of the underlying failure, for example
`RuntimeLoadFailed` under `ChartInitializationFailed`, or null when the exception has none. An explicitly
awaited `InitializeAsync` or `UpdateAsync` also throws.

Every notification is also logged by `ILogger<EChart>`: at `Error` when the component has no
`OnError`, so a failure is never silent, and at `Debug` otherwise. Failures that the browser
reports on its own, such as `ChartResizeFailed`, log at `Warning`. The component passes each such
code on at most once in 10 seconds, at most five reports in that time, and shortens their messages
to 1,024 characters.

An exception of an [event handler](events.md) is logged by `ILogger<EChartInstance>` at `Error`
when the runtime comes from `AddECharts`: at most once per subscription in 10 seconds and five
times per chart in that time. The browser delivery still fails, which raises `EventHandlerFailed`
on the [browser error event](#browser-error-event).

An exception thrown by your
`OnError` handler is not swallowed: it reaches the Blazor renderer like an exception in an event
handler. Operations queued on `EChart.Instance` while the first initialization fails throw that
failure instead of a cancellation.

## Exceptions of awaited calls

<!-- snippet: Guides.Errors.Awaited -->
```csharp
try
{
    await chart.SetOptionAsync(options);
    await chart.GetDataUrlAsync();
}
catch (OptionSerializationException error)
{
    Console.WriteLine($"Invalid option at {error.Path}: {error.Message}");
}
catch (TimeoutException)
{
    Console.WriteLine("The chart did not become stable in time.");
}
catch (JSException error) when (error.Message.StartsWith("[ExportRendererUnsupported]", StringComparison.Ordinal))
{
    Console.WriteLine("PNG export needs the canvas renderer.");
}
catch (JSDisconnectedException)
{
    // Interactive Server: the circuit is gone; the browser cleans up the chart itself.
}
```

| Exception | Cause |
|---|---|
| `OptionSerializationException` | The options cannot be serialized: an uninitialized value, an additional field that collides with a typed property, unregistered custom data, a disabled inline function. `Path` is the JSON path, `ClrType` the rejected type. |
| `ArgumentException` | A literal union got a value outside its alternatives, or an argument is invalid. |
| `JsonException` | `GetOptionAsync` read a value that does not fit its typed member. `Path` is the JSON path of the value. |
| `InvalidOperationException` | The chart queue is full (64 pending operations). `EChart` also throws it while rendering when both `Options` and `RawOptions` are set. `SetOptionAsync(snapshot)` throws it when an edit moved or replaced a snapshot reference; the message names the path. |
| `ObjectDisposedException` | The chart, component or runtime was disposed. |
| `TimeoutException` | `AwaitStableAsync` or an export did not become stable within its timeout, or a call got no reply within the JS interop call timeout: the message starts with `[ResultTimeout]` (see [Interactive Server](render-modes.md#message-size-on-interactive-server)). |
| `OperationCanceledException` | The call was cancelled. |
| `JSException` | ECharts or the browser bridge rejected the call. The message starts with `[Code]`. |
| `JSDisconnectedException` | Interactive Server: the circuit is gone. |

Serialization errors carry the JSON path of the value:

<!-- snippet: Guides.Errors.Serialization -->
```csharp
var options = new ChartOptions { Title = new TitleOption { Text = "A" } };
options.AdditionalProperties["title"] = EChartsValue.From("B");   // collides with the typed Title

try
{
    OptionSerializer.Serialize(options, OptionMetadata.CreateContext());
}
catch (OptionSerializationException error)
{
    Console.WriteLine(error.Path);
}   // $.title
```

## Error codes

Coded failures start their message with the code in brackets (`[ChartDisposed] ...`): a
`JSException` from the browser, an `InvalidOperationException` from the library, and the browser
error event. `EChartsError.DetailCode` carries the code to `OnError`.

| Area | Codes |
|---|---|
| Runtime and providers | `RuntimeConfigurationInvalid`, `RuntimeConfigurationConflict`, `RuntimeLoadFailed`, `RuntimeVersionMismatch`, `RuntimeCapabilityMissing`, `FacadeDisposed`, `FacadeIdentityInvalid` |
| Charts | `ChartDisposed`, `ChartElementInUse`, `ChartElementRemoved`, `ChartContainerNotReady`, `ChartCapabilityMissing`, `ChartCommandStale`, `ChartObservationConflict`, `ChartResizeFailed` |
| Methods and actions | `ActionInvalid`, `AppendDataUnsupported`, `CoordinateInvalid`, `MethodNotSupported`, `GlobalMethodNotSupported`, `InstanceMethodFailed` |
| Events | `SubscriptionInvalid`, `SubscriptionConflict`, `EventHandlerFailed` |
| Images and layout | `ImageLoadFailed`, `ImageDecodeFailed`, `LayoutFailed`, `LayoutCancelled`, `LayoutScopeInvalid` |
| Stability and export | `StabilityTimeout`, `StabilityTimeoutInvalid`, `StabilityCapabilityMissing`, `ExportFormatUnsupported`, `ExportRendererUnsupported`, `ExportMethodUnsupported`, `ExportIdentityConflict`, `ExportUpstreamFailed`, `ExportFailed`, `ExportCancelled`, `ExportEnded`, `ExportCleanupUnavailable`, `ExportCapabilityMissing` |
| Extensions | `ExtensionDescriptorInvalid`, `ExtensionIdentityConflict`, `ExtensionDependencyMissing`, `ExtensionDependencyCycle`, `ExtensionCapabilityMissing` |
| Connection | `CircuitDisconnected`, `CallbackFailed`, `ResultTooLarge` (a result over `EChartsRuntimeOptions.MaximumServerResultSize`), `EventTooLarge` (browser error event: an event over that limit was not delivered), `ResultTimeout` (`TimeoutException`: no reply within the JS interop call timeout, on Interactive Server `CircuitOptions.JSInteropDefaultCallTimeout`, 1 minute by default) |
| Library (`InvalidOperationException`) | `CoordinateConversionUnavailable` (a coordinate conversion found no coordinate system), `ActionMappingUnavailable` (an event has no matching action), `VisualUnavailable` (a series has no such visual) |

Messages name the failed operation, the chart and, for module functions, the module URL and export.
`RuntimeVersionMismatch` also reports a page that kept the browser scripts of another package
version after an update, for example across enhanced navigation; reload the page
([updating the application](render-modes.md#updating-the-application)).

## Browser error event

The chart container raises a bubbling `blazorecharts:error` DOM event for failures that happen in
the browser without a .NET caller: resize failures, event handlers that throw (`EventHandlerFailed`,
with the subscription ID), events too large for the Interactive Server message limit
(`EventTooLarge`, with the subscription ID), calls that cannot reach .NET because the circuit is
down (`CircuitDisconnected`) and failed asynchronous layouts (`LayoutFailed`), such as a WordCloud
whose web font or mask did not load. It works even while Interactive Server is disconnected.

```javascript
document.addEventListener('blazorecharts:error', event => {
  const { code, message, operation } = event.detail;
  console.warn(`[${code}] ${operation}: ${message}`);
});
```

`detail` always has `code`, `message`, `operation` and `upstreamVersion`. Resize errors and the
connection errors of size and removal notifications (`CallbackFailed`, `CircuitDisconnected`) add
the chart's `generation`; their `operation` is `resize`, `ContainerReady` or `BrowserRemoved`. Handler and event size
errors add `subscriptionId`. Errors of events, including `CircuitDisconnected` for an event that
could not reach .NET, have the `operation` `event:<name>` and no `generation`. A layout failure has the `operation` `layout:<participant>` (`layout:WordCloud`) and
is raised once, for the current layout; `AwaitStableAsync` and exports reject with the same error.

## ECharts 6.1.0 limitations

These are ECharts behaviors that the library reports instead of hiding:

- Connected SVG export fails in ECharts (`ExportUpstreamFailed`); see [export](export.md#connected-charts).
- `setTheme` rebuilds the chart from its initial option; see [updates](updates.md#themes-and-init-options).
- Replacing a hovered graph edge with a treemap can make ECharts throw on the next `mouseout`.
  End the hover first, or recreate the chart.
- The graphic component's `path` and `compoundPath` types are reserved without an implementation
  in ECharts 6.1.0 and cannot render.
