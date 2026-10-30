# WebAssembly trimming and AOT

BlazorECharts and BlazorECharts.WordCloud work in published standalone WebAssembly
applications that are trimmed (the default for WebAssembly publish) or compiled ahead of
time (`RunAOTCompilation=true`). This page records what is verified, the linker warnings
of such an application and how to repeat the check.

## What the libraries declare

Both assemblies are built with `IsAotCompatible=true`:

- the assemblies carry `[AssemblyMetadata("IsTrimmable", "True")]`, so the default
  `partial` trim mode of a consumer trims them as well as the framework;
- the trim, AOT and single-file analyzers run on every library build, and the repository
  treats warnings as errors.

The libraries do not depend on reflection over their own models. Option, series and
payload metadata are generated readers and writers registered explicitly; JavaScript
interop passes `JsonElement` envelopes, strings and primitives; browser callbacks go
through `DotNetObjectReference<T>`. Consumer data needs its own `JsonTypeInfo<T>`,
normally from a source-generated `JsonSerializerContext`:

<!-- snippet: Compatibility.WasmAot.ConsumerJson -->
```csharp
using System.Text.Json.Serialization;

public sealed record CustomPoint(double X, double Y, [property: JsonPropertyName("tag")] string Label);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(CustomPoint[]))]
public partial class ConsumerJsonContext : JsonSerializerContext;

// Once per runtime facade, before the data is used, for example in the root component:
runtime.Serialization.Register(ConsumerJsonContext.Default.CustomPointArray);
```

An unregistered CLR type is an error with its option path; there is no reflection
fallback. Extension series such as WordCloud register their readers and writers through
`IChartExtension.ConfigureSerialization`.

Full trim mode (`TrimMode=full`) is not supported for Blazor applications by ASP.NET Core
and is not tested.

## Verified scenario

`tests/PackageConsumer/Standalone` is a standalone WebAssembly application that knows
nothing about this repository and references both packages from the local feed. It is
published twice and each output is served by `tests/PackageConsumer/static-host.mjs`, a
plain Node file server without ASP.NET Core. `tests/PackageConsumer/aot.spec.ts` runs in
Google Chrome for both outputs and blocks every request that leaves localhost.

| Check | What it proves |
|---|---|
| `PublishedOutputLoadsPackagedAssetsOffline` | Packaged engine with the locked hash, WordCloud assets, ECharts 6.1.0, no external request |
| `PublishedPolymorphicSeriesRetainsDerivedFields` | Line, bar, scatter, pie and WordCloud declared through `SeriesOption` keep their own fields in ECharts; `getOption` reads them back as the derived C# types |
| `PublishedValueTypeContainersSerialize` | `OneOrMany` of nullable unions and of `double?` (scalar and array), `OptionDictionary<bool?>`, a union array with a null and an object item: axes, legend padding and selection, pie center and radius, line data reach ECharts unchanged |
| `CustomJsonTypeInfoDataRenders` | A consumer-owned `CustomPoint[]` dataset, registered through `EChartsRuntime.Serialization`, keeps the names of its source-generated metadata and renders every point |
| `PublishedEventPayloadDeserializes` | Typed `click` payloads for a bar and for a consumer data point, a typed `legendselectchanged` from a dispatched action; unsubscribing stops delivery and releases the browser subscriptions |
| `PublishedFunctionsLeasesAndExportsWork` | Module formatter labels in the SVG export, PNG export of the WordCloud after its layout, 20 placed words; a native gradient through `setOption`, `getOption`, a retained lease and a snapshot reapply, after which references, leases and results return to their earlier counts |

## Outputs

Measured on 2026-10-27 with SDK 10.0.403, `wasm-tools` 10.0.114 and packages
0.1.0-local (Windows x64, Ryzen 9 9900X, Google Chrome). Sizes are uncompressed;
`_framework` Brotli is the sum of the precompressed `.br` files.

| | Trimmed | AOT |
|---|---|---|
| Publish properties | `PublishTrimmed=true` | `PublishTrimmed=true`, `RunAOTCompilation=true` |
| Publish time | 22 s | 176 s |
| `wwwroot`, 60 files | 15.1 MB | 41.6 MB |
| `_framework` Brotli | 3.4 MB | 6.8 MB |
| `dotnet.native.wasm` | 2.9 MB | 29.4 MB |
| `BlazorECharts.wasm` (package DLL 5.5 MB) | 4.6 MB | 4.6 MB |
| `BlazorECharts.WordCloud.wasm` | 68 KB | 68 KB |
| `OptionSerializer.Serialize`, line of 100 000 points, median of 3 after a warm-up | 68 ms | 13 ms |

`test-aot.ps1` writes these values to `aot-manifest.json` in its results directory.

Trimming removes about 18% of `BlazorECharts`: the generated serializer registry, which
the runtime registers so that `getOption` can read any documented series back, keeps the
option models reachable. AOT keeps the IL for the interpreter fallback and adds the
compiled code to `dotnet.native.wasm`. The serialization time is a single in-page
measurement for comparison between the two outputs, not a performance gate.

## Linker warnings

The consumer reports every trim analysis warning per member
(`SuppressTrimAnalysisWarnings=false`, `TrimmerSingleWarn=false`) and keeps them as
warnings, so `test-aot.ps1` can attribute them. A warning that names a BlazorECharts
member fails the run. A third-party warning passes only when
`tools/Release/aot-known-warnings.json` explains it; any other warning fails as
unexplained. The AOT compiler adds no warnings of its own.

### BlazorECharts

| Warning | Cause | Fix |
|---|---|---|
| IL2091 in `EChartsRuntime.RuntimeCallAsync<T>` | The result type reaches `IJSObjectReference.InvokeAsync<TValue>`, which deserializes it by reflection and requires public constructors, fields and properties of `TValue`. The private helper did not declare the same requirement. Every caller passes `string`, `string?`, `object?` or `JsonElement`, so no member was actually lost. | `T` carries the same `DynamicallyAccessedMembers` annotation. Regression: `TrimmingContractTests.RuntimeCall_ResultTypeCarriesJsInteropAnnotation`, the library analyzers and the gate of `test-aot.ps1`. |

No other warning names BlazorECharts.

### AOT runtime fault without a warning

The first AOT run built cleanly and then stopped the .NET runtime on the first chart:
`RuntimeError: null function` in `OneOrMany<T>.IOptionValue.Write`, with no managed
exception, so the page stayed in `Initializing`. The trimmed output worked.

`OneOrMany<T>` and `OptionDictionary<T>` write themselves only through the
`IOptionValue` interface. For a value-type `T` the Mono AOT compiler therefore emits
shared generic (`gsharedvt`) code, and in that code a call that passes a `Nullable<T>`
by value, such as boxing it or a LINQ key selector over `KeyValuePair<string, T>`, goes
through a wrapper the compiler did not generate. It affected every container of nullable
unions, `double?` and `bool?`: axes, legends, pie centers and radii, padding, selection maps.

The scalar of `OneOrMany<T>` is now boxed when it is created, items are read through
`Array.GetValue`, and `OptionDictionary<T>` copies keys and values into arrays before
writing. Serialized JSON is unchanged. Regression: `PublishedValueTypeContainersSerialize`
on the AOT output, besides the existing serialization tests.

Arrays of generated unions, such as series data, take a typed loop instead of
`Array.GetValue`, which boxed every item. It is a generic method too, but
`GeneratedOptionMetadata.Register` instantiates it for each concrete union
(`RegisterUnionArray<LineSeriesOptionDataItem>()` and so on), so the AOT compiler sees every
value-type instantiation and emits no shared generic code for it. The line data of the
mixed chart, with a null and an object item, covers both branches of the loop.

### Third-party

These come from ASP.NET Core 10.0.14 and appear in any trimmed Blazor WebAssembly
application that renders a `Router`:

| Warning | Origin | Why it is safe here |
|---|---|---|
| IL2065 `DotNetDispatcher.ScanAssemblyForCallableMethods` | Microsoft.JSInterop | Static `[JSInvokable]` lookup by assembly name scans types with `Type.GetMethods`. BlazorECharts calls back only through `DotNetObjectReference` instances. |
| IL2111 `DotNetDispatcher.GetCachedMethodInfo` | Microsoft.JSInterop | Instance callbacks are found on the referenced object's runtime type. `DotNetObjectReference.Create<T>` keeps the public methods of `T`; the event, lifecycle and export callbacks are exercised by the scenario. |
| IL2072 in `CascadingParameterState`, `ComponentFactory`, `ComponentProperties` (4) | Microsoft.AspNetCore.Components | The renderer reflects over `component.GetType()`; component types are kept by the annotation on `OpenComponent<TComponent>` and the router. |
| IL2110 and IL2111 for `Router.NotFoundPage` in the generated `App.BuildRenderTree` | Microsoft.AspNetCore.Components through Razor | `OpenComponent<Router>` requires every member of `Router`, and `Router.NotFoundPage` carries an annotation itself. The compiler's analyzer reports the IL2111 as well; the consumer keeps it a warning with `WarningsNotAsErrors`. |

## Repeating the check

Requires the `wasm-tools` workload (`dotnet workload list`; it is never installed by the
scripts), `npm ci` in the source root for Playwright, Google Chrome, nuget.org for
Microsoft packages, and two free consecutive ports, 5211-5212 by default
(`BLAZOR_ECHARTS_AOT_PORT` sets the first).

```powershell
dotnet workload list
./tools/Release/package.ps1 -SourceRoot $PWD.Path -OutputPath (Join-Path $PWD 'artifacts/packages') -Configuration Release
./tools/Release/test-aot.ps1 -SourceRoot $PWD.Path -PackageDirectory (Join-Path $PWD 'artifacts/packages') -ResultsDirectory (Join-Path $PWD 'artifacts/aot')
```

`test-aot.ps1` uses the feed of `package.ps1` and refuses packages whose SHA-256 differs
from `packages-manifest.json`. It restores into a private NuGet cache, publishes the
`trimmed` and `aot` variants into separate folders, and requires for each one: the
packages from the local feed, the locked engine, an ILLink run that shrinks
`BlazorECharts.wasm` below 90% of the packaged DLL, for `aot` an AOT compilation of both
libraries and a `dotnet.native.wasm` at least twice the interpreted one, and a clean
warning gate. Results, sizes, warnings, browser counts and the toolchain (SDK, workload
version, `wasm-tools` manifest and the installed WebAssembly packs) go to
`<ResultsDirectory>/aot-manifest.json`; logs to `<ResultsDirectory>/logs`.
