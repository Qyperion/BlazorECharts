# Release and packages

A release is verified by the release gate, locally and on GitHub. Only
`.github/workflows/release.yml` publishes: from a release tag, after a reviewer approves the
protected `nuget` environment, and only the packages that the gate of the same run verified (see
[publishing](#publishing)). Nothing pushes branches or uploads documentation.

## Versions

The library has its own [Semantic Versioning](https://semver.org/). The tested upstream
versions are part of the release: package descriptions, the package READMEs and the
compatibility documents name them, and an upstream upgrade is its own change
([ECharts](update-echarts.md), [WordCloud](update-wordcloud.md)).

- **Major**: a public C# member, union alternative or overload is removed or changes
  incompatibly, or the documented behavior changes incompatibly.
- **Minor**: new public API, including members added by an upstream upgrade, or a new tested
  upstream minor version.
- **Patch**: fixes without public API changes, including an upstream patch release whose
  `npm run api:diff` reports no entries above `patch`.

Generated type names are locked in `schemas/generated/type-names.lock.json` (see
[type names](generator.md#type-names)): an upgrade cannot rename a published type silently, and
removing a lock entry is a major change. Members that only the TypeScript declarations describe
(XML remark "Not described by echarts-doc") follow the same rules as documented members. ECharts
does not document them and may change them in a minor release; when an upgrade removes or
changes one, the library release is major.

`npm run api:diff` gives the upstream lower bound (`summary.semver`); the public API
baseline decides the rest.

The browser API follows the same rules: the exports of `_content/BlazorECharts/js/blazor-echarts.js`
(`getECharts`, `stabilityParticipant`, `tryStabilityParticipant`) are public, frozen by
`tests/javascript/interop/stable-module.test.ts`, and so are the shapes it returns: the participant
`{ begin(name, scope) }` with a required scope and the ticket
`{ generation, revision, token, complete, cancel, fail, retire }` ([export.md](../export.md#exports-of-extensions)). That module reads the page coordinator from its
global key and never imports `runtime-loader.js`, the internal module of the .NET interop, which
may change in any release under its protocol:

- The protocol covers the exports of `runtime-loader.js` that .NET calls, their parameters and the
  `PageRuntime` members they call. Any change takes the next number in `runtimeProtocol`
  (`src/BlazorECharts/JavaScript/runtime-protocol.ts`) and `EChartsRuntime.RuntimeProtocol`, and
  with it a new global key `BlazorECharts.page-runtime.v<n>`, so a page that kept the scripts of an
  earlier version holds that coordinator apart.
- The URL changes with the content: hosts with `MapStaticAssets` import the fingerprinted
  `runtime-loader.<fingerprint>.js` from `ComponentBase.Assets`. Do not add a query string to the
  first import: it would bypass import maps and the offline cache of a PWA.
- `openFacade` and its first parameter, the protocol, never change. The loader rejects another
  protocol with `RuntimeVersionMismatch` and the advice to reload the page
  (`runtime-versioning.spec.ts`).
- Tests that reach the coordinator by its key (`page-runtime.v<n>` in `tests/browser` and
  `tests/BrowserHost/wwwroot`) change with it.

## Public API baseline

The public API of both assemblies is frozen in
`tests/BlazorECharts.Tests/Api/PublicApi/BlazorECharts.txt` and `BlazorECharts.WordCloud.txt`.
Each file lists every exported type with its base types, and every public or protected member
with nullability, default values and the attributes that affect consumers (`[Parameter]`,
`[EditorRequired]`, `[Obsolete]`). Generated and hand-written types are both included.
`PublicApiBaselineTests` fails on any difference and writes the actual surface to
`artifacts/public-api/<assembly>.received.txt`, listing the removed and added lines.

An intended change is accepted in the same commit that makes it:

```powershell
$env:BLAZOR_ECHARTS_ACCEPT_PUBLIC_API = '1'
dotnet test --project tests/BlazorECharts.Tests/BlazorECharts.Tests.csproj -c Release --filter-class "*.PublicApiBaselineTests"
Remove-Item Env:BLAZOR_ECHARTS_ACCEPT_PUBLIC_API
```

Review the baseline diff like code: a removed or changed line is a major change, an added line
is a minor change. JSON names of generated members are not CLR API; their changes show in
`schemas/generated/public-api.txt`.

## Release checklist

1. Choose the version; package metadata is in `src/Directory.Build.props`, descriptions are in
   each `.csproj`. The [public API baseline](#public-api-baseline) diff since the previous release
   decides the version.
2. Add the version to `CHANGELOG.md` and point the repository links of both package READMEs
   (`src/*/README.md`) at the tag `v<version>`: a published README never changes, and the package
   inspection of a release rejects links to another ref.
3. Commit every change. The gate verifies one committed tree and refuses uncommitted tracked
   files and a checkout whose line endings or name case differ from the committed ones (a rename
   that changes only the case is not recorded on Windows: `git rm --cached` the old path, `git add` the new).
4. Run the [local release gate](#local-release-gate). Only `PASS` is a release.
5. Keep `<OutputPath>` (by default `artifacts/verification`) as the record of what was verified.
6. [Publish](#publishing) from the public repository: a dry run of `release.yml`, then the tag.

## Local release gate

```powershell
./tools/Release/verify-local.ps1 -SourceRoot $PWD.Path -OutputPath (Join-Path $PWD 'artifacts/verification') -Configuration Release
```

Optional parameters: `-Version` (default `0.1.0-local`); together, `-RepositoryUrl` and
`-RepositoryCommit`, which must be the verified commit (both are passed to `package.ps1`).
Paths must be absolute.

Every release tool writes into an output directory that it owns. A new or empty directory gets a
`.blazorecharts-output` file, and only a directory with that file is reused: the tool replaces its
own entries there and keeps any others. A non-empty directory without the file is refused before
anything is written, so a mistyped `-OutputPath`, `-WorkPath` or `-ResultsDirectory` cannot delete
data. An output of an older version of the tools has no marker; delete it once.

The gate runs every stage of the [release checklist](../compatibility/release-checklist.md) in
order, one command at a time: the gate fixtures, the source tree and release plan checks, `npm ci`,
restore and build, `generate:check`, `snapshots:check`, `api:check`, `assets:check`, both type checks, the .NET,
JavaScript and generator tests, `docs:check`, the browser stages, `package.ps1` and `test-aot.ps1`.
A stage whose prerequisite did not pass is not run, which fails the gate.
Every log and result file is recorded with its SHA-256 and the verified tree; the verdict rehashes
them and compares the tree at the start and the end of the run. The tree is read with
`git status --porcelain=v1 -z --ignored=matching`, so paths with spaces stay exact. Untracked files
that change the build fail at the start and at the end: anything under `src`, `Directory.Build.*`,
`Directory.Packages.props` and `*.rsp` files at any depth, and a root `NuGet.Config` or
`global.json`. So do ignored files that the SDK still reads, such as `<project>.user` files and the
same inputs, except the `bin`, `obj` and `node_modules` output folders. The root
`Directory.Build.targets` is empty on purpose: MSBuild stops looking for one above the repository. The root
`Directory.Build.props` sets `DisableImplicitLibraryPacksFolder`: with a workload such as `wasm-tools`
installed, the SDK would also restore from its `library-packs` folder, whose copies differ from the
packages on nuget.org, and a lock file written there fails elsewhere with NU1403. The release plan
check requires the property (`Test-RestoreSources`).
The package consumers are copied from their tracked files only.

A test stage passes only when its results exist, at least one test passed and nothing failed, flaked
or was skipped (the matrix may skip browsers that are not installed). A `dotnet test` result must be
`Completed` with every counted test passed. xUnit names a trx after the user, the machine and a
timestamp that two test assemblies can share, so `dotnet test` runs with
`--results-directory-layout per-module`: each assembly writes into
`dotnet-test/<project>/<framework>_<architecture>/`. The build log must report `0 Warning(s)` and
`0 Error(s)`. A pass is a test expected to pass: a Playwright test marked `test.fail()` is reported
as expected, and the gate counts it as a failure instead.

### Test counts

Every test stage has an exact number of passing tests, the count of the last PASS, in
`tools/Release/VerificationGate.psm1`: `$script:BrowserSpecCounts` for each browser spec and
`$script:StageTestCounts` for the gate fixtures, each .NET test assembly, both Vitest projects and the
package and AOT consumers. A deleted, renamed away or newly added test fails the stage with the
number it found, so update the count in the change that adds or removes tests. The browser matrix
counts its seven scenarios per required browser (`matrix-chrome`, `matrix-msedge`,
`matrix-firefox`): a browser that cannot start skips them, which is no shortage, and the matrix check
blocks the release instead. The release plan check requires a count for every assigned spec and
every test project, and rejects `test.fail(`, `it.fails(` and `test.fails(` in the tracked tests and
tools. Every Playwright configuration sets `forbidOnly: true`, which the release plan also checks,
so a committed `test.only` fails instead of shrinking a stage. A stage check must return exactly one
result object.

The release tool modules set `$ErrorActionPreference = 'Stop'` themselves: their functions stop at
the first error whether a script runs them with `-File` or from an interactive session with
`& ./tools/Release/verify-local.ps1`.

`<OutputPath>/verification-report.json` and `verification-report.md` hold the stages, test counts,
requirement statuses and the verdict. Exit codes: `0` PASS, `1` FAIL, `2` BLOCKED. BLOCKED means
that nothing failed but the environment lacks a requirement, such as a required matrix browser that
can start. The tree identity is the Git tree of `HEAD`.

Real Safari is not tested: Playwright WebKit in the browser matrix checks its engine.

The gate needs the pinned .NET SDK, Node.js and npm, the `wasm-tools` workload, `artifacts/upstream`
and `artifacts/generator` (`npm run assets:acquire`, `npm run docs:acquire`), Google Chrome,
Microsoft Edge and the Playwright Firefox build. It installs nothing besides `npm ci` and takes about
half an hour. In a terminal of a packaged (MSIX) desktop app, set `PLAYWRIGHT_BROWSERS_PATH` to a
folder outside `%LOCALAPPDATA%` first, or Firefox cannot start (see
[browser matrix](../compatibility/hosting.md#browser-matrix)); the report records the variable. Browser stages write their Playwright results and the browser matrix into `<OutputPath>`,
not into `docs/compatibility/browser-matrix.json`.

`tools/Release/test-verification-gate.ps1` holds the fixtures that keep the gate fail-closed:
`FailedStageCannotYieldSuccess`, `MissingArtifactFailsGate`, `NotVerifiedStageFailsGate`,
`StaleSourceEvidenceRejected`, browser matrix checks, `BrowserMatrixCountsEachBrowser` (a browser that cannot start blocks,
a lost scenario fails), `StageCheckReturnsOneResult`, `TestEvidenceRejectsGaps` (skipped, flaky,
expected failures, specs, exact counts, trx outcome, counters and test assemblies, a test assembly
without a passing test, build log), `DotnetTestKeepsEachAssembly` (two test assemblies whose trx
get one timestamped name keep both files), `VerdictRejectsBrokenReports`, `SourceIdentityKeepsPaths` (with
ignored build inputs, a checkout converted to CRLF and a case-only rename) and `GitOutputIsAlwaysAnArray` on a real repository,
`ConsumersAreCopiedFromTrackedFiles`, `ModulesStopOnErrors` (each module called through
`powershell -Command "& { ... }"` from a session that continues on errors), `LiteralOutputPaths`,
`OutputDirectoryIsOwned` (each release script refuses a foreign directory and leaves it untouched),
a positive control, broken copies of the checklist, the three workflows, the Playwright configurations
and the browser stage assignment, and `ReleaseVerification` (a changed or unrecorded package,
another commit or version, a failed report and changed evidence must stop a publish).

`.github/workflows/verify.yml` runs the same tools on a GitHub-hosted Windows runner, for every pull
request and every push to `main` (the status badge of the README): it installs
the `wasm-tools` workload from the pinned workload set (`--version 10.0.403`; `Test-VerifyWorkflow`
rejects a floating install) and the Playwright browsers, then runs `verify-local.ps1`. It uploads the reports, the logs, every
file a stage records (test results, fixtures, browser results) and the verified packages, so a
downloaded `verification` artifact can be rechecked with `Get-GateVerdict` of
`VerificationGate.psm1` (`-Report` the parsed `verification-report.json`, `-OutputPath` the
download folder, `-RequiredStages` `Get-GateStageIds`). `setup-node` runs with
`package-manager-cache: false`, because the `packageManager` field of `package.json` would otherwise
turn on the shared npm cache. Node.js comes from `.node-version`. The workflow reads the repository only, uses no secret and pushes or
publishes nothing; the gate itself checks this (`Test-VerifyWorkflow`). `release.yml` calls the
same workflow (`workflow_call`) with a version: the gate then packs that version with the
repository URL and the checked-out commit. For every workflow `Test-WorkflowSafety` rejects
`pull_request_target` and `workflow_run` triggers, an action that is not pinned to a full commit SHA
(a workflow of this repository, `./.github/workflows/...`, is pinned by the commit), `always()`, any
`${{ }}` expression in a `run` script (event data, inputs and step outputs go through `env`), a
Node.js version other than `node-version-file: .node-version` and a `dotnet` restore without lock
files; `Test-VerifyWorkflow` also rejects an upload without the test results, packages or symbol
packages. `WorkflowStepsBindTheirParameters` runs the `run` scripts of the gate, confirmation and demo site steps
against stubs with the tools' parameters, because they never run locally otherwise. `.github/dependabot.yml` proposes updates of the pinned actions. Vulnerabilities are
reported as described in `SECURITY.md`.

## Initial export

The first public history is a separate repository with a single commit, `Initial`. The working
repository and its history stay as they are.

```powershell
./tools/Release/export-initial.ps1 -SourceRoot $PWD.Path -DestinationPath <new-absolute-path> -RepositoryUrl https://github.com/Qyperion/BlazorECharts -Version <version> -PackageId Qyperion.BlazorECharts -WordCloudPackageId Qyperion.BlazorECharts.WordCloud -RootNamespace BlazorECharts -AuthorName <name> -AuthorEmail <email>
```

`-AuthorName` and `-AuthorEmail` are the author and committer of `Initial`; the global git
identity is not used, and the script checks both on the commit. A GitHub account that blocks
command line pushes exposing its private email rejects a commit with that address (GH007); use the
account's `users.noreply.github.com` address then.

The script refuses a destination that is the source root, contains it, lies inside it or is not
empty, and a source tree with uncommitted tracked changes. It exports the tracked files of `HEAD` that
`tools/Release/public-tree.json` includes, byte for byte: `git archive` runs with `core.eol=lf`
(`.gitattributes` also sets `eol=lf`), and each written file must hash to its committed blob, so
the manifest and the gate cover the bytes that GitHub serves. Every tracked file must be included or
excluded there, entries are repository paths, and internal files (`.plans`, `CLAUDE.md`, `.claude`,
`.mcp.json`, `.codegraph`, `.git`, `artifacts`) are never exported; apart from `.git`, `.gitignore`
keeps them untracked. The new repository gets one commit, `Initial`, on `main` and no remote; the
script checks the commit count, the clean status and that every file has the mode and blob of the
source commit.
The export manifest (paths, modes, blob ids, SHA-256, both commits and the verification result) is
written outside the destination, by default to
`artifacts/export/<destination name>/export-manifest.json`; its logs, fixtures and the archive go to
the owned directory `<manifest>.work` next to it.

The pinned upstream archives are copied into the ignored `artifacts/` of the export and unpacked
offline against the tracked locks. Then the [local release gate](#local-release-gate) runs on the
export with `-RepositoryUrl` and `-RepositoryCommit` set to the `Initial` commit, and no package or
symbol package may contain the id of any commit of the working history; as a positive control each
of them must name `Initial`. Before that the export fails when an exported
file is over 50 MiB (52 428 800 bytes; GitHub warns over 50 MiB and rejects a push over 100 MiB) or
when an exported text file names a commit of the working history (reachable, only in a reflog or
unreachable), abbreviated to 7–40 hex digits or full, or an id of the internal audit or plan
(such as a finding prefix `GEN` or `API` with a number). The exit code is the gate's.

`test-export-tools.ps1` holds the fixtures: `RejectsSourceOrParentDestination`,
`RejectsNonEmptyDestination`, `RejectsAbsoluteAllowlistEntry`, `RejectsGitAndInternalPlanningFiles`,
unclassified tracked files, the real allowlist, names, private commits in packages
(`PackagesDoNotNamePrivateCommits`) and in text files (`TextFilesDoNotNamePrivateCommits`), and
`OversizedBlobFailsExport` (a synthetic list and the blobs of the real HEAD). The package
ids and the root namespace are parameters that confirm the names of the tree: renaming is not
implemented, so only `Qyperion.BlazorECharts`, `Qyperion.BlazorECharts.WordCloud` and
`BlazorECharts` are accepted (`UnprefixedPackageIdsAreRejected`).

## Packages

Two packages are built from `src`: `Qyperion.BlazorECharts` and
`Qyperion.BlazorECharts.WordCloud` (net10.0 only). The ids carry the owner prefix because nuget.org
ids ignore case and `BlazorEcharts` belongs to another owner; the projects, assemblies
(`BlazorECharts.dll`, `BlazorECharts.WordCloud.dll`), namespaces and `_content` paths keep the
library name. `PackageId` is set in each project file, and `tools/Release/ReleaseTools.psm1` holds
the one table of ids and assembly names (`Get-PackageId`, `Get-AssemblyName`) that every release
tool uses; ids without the prefix are rejected in consumers and restores, and `docs:check` rejects
them in the documentation as package names (`UNPREFIXED_PACKAGE_ID`: install commands,
`PackageReference`, nuget.org links and "`<name>` package"). The unrelated `BlazorEcharts` 1.0.x
(2020, netstandard2.1) ships `BlazorEcharts.dll` and `_content/BlazorEcharts`: an application that
referenced both libraries would get two assemblies whose names differ only in case, which a
case-insensitive file system cannot keep apart. That combination is not supported.

Package metadata lives in `src/Directory.Build.props`; each project adds its description, license
expression and, for WordCloud, the tags `wordcloud` and `word-cloud`. Both packages carry XML
documentation, `README.md` (the project's package readme), `icon.png` (`src/icon.png`, drawn for
this project), `LICENSE` (MIT) and `THIRD-PARTY-NOTICES.md` at the package root, and the project URL
`https://github.com/Qyperion/BlazorECharts`. A release (`-RepositoryUrl`) also gets repository
metadata and the release notes `See <repository>/blob/v<version>/CHANGELOG.md`. The pinned JavaScript
and its upstream notices ship as static web assets under `staticwebassets/` and are served from
`_content/BlazorECharts/` and `_content/BlazorECharts.WordCloud/`. These URLs come from
`StaticWebAssetBasePath` in each project file, not from the package id; `StaticAssetPathTests` checks
that the C# constants that build the URLs match the project files. TypeScript sources and their
`tsconfig.json` are not packed. `EnablePackageValidation` runs on every pack; after the first
release, set `PackageValidationBaselineVersion` to the last published version in
`src/Directory.Build.props`, so that pack compares the API with that package from nuget.org.
Published metadata cannot be changed, so these rules are checked on every package:

- The license expression names everything a package distributes:
  `MIT AND Apache-2.0 AND BSD-3-Clause AND 0BSD` for the core (the library, ECharts, ZRender,
  tslib) and `MIT AND ISC` for WordCloud (the library, the bundled wordcloud2.js layout,
  echarts-wordcloud).
- The core ships the minified `dist/echarts.esm.min.mjs` of the locked archive as
  `js/echarts-<version>.js`. Only the test host serves the development build
  ([testing](testing.md#browser-test-harness)).
- The core depends on `Microsoft.AspNetCore.Components.Web` 10.0.0, the lowest patch, so an
  application or library pinned to an older patch restores without NU1605 or NU1109. The
  repository's tests and samples build against the central version 10.0.14.
- WordCloud depends on exactly the core package of the same version (`[<version>]`, set by a
  target after `_GetProjectReferenceVersions`): its installer runs only on that ECharts runtime.
  An application that references another core version directly gets NU1608. WordCloud contains
  no copy of ECharts; the core package contains no WordCloud file.
- The nuspec has exactly these dependencies, each with `exclude="Build,Analyzers"` and no other
  attribute, and exactly the metadata elements `id`, `version`, `authors`, `license`,
  `licenseUrl`, `icon`, `readme`, `projectUrl`, `description`, `copyright`, `tags`, `dependencies`
  and, for a release, `releaseNotes` and `repository`. A new `PackageReference`, a changed
  `exclude` or a new element such as `frameworkReferences` fails the inspection until the allowlist
  in `ReleaseTools.psm1` changes.
- The README of a release links to the repository only at its tag `v<version>`.
- Symbols ship as a `.snupkg` next to each package, with the portable PDB only. Source control
  queries stay off, because they would read the private history of a development clone; for a
  release `package.ps1` writes the SourceLink map itself (`/_/*` to
  `https://raw.githubusercontent.com/<owner>/<repository>/<commit>/*`, `Get-SourceLinkJson`), and
  `PathMap` maps the sources to `/_/` and the build output to `/_build/`. Generated sources of the
  build output are embedded in the PDB (target `EmbedIntermediateSources`). The inspection reads
  the PDB with `tools/Release/read-symbols.cs`, a .NET file-based app, because Windows PowerShell
  has no PDB reader: every document must be mapped, every `/_build/` document embedded, no document
  name or embedded source may contain a local path, and the SourceLink map must be the release's
  or, for a local build, absent. Razor-generated code names the absolute path of the `.razor` file,
  so the libraries have no `.razor` files: `EChart` renders its container in C#.
- In GitHub Actions `ContinuousIntegrationBuild` is on.

## Building and checking packages

```powershell
./tools/Release/package.ps1 -SourceRoot $PWD.Path -OutputPath (Join-Path $PWD 'artifacts/packages') -Configuration Release
```

Optional parameters: `-Version` (default `0.1.0-local`) and, together,
`-RepositoryUrl` and `-RepositoryCommit`. Without them the packages carry no repository
metadata, so the private local history does not leak. The build maps the source root to
`/_/` (`PathMap`), and the inspection rejects any absolute local path in any packed file.

`package.ps1` packs into `<OutputPath>/feed`, inspects both packages and both symbol packages
(their PDBs as read go to `<OutputPath>/symbols`), writes `packages-manifest.json` (package, entry
and symbol package SHA-256), runs the release-tool fixtures and then the consumers. Any failure
exits with a nonzero code; logs go to `<OutputPath>/logs`. Pack is not reproducible to the byte (zip
entry times, `LastWriteTime` in the static web assets props), so a release publishes the files of
the gate run that recorded their hashes, never a second pack.

| Script | Purpose |
|---|---|
| `inspect-nupkg.ps1 -Package -Kind Core\|WordCloud -SourceRoot -Version [-RepositoryUrl -RepositoryCommit] [-WorkPath]` | Metadata, allowed layout, documentation, license files, assets against the tracked `assets-manifest.json` and `schemas/upstream/sources.lock.json`, private paths; then the `.snupkg` next to the package |
| `read-symbols.cs` | Writes the PDBs of a `.snupkg` as JSON for the symbol inspection (`dotnet run --file`) |
| `confirm-release.ps1 -VerificationPath -Version -RepositoryUrl -RepositoryCommit` | Before a push: the gate report passed and still passes from its files, verified this release, and the feed holds exactly the recorded files ([publishing](#publishing)) |
| `test-release-tools.ps1` | RED fixtures: `MissingRuntimeAssetFailsInspection`, `WrongEngineHashFailsInspection` (manifest made consistent, only the lock rejects it), `WordCloudOpenCoreRangeFailsInspection`, `CoreUnprefixedIdFailsInspection`, `WordCloudUnprefixedCoreDependencyFailsInspection`, `ReleaseReadmeLinkedToAnotherVersionFailsInspection`, `RealSymbolsPassInspection`, `SymbolsEmbeddedPrivatePathFailsInspection`, `SymbolsUnmappedDocumentFailsInspection`, `SymbolsUnembeddedGeneratedSourceFailsInspection`, `SymbolsSourceLinkOfAnotherCommitFailsInspection`, `SymbolsSourceLinkWithoutRepositoryFailsInspection`, `CoreComponentsWebAboveMinimumFailsInspection`, `CoreExtraDependencyFailsInspection`, `WordCloudExtraDependencyFailsInspection`, `CoreChangedExcludeFailsInspection`, `CoreMetadataDevelopmentDependencyFailsInspection`, `CoreMetadataFrameworkReferencesFailsInspection`, `CoreMitOnlyLicenseFailsInspection`, `WordCloudMitOnlyLicenseFailsInspection`, `PackageConsumerCannotUseProjectReference`, `PackageConsumerCannotRestoreProject`, `PackageConsumerCannotReferenceUnprefixedId`, `PackageConsumerCannotRestoreUnprefixedId`; for the trim warning gate `OwnTrimWarningFailsAotGate`, `UnexplainedTrimWarningFailsAotGate`, `ExplainedFrameworkWarningPassesAotGate` |
| `test-packages.ps1 -SourceRoot -FeedPath -Version [-WorkPath] [-SdkVersion]` | Consumers from an isolated feed and cache, then the offline browser checks |
| `test-aot.ps1 -SourceRoot -PackageDirectory -ResultsDirectory` | The standalone consumer published trimmed and AOT from the recorded feed, output and warning checks, the browser scenario on a static host; see [WebAssembly trimming and AOT](../compatibility/wasm-aot.md) |
| `aot-known-warnings.json` | Explained third-party trim warnings that `test-aot.ps1` accepts; a warning that names BlazorECharts is never accepted |
| `verify-local.ps1 -SourceRoot -OutputPath [-Configuration] [-Version] [-RepositoryUrl -RepositoryCommit]` | The [local release gate](#local-release-gate) |
| `publish-demo.ps1 -SourceRoot -OutputPath [-BasePath]` | The [demo site](#demo-site): the trimmed standalone demo in `<OutputPath>/wwwroot` for a base path such as `/BlazorECharts` |
| `test-verification-gate.ps1 -SourceRoot -WorkPath` | Fixtures of the gate verdict |
| `export-initial.ps1 -SourceRoot -DestinationPath -RepositoryUrl -Version -PackageId -WordCloudPackageId -RootNamespace -AuthorName -AuthorEmail [-ManifestPath]` | The [initial export](#initial-export) |
| `public-tree.json`, `test-export-tools.ps1 -SourceRoot -WorkPath` | Allowlist of the public tree and the export fixtures |
| `ReleaseTools.psm1`, `VerificationGate.psm1`, `ExportTools.psm1` | Shared checks, the gate verdict and the export checks; Windows PowerShell 5.1 compatible |

## Consumers

`tests/PackageConsumer` holds applications that know nothing about this repository:
its own `Directory.Build.props`, `Directory.Build.targets` and `Directory.Packages.props`
stop the upward search, and the projects use `PackageReference` with
`Version="$(BlazorEChartsVersion)"` only.

| Consumer | Host | Packages |
|---|---|---|
| `Server` | Interactive Server | core + WordCloud |
| `Wasm` | Web App host + Interactive WebAssembly client (untrimmed) | core + WordCloud |
| `CoreOnly` | Interactive Server | core |
| `Library` | Interactive Server; the application references only its own Razor class library | WordCloud only, through the library, on `Microsoft.AspNetCore.Components.Web` 10.0.0; core transitively |
| `Standalone` | Standalone WebAssembly on a static file host, published trimmed and AOT by `test-aot.ps1` only | core + WordCloud |

`test-packages.ps1` copies them without `bin`/`obj` to `<WorkPath>/src`, writes a
`nuget.config` that maps exactly the two package ids to the local feed, and restores with the
private cache `<WorkPath>/nuget-packages`, from which their entries are removed first. It checks
that the restored graph takes both packages from the feed (`project.assets.json` and the cached
`.nupkg.metadata` hash) and holds no library under its unprefixed name, that the `Library` consumer restored
`Microsoft.AspNetCore.Components.Web` 10.0.0 and that the published output carries the engine
with the locked hash, then starts the published applications in Production and runs
`tests/PackageConsumer/packages.spec.ts`. Restoring Microsoft packages needs nuget.org;
the browser checks block every request that leaves localhost.

| Check | Instance |
|---|---|
| `OfflineDefaultLoading` | Server and WASM: chart, module formatter, WordCloud layout, PNG/SVG export, ECharts 6.1.0 |
| `PackagedAssetsRespectBasePath` | the same under `/charts-test` |
| `LazyNestedRouteLoadsRuntimeOnDemand` | no asset before navigation; `nested/lazy` resolves modules against the base |
| `CoreOnlyDoesNotRequestWordCloud` | no WordCloud request or asset |
| `WordCloudOnlyLibraryLoadsCoreTransitively` | `Library`: the core engine, WordCloud and the library's own static web asset, all from the transitive packages |
| `CdnModuleProviderIsOptIn`, `CustomProviderIsOptIn` | `ECharts:Provider` set to `module`/`custom`; the CDN URL is answered with the pinned engine, the packaged engine is never requested |

`-SdkVersion <version>` writes a `global.json` into `<WorkPath>/src`, so the consumers restore and
publish with that SDK, for example the oldest installed feature band; `logs/sdk.log` records it.

The consumers listen on eight consecutive ports, 5201-5208 by default; `BLAZOR_ECHARTS_CONSUMER_PORT`
sets the first of them. The browser checks need `npm ci` (Playwright) and Google Chrome in the
source root; the consumers themselves use no npm.

## Trimmed and AOT WebAssembly

After `package.ps1`, with the `wasm-tools` workload installed:

```powershell
./tools/Release/test-aot.ps1 -SourceRoot $PWD.Path -PackageDirectory (Join-Path $PWD 'artifacts/packages') -ResultsDirectory (Join-Path $PWD 'artifacts/aot')
```

The script checks the package hashes against `packages-manifest.json`, publishes
`tests/PackageConsumer/Standalone` trimmed and AOT from the recorded feed, rejects any trim
warning that names BlazorECharts or is not explained in `aot-known-warnings.json`, and runs
`tests/PackageConsumer/aot.spec.ts` against both outputs on a static file host. Details and
measurements: [WebAssembly trimming and AOT](../compatibility/wasm-aot.md).

## Publishing

`.github/workflows/release.yml` publishes both packages to nuget.org with
[Trusted Publishing](https://learn.microsoft.com/nuget/nuget-org/trusted-publishing): the publish
job exchanges its GitHub OIDC token for an API key that lives for one hour, so no key is stored.

| Job | What it does |
|---|---|
| `version` | The version from the tag `v<version>`, or from the `version` input of a manual run; a manual run publishes only on a tag |
| `verify` | `verify.yml` with that version: the full release gate, which packs the version with `https://github.com/<owner>/<repository>` and the checked-out commit and uploads the `verification` artifact |
| `publish` | Only for a tag. Waits in the `nuget` environment for a reviewer, runs `confirm-release.ps1` on the downloaded artifact, gets the key with `NuGet/login`, then `dotnet nuget push --skip-duplicate` for the core and WordCloud; each push also sends the `.snupkg` next to it |

The release plan checks the workflow (`Test-ReleaseWorkflow`): top-level `contents: read`, no write
permission, `id-token: write` only in the one job that logs in, a protected environment, the
confirmation before the login, the gate of `verify.yml`, no pack, no stored secret, no `git push`
and no pull request or branch trigger.

### One-time setup

On GitHub, in the public repository:

1. Protect `main` (pull requests, the `verify` checks, no force push once the history is public).
2. Create the environment `nuget` with a required reviewer and a deployment rule for tags `v*`.
3. Add the repository variable `NUGET_USER` with the nuget.org profile name (not the email).
4. Enable private vulnerability reporting (`SECURITY.md` relies on it) and Dependabot alerts.
5. Under **Settings → Pages**, set **Source** to **GitHub Actions**. The first `pages` run creates
   the environment `github-pages`; add a deployment rule for tags `v*` to it, because its default
   rule allows only the default branch.

On nuget.org:

1. Use an account with two-factor authentication; optionally reserve the id prefix `Qyperion.`.
2. Under **Trusted Publishing**, add a policy: owner and repository of the GitHub repository,
   workflow file `release.yml`, environment `nuget`.

### Releasing a version

1. Run `release` manually on `main` with the version and `publish` off: a dry run. The
   `verification` artifact holds the packages, the report and `packages-manifest.json`.
2. Tag the verified commit and push the tag:

   ```powershell
   git tag v<version> <commit>
   git push origin v<version>
   ```

3. Approve the `nuget` deployment once the gate passed. A run that failed after a partial push
   can run again: `--skip-duplicate` skips what nuget.org already has.
4. Check both package pages (README, license, repository, symbols, WordCloud depending on exactly
   the core of the same version) and build a clean consumer from nuget.org:
   `dotnet add package Qyperion.BlazorECharts --version <version>`, the same for WordCloud, in an
   Interactive Server and a WebAssembly application.
5. Check that the `pages` run of the tag deployed the [demo site](#demo-site), and create the
   GitHub release of the tag with the changelog section of the version; no workflow creates it.
6. Set `PackageValidationBaselineVersion` to the published version.

Until the first package is published, a new [initial export](#initial-export) can replace
`Initial` (force push). After that the public repository is the source: later versions are
ordinary commits there.

### Demo site

`.github/workflows/pages.yml` deploys the standalone WebAssembly demo
(`samples/BlazorECharts.Standalone`) to GitHub Pages, `https://<owner>.github.io/<repository>/`,
for every tag `v*`; a manual run deploys the chosen branch or tag, so pick the release tag to
redeploy a release. The `build` job installs the pinned `wasm-tools` workload set and runs
`publish-demo.ps1` with the base path that `actions/configure-pages` reads: a trimmed Release
publish restored from the lock files, `<base href>` set to that path, `404.html` as a copy of
`index.html` so that a deep link such as `/BlazorECharts/examples/wordcloud` starts the app, and
without the precompressed copies, which Pages never serves. The `deploy` job runs
`actions/deploy-pages` in the `github-pages` environment and no repository code.

The release plan checks the workflow (`Test-PagesWorkflow`): top-level `contents: read`, only tags
and manual runs, `pages: write` and `id-token: write` only in the one deploy job, the
`github-pages` environment, `publish-demo.ps1`, a pinned workload set, no stored secret and no
pack or push. To preview the site locally, run `publish-demo.ps1` and serve
`<OutputPath>/wwwroot` under the base path.

### Vulnerable dependencies

The core depends on `Microsoft.AspNetCore.Components.Web` 10.0.0, the lowest patch. Restore runs
NuGetAudit with warnings as errors, so an advisory for that version fails the build of the core.
Then release a patch that raises the lower bound to the first fixed version (`VersionOverride` in
`src/BlazorECharts/BlazorECharts.csproj` and `$script:ComponentsWebMinimum` in
`ReleaseTools.psm1`), so that no consumer resolves a vulnerable version through the library.
Suppress the advisory with `NuGetAuditSuppress` instead only when it cannot affect any
application that uses the library, and give the reason next to it.
