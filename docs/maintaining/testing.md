# Testing

All commands run from the repository root in Windows PowerShell, after `npm ci`,
`npm run assets:acquire` and `npm run docs:acquire` on a new clone. Run `dotnet build`
and `dotnet test` one at a time: they share output folders.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| .NET SDK | exactly the one in `global.json` (`rollForward: disable`) | Install it side by side with other SDKs. Release evidence comes from one toolchain, so a newer SDK is a separate change that reruns the gate |
| `wasm-tools` workload | the workload set of `verify.yml`: `dotnet workload install wasm-tools --version 10.0.403` (manifests 10.0.114). Its manifests decide the version of the implicit `Microsoft.NET.Sdk.WebAssembly.Pack` in the lock files; the older manifests that ship with the SDK fail the locked restore with NU1004 | Trimmed and AOT checks; `aot-manifest.json` records the workload version, manifest and packs |
| Node.js and npm | `engines` in `package.json` (`.node-version` for version managers) | Generator, assets, Vitest and Playwright |
| Google Chrome and Microsoft Edge | the installed stable channels | Browser tests and the matrix; `npx playwright install chromium firefox webkit` adds the Playwright builds |
| Git | any recent version | The gate reads the committed tree |

| Suite | Command | Notes |
|---|---|---|
| .NET contracts, serialization, methods, events | `dotnet test BlazorECharts.slnx -c Release --no-build` | xUnit v3 (`tests/BlazorECharts.Tests`) and bUnit (`tests/BlazorECharts.ComponentTests`) on Microsoft.Testing.Platform; includes the [public API baseline](release.md#public-api-baseline) |
| Generator | `npm run test:generator` | Vitest projects `generator` (files that run the CLI or write workspaces, one at a time) and `generator-parallel` (three at a time); about four minutes. `global-setup.ts` generates the committed schema and overrides once per run, and `baselineGeneration()` gives each file its own copy |
| Option snapshots | `npm run snapshots:check` | `getOption()` of the pinned ECharts (Node SSR) for typical charts; `SnapshotReadTests` reads them, and every union value must read as exactly one alternative |
| JavaScript runtime and tools | `npx vitest run --config vitest.config.ts --project javascript` | Interop, WordCloud adapter, `docs:check` |
| Browser | `npm run test:browser -- <spec>.ts` | Playwright with the real ECharts, Server and WebAssembly; needs a Release build |
| Documentation | `dotnet build tests/Documentation/DocumentationExamples.csproj -c Release`, `npm run docs:check` | Snippets compile; links and snippet copies are current; JavaScript blocks parse as ES modules; also covers the generated `docs/api-coverage` reports |
| Packages, trimming and AOT | See [release](release.md) | Clean consumers from local packages |
| Performance | `npm run test:performance` | Native ECharts, Server and WebAssembly on the same workloads; checks resource budgets and rewrites `docs/compatibility/performance-baseline.md` |
| Release gate | `./tools/Release/verify-local.ps1` | Every suite above except performance, for one committed tree; see [release](release.md#local-release-gate) |

`tests/BlazorECharts.Tests/Fixtures/echarts-6.1.0-snapshots` holds those snapshots, written by
`npm run snapshots` from the scenarios in `tools/Snapshots/echarts-snapshots.mjs` with the committed
`echarts-6.1.0.js`. A scenario follows the TypeScript contract (lines coordinates are numbers, for
example). When a JSON object fits several model alternatives, the read API picks a variant whose
`type` it names, then the model that knows all its keys with the fewest members; models with the
same members are one JSON shape and all read it.

A behavior change starts with a test that fails without it. Browser behavior is accepted
with Playwright against the real ECharts in both Server and WebAssembly, not with mocks.

## Browser test harness

The test-only Blazor host provides `/harness/server` (Interactive Server) and
`/harness/wasm` (Interactive WebAssembly). Both prerender and use the shared
`BrowserHost.Client.Shared.InteractiveProbe` component. Renderer identity comes
from `ComponentBase.RendererInfo`; execution location comes from
`OperatingSystem.IsBrowser()`.

The packages ship the minified ECharts build. The host serves the development build of the same
locked archive (`artifacts/upstream/echarts/dist/echarts.esm.mjs`) at
`_content/BlazorECharts/js/echarts-6.1.0.js`, so the specs that fail on console warnings also fail
on the warnings of ECharts. The demo, the browser matrix and the package consumers run on the
minified build.

From the repository root, with the pinned .NET SDK, Node.js and npm installed:

```powershell
dotnet restore BlazorECharts.slnx --locked-mode
dotnet build BlazorECharts.slnx -c Release --no-restore
dotnet test --project tests/BlazorECharts.ComponentTests/BlazorECharts.ComponentTests.csproj -c Release
npm ci
npm run test:browser -- harness/hosting-smoke.spec.ts
```

Playwright starts the Release host, waits for `/health`, and stops it after the
run, including failed runs. It requires a preceding Release build. It uses the
installed Google Chrome channel with a fresh browser context for each test.
`reuseExistingServer` is disabled so a stale host cannot mask missing changes.

The default origin is `http://127.0.0.1:5187`. Set
`BLAZOR_ECHARTS_TEST_PORT` to select another port, or
`BLAZOR_ECHARTS_TEST_BASE_URL` to set the complete localhost HTTP origin. The
base URL takes precedence over the port. The host runs in `Development` so
unpublished static web assets are available.

Every host of the tests has a default port and an environment variable that moves it:

| Hosts | Default ports | Variable |
|---|---|---|
| Test host | 5187 | `BLAZOR_ECHARTS_TEST_PORT` |
| Demo | 5189 | `BLAZOR_ECHARTS_DEMO_PORT` |
| Standalone demo | 5186 | `BLAZOR_ECHARTS_STANDALONE_PORT` |
| Package consumers (`test-packages.ps1`) | 5201-5208 | `BLAZOR_ECHARTS_CONSUMER_PORT`, the first of eight |
| Trimmed and AOT hosts (`test-aot.ps1`) | 5211-5212 | `BLAZOR_ECHARTS_AOT_PORT`, the first of two |

The release gate passes these variables on to every stage. On Windows, Hyper-V and WinNAT reserve
blocks of ports inside the dynamic port range; when that range starts low, a reserved block can
cover the defaults and Kestrel fails with `SocketException (10013)`.
`netsh interface ipv4 show excludedportrange protocol=tcp` lists the reserved blocks; move the
hosts to ports outside them, for example above the dynamic range
(`netsh int ipv4 show dynamicport tcp`).

For manual inspection:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --project tests/BrowserHost/BrowserHost.csproj -c Release --no-build --no-restore --no-launch-profile --urls http://127.0.0.1:5188
```

Reports, screenshots and failure traces go under `artifacts/playwright/`
(`BLAZOR_ECHARTS_PLAYWRIGHT_OUTPUT` selects another directory). `BLAZOR_ECHARTS_TEST_CONFIGURATION`
runs the hosts from another build configuration than `Release`.

Spec files run on two workers (`BLAZOR_ECHARTS_PLAYWRIGHT_WORKERS` selects another number); the
tests of one file run in order. The resource gate (`resource-lifetime.spec.ts`) and the
performance run pass `--workers=1`. A test that checks that something does not happen first waits
for an observable signal instead of a fixed pause: a status text, `resourceStatistics()` of
`runtime-loader.js`, two animation frames, or a later .NET round trip that is ordered after the
work in question. The WordCloud layout specs wait for the event that a wrong completion would
follow, then for `wc.settle()` of `wordcloud-fixtures.js` (two frames and a task); deadlines are
checked against the capture's `performance.now()` marks in the page, not against the test
runner's clock.
Each test attaches the actual browser version.

`npm run test:js -- <file>` runs Vitest against `tests/javascript/**/*.test.ts`, and
`npm run test:browser -- <file>` uses Playwright's file filter. Neither script treats
missing tests as success.

The host serves the built test-only compatibility fixture from the physical
`artifacts/compatibility/` directory at `/compatibility/`, with script CSP
restricted to self. Run `npm run assets:acquire` and `npm run test:compatibility`
after the Release build. See the [exact-pair report](../compatibility/echarts-6.1.0-wordcloud.md).
Rebuild after host changes before running Playwright. Chart harness
routes can share components from the client assembly so they can run in both
render modes. The core RCL is already referenced by the client project.

Routes under `/harness/lifecycle/` start Blazor with a reconnection handler that the specs
drive: `routeWebSocket` closes the circuit's socket, and `Blazor.reconnect()` restores it.
`/harness/lifecycle/reliability` (`server-reliability.spec.ts`) adds a second facade with the
default 32 KiB result limit, while the host raises its own limit for large exports;
`?interopTimeout=<ms>` shortens that circuit's `JSInteropDefaultCallTimeout`, so a lost reply ends
within the test, and `?limit=none` mounts the second facade without a limit.

`runtime-versioning.spec.ts` covers the interop module: its fingerprinted URL, a page that kept a
loader of another protocol (`/harness/versioning`, a static page that shows the loader URL, then
enhanced navigation to a chart page), a failed first request of the stable URL, and
`/harness/mixed`, one static page with an Interactive Server and an Interactive WebAssembly chart.

## Demo host

`samples/BlazorECharts.Demo` serves the example catalog (`/examples`,
`/examples/{slug}`) from the shared `samples/BlazorECharts.Examples` registry.
Pages live in `samples/BlazorECharts.Demo.Client`; `?hosting=wasm` renders the
page with Interactive WebAssembly, otherwise Interactive Server is used.
`?renderer=svg` selects the SVG renderer.

Playwright starts the demo next to the test host, on `http://127.0.0.1:5189`
(`BLAZOR_ECHARTS_DEMO_PORT` selects another port). Specs under `tests/browser/demo`
run in the `demo` project against that origin. `components.spec.ts` asserts the native ECharts
model of every example of the Components group:

```powershell
npm run test:browser -- demo.spec.ts components.spec.ts app-scenarios.spec.ts accessibility.spec.ts
```

For manual inspection, start the demo after a Release build with
`dotnet run --project samples/BlazorECharts.Demo/BlazorECharts.Demo.csproj -c Release --no-build --no-launch-profile -- --urls http://127.0.0.1:5191`.

`?hosting=auto` selects Interactive Auto. The standalone WebAssembly demo
(`samples/BlazorECharts.Standalone`) starts on `http://127.0.0.1:5186`
(`BLAZOR_ECHARTS_STANDALONE_PORT`). `tests/browser/matrix` runs one Playwright
project per installed matrix browser and writes `docs/compatibility/browser-matrix.json`.
See [hosting and browser compatibility](../compatibility/hosting.md).

## Resource gates and performance baseline

`/harness/resources/{server|wasm}` hosts `ResourceLifetimeProbe`: churn of 100
mount/update/resize/unmount cycles, navigation to `/harness/resources/{mode}/away`
and back (`?mount=true` mounts on arrival), bursts of declarative and imperative
updates, and dispose during export, WordCloud layout or ECharts import.
`?renderer=svg` selects the SVG renderer and `?cycles=` shortens the churn.
`resource-lifetime.spec.ts` compares the page registry with its baseline through
`resourceStatistics()` of `runtime-loader.js`: facades, charts, observations,
subscriptions, exports, result groups, references, leases and group members,
plus .NET → JS calls (`toBrowser`) and JS → .NET callbacks (`toDotNet`). It is a
diagnostic seam for tests, not consumer API; reading it is not counted as traffic.
.NET-side counters are internal: `EChartsSerializationContext.Statistics` counts
serializer entry points per root type and `EChartsRuntime.OwnedChartCount` the
handles a facade owns (`UpdateCostTests`, `ResourceLifetimeTests`).

`/harness/performance/{server|wasm}?workload=&renderer=&seed=` hosts
`PerformanceProbe` with the seeded workloads of `SyntheticWorkloads`.
`/harness/performance/native` runs the same workloads on native ECharts
(`wwwroot/harness/performance-native.js`): the same engine file, layout and
transport bytes of `OptionSerializer` (`/harness/performance/payload`), without
Blazor or the bridge. `tools/Performance/workloads.json` lists the workloads and
their renderers: a line ladder from 1,000 to 1,000,000 points, 4 and 20
concurrent charts, two WordClouds, 1,000 sequential full updates (`stream-1k`)
and 400 mouse moves over a chart with a `mousemove` subscription (`hover-100`).
`SyntheticWorkloads` must define the same names, kinds, sizes and chart counts;
each test compares them first.

Besides the times, every phase records browser main-thread CPU and the
JavaScript heap after full collections (Chrome DevTools Protocol), Server
WebSocket payloads, bridge calls, the `setTimeout(0)` calls of the WebAssembly
.NET runtime, and from the probe .NET allocations, server process CPU and
`GC.GetTotalMemory(true)`. The single-threaded runtime runs thread-pool work
from such a timer, which Chrome clamps to 4 ms in a chain of awaited calls, so
`ChartCommandQueue` resumes its callers inline in the browser. The performance runs serve the shipped
minified ECharts build instead of the development build the other specs see.

`run.mjs` compares each host with native ECharts and checks the budgets of
`tools/Performance/budgets.json`: bridge calls per sample, chart and update,
delivered events, retained and residual JavaScript heap, the WebAssembly .NET
heap (the server heap belongs to the whole process and is only reported),
runtime timers per WebAssembly stream update, and browser CPU per data point. Every budget states its reason; raise one only with
a new reason. A failed check still writes the report and exits with 1.

The three hosts of a workload run back to back. The browser slows down over a
run of about ten minutes, and running the hosts in blocks charged that drift to
the wrapper: WordCloud 2,000 measured +50 % that way and +3 % in isolation. A
large overhead in one workload is worth a run of that workload alone
(`--filter wordcloud-2000-canvas`) before looking for its cause.

The `performance` Playwright project exists only when
`BLAZOR_ECHARTS_PERFORMANCE=1`, so ordinary browser runs never include it. After
a Release build:

```powershell
npm run test:performance                       # all 51 configurations, 5 samples each, about 9 minutes
npm run test:performance -- --samples 3 --filter wasm-line,hover
npm run test:performance -- --version 1.0.0           # the version the report names, default unreleased
npm run test:performance -- --report-only             # rebuild the report from the last samples, e.g. after a budget change
```

`--filter` takes comma-separated substrings of configuration ids such as
`native-line-1m-canvas`; the native configuration of the same workload is needed
for the comparisons and checks against it. The full run rewrites
`docs/compatibility/performance-baseline.md`; a filtered run writes
`artifacts/performance/performance-filtered.md` instead. Raw samples go to
`artifacts/performance/samples/`.
