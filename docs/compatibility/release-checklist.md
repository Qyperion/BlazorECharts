# Release checklist

A release is accepted only by the local release gate, `tools/Release/verify-local.ps1`
(see [release](../maintaining/release.md#local-release-gate)). The gate runs every stage below
for one committed source tree and writes `verification-report.json` and
`verification-report.md`. It reads the requirement table on this page: each requirement names
the gate stages that prove it, and the report gives it the worst status of those stages. A
requirement without a stage, or a stage the gate does not know, fails the gate.

## Requirements

| ID | Requirement | Evidence | Gate stages |
|---|---|---|---|
| R1 | net10.0 only; Apache ECharts exactly 6.1.0 in the default assets | `assets:check` rebuilds the assets from `sources.lock.json`; package inspection requires one net10.0 dependency group and the locked engine hash; published consumers carry the locked engine | `assets-check`, `packages`, `aot` |
| R2 | Typed coverage of the documented ECharts API with a raw API for the rest | `api:check`: every scoped option path, union alternative, event, action and method is mapped, none unresolved; deterministic generation; contract and serialization tests; every series and component, timeline steps, series markers and the thumbnail rendered by the real ECharts; events, actions, instance and global methods in browsers, each event and action naming its browser test in `docs/api-coverage/events-actions-6.1.0.md` or marked contract only; `getOption()` snapshots of the pinned ECharts read by the typed read API | `api-check`, `generate-check`, `snapshots-check`, `generator-test`, `dotnet-test`, `browser-catalog`, `browser-interop` |
| R3 | Complete WordCloud API from @qyperion/echarts-wordcloud 3.0.0 on ECharts 6.1.0 | WordCloud models and contracts; layout, callbacks, mask images, seed, layers, events and export in browsers; the exact-pair probe against the published UMD bundle and the built installer | `dotnet-test`, `browser-lifecycle`, `wordcloud-compatibility` |
| R4 | Interactive Server, WebAssembly and Auto with correct prerendering; standalone WebAssembly | Hosting, prerender placeholder, Auto hand-over, lifecycle and reconnect tests; the browser matrix in Chrome, Edge and Firefox, with rendering and export on both Interactive Server and WebAssembly; the standalone consumer published trimmed and AOT | `browser-lifecycle`, `browser-matrix`, `aot` |
| R5 | JavaScript module functions and explicit inline JavaScript; ordinary options are never evaluated | Function and reference tests; a Blazor page with module functions under a strict CSP on Server and WebAssembly; interop tests of the JavaScript runtime, including the module URL guard | `js-test`, `browser-interop` |
| R6 | Exact local assets in the NuGet packages, loaded automatically; optional CDN or custom runtime | Packaged assets byte-equal to the tracked manifest; offline consumers, base path and lazy routes; opt-in CDN and custom providers; runtime provider tests | `packages`, `aot`, `browser-interop` |
| R7 | New `Options` apply automatically; explicit `UpdateAsync` and `SetOptionAsync` for mutations and partial changes | Component lifecycle and update tests; update and burst tests in browsers | `dotnet-test`, `browser-interop`, `browser-resources` |
| R8 | PNG and SVG export in the browser | Export tests in both render modes that decode the PNG and count pixels of the series color; the matrix export scenario on Server and WebAssembly; consumer exports with the same pixel check | `browser-lifecycle`, `browser-matrix`, `packages` |
| R9 | Other ECharts extensions can be registered | Extension registration tests; WordCloud registers as an ordinary extension | `browser-interop`, `browser-lifecycle` |
| R10 | ZRender is reachable through JavaScript references | Native reference, graphic and renderer recreation tests | `browser-catalog`, `browser-interop` |
| R11 | BlazorECharts names, MIT license for own code, English public documentation and demo | Package metadata, license and notices; documentation links and compiled snippets; the demo catalog and its accessibility; the public API baseline | `packages`, `docs-check`, `browser-catalog`, `dotnet-test` |
| R12 | The first public history is a single Initial commit | `tools/Release/export-initial.ps1` checks the single commit when it exports the release repository, then runs this gate there | — |
| R13 | The first stable release covers R2 and R3 completely, with nothing unresolved | `api:check` reports no unresolved record; current option snapshots for the read tests; the frozen public API baseline; the WordCloud exact pair | `api-check`, `snapshots-check`, `dotnet-test`, `wordcloud-compatibility` |

## Gate stages

Stages run in this order. A stage whose prerequisite did not pass is `NOT_RUN`, which fails
the gate. Every stage records its log and result files with their SHA-256 and the verified
source tree.

| Stage | Command or check | Result files |
|---|---|---|
| `gate-fixtures` | `tools/Release/test-verification-gate.ps1`: fixtures that require the gate to reject a failed stage, a missing or changed artifact, a stage status it does not know, and gaps in this checklist | `gate-fixtures/fixtures.json` |
| `source-tree` | No tracked file differs from `HEAD` or is checked out with other line endings or name case than committed, no untracked file under `src`; `-RepositoryCommit` equals `HEAD` | `source.json` |
| `release-plan` | This checklist covers R1-R13, every browser spec belongs to one stage and has a test count, every test project has a test count, no test is marked as expected to fail, `.github/workflows/verify.yml` runs the same tools without credentials, `release.yml` publishes only what the gate verified, `pages.yml` writes only to Pages from one deploy job, no blob of HEAD is over 50 MiB (52 428 800 bytes, the GitHub warning limit) | `release-plan.json` |
| `npm-ci` | `npm ci` | log |
| `restore`, `build` | `dotnet restore BlazorECharts.slnx --locked-mode`, `dotnet build BlazorECharts.slnx` (no warning, documentation snippets compiled) | log |
| `generate-check`, `snapshots-check`, `api-check`, `assets-check` | `npm run generate:check`, `npm run snapshots:check`, `npm run api:check`, `npm run assets:check` | log |
| `typecheck-generator`, `typecheck-runtime` | `npm run typecheck:generator`, `npm run typecheck:runtime` | log |
| `dotnet-test` | `dotnet test --solution BlazorECharts.slnx --no-build --report-xunit-trx --results-directory-layout per-module`, one result file per test project in its own folder | `dotnet-test/<project>/<framework>_<architecture>/*.trx` |
| `js-test`, `generator-test` | Vitest project `javascript`; Vitest projects `generator` and `generator-parallel` | `js-test/results.json`, `generator-test/results.json` |
| `docs-check` | `npm run docs:check` | log |
| `browser-catalog` | Series, components, coordinates, graphics, demo catalog, application scenarios, accessibility | `playwright/browser-catalog/results.json` |
| `browser-interop` | Functions, events, methods, globals, runtime providers, extensions, updates | `playwright/browser-interop/results.json` |
| `browser-lifecycle` | Lifecycle, recreation, hosting, WordCloud, export | `playwright/browser-lifecycle/results.json` |
| `wordcloud-compatibility` | `npm run test:compatibility` | `playwright/wordcloud-compatibility/results.json` |
| `browser-matrix` | The [browser matrix](hosting.md#browser-matrix); Chrome, Edge and Firefox must pass, a browser that cannot run blocks | `browser-matrix.json` |
| `browser-resources` | Resource lifetime gates | `playwright/browser-resources/results.json` |
| `packages` | `tools/Release/package.ps1`: pack, inspect, fixtures, clean consumers | `packages/packages-manifest.json`, `packages/feed/*.nupkg` |
| `aot` | `tools/Release/test-aot.ps1`: trimmed and AOT standalone consumer | `aot/aot-manifest.json` |

A test stage passes only with result files, at least one passed test, and no failed, flaky,
skipped or expected-to-fail test; the matrix may skip the scenarios of a browser that cannot start,
which blocks the release instead. Each spec, .NET test assembly and test stage must pass exactly
the number of tests of its [test count](../maintaining/release.md#test-counts). The performance baseline
(`npm run test:performance`) records times without thresholds, checks resource budgets against native
ECharts, and is not a gate stage.

## Verdict

| Verdict | Exit code | Meaning |
|---|---|---|
| `PASS` | 0 | Every stage passed for one committed tree that did not change during the run, and every recorded file still has its hash |
| `FAIL` | 1 | A stage failed or did not run, a result file is missing or changed, or the tree had or got uncommitted changes |
| `BLOCKED` | 2 | Nothing failed, but the environment lacks a requirement: a required matrix browser that can start |

`FAIL` wins over `BLOCKED`. Neither is a release.
