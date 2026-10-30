# Updating Apache ECharts

BlazorECharts pins one exact ECharts release, the ZRender and tslib versions it depends on,
and one echarts-doc commit. An upgrade is a separate change with its own review: a newer
upstream version is never picked up because a version range allows it. Run every command
from the repository root in Windows PowerShell, sequentially for `dotnet`.

The steps below use `6.1.0` for the current and `<new>` for the target version. Keep a log
of each command, its exit code and test counts under `artifacts/upgrade/`.

## 1. Pin the exact artifacts

1. Read the upstream release notes and the npm metadata of every package:

   ```powershell
   npm view echarts@<new> version dist.tarball dist.integrity gitHead license dependencies
   npm view zrender@<zrender-version> version dist.tarball dist.integrity gitHead license
   ```

2. In `schemas/upstream/sources.lock.json`, update `version`, `url`, `integrity` and
   `upstreamCommit` (`gitHead`) of `echarts` and, if they changed, `zrender` and `tslib`.
   `sha256` is the SHA-256 of the tarball (`Get-FileHash -Algorithm SHA256`), and
   `files["dist/echarts.esm.min.mjs"]` (the packaged runtime) and `files["dist/echarts.esm.mjs"]`
   (the development build that the test host serves) are the hashes of those files inside it. Check `declarations` and
   `notices` against the new package. Update `runtimeSource` to the same archive.
3. Compare the licenses and `NOTICE` files with the previous release. A license change stops
   the upgrade until `THIRD-PARTY-NOTICES.md` and the package notices are reviewed.
4. `npm run assets:acquire` downloads into `artifacts/upstream` and fails on any integrity,
   SHA-256, version or file-hash mismatch. It never trusts a cached archive without checking it.
   Each package is extracted into an empty directory that then replaces `artifacts/upstream/<package>`,
   so no file of the previous version survives. The generator runs it with `--verify`: that compares
   every extracted file with the archive, changes nothing and fails on a stale, missing or changed
   file; run `npm run assets:acquire` again then. The origin index of the scope gate reads the
   declaration files that the archive lists (`tar -tzf`), not whatever the directory holds.
5. Choose the echarts-doc commit that documents the release. Set `commit`, `url` and
   `versionAlignment` in `schemas/upstream/docs-snapshot.lock.json`. `npm run docs:acquire` hashes
   the archive first and fails on a new commit before it writes the cache, unpacks anything or runs
   the archive's converter. The converter is JavaScript from the archive (`tool/md2json.js` and
   `dep/`), so review those scripts of the new commit first, then run
   `npm run docs:acquire -- --candidate`. It keeps the archive apart as
   `artifacts/generator/upstream/echarts-doc.candidate.tgz`, fails and writes
   `artifacts/generator/docs-snapshot.lock.candidate.json` with the archive hash, the derived
   snapshot hashes and the input file list. An archive that contains `node_modules` is rejected
   before anything is unpacked: the converter resolves its dependencies from the workspace
   `node_modules` only. `npm run docs:acquire -- --offline --candidate` converts the saved
   candidate again without a download. Review the candidate (the input files must still be
   the `en/option`, `en/api` Markdown and the reviewed files of `tool/` and `dep/`, scripts and
   templates such as `tool/plain-md.tpl`), copy it over the
   lock, and run `npm run docs:acquire` again until it exits 0. Copy the new `commit` and
   `sha256` to `documentation` in `sources.lock.json`.

   The converter needs `marked` 0.3.19, `htmlparser2` 4.1.0 and `globby` 11.1.0: `dependencies`
   in `docs-snapshot.lock.json` records them, and `package.json` pins the same versions as
   development dependencies. `npm audit` reports `marked` 0.3.19 as vulnerable; here it parses only
   the pinned echarts-doc Markdown and never ships in a package. Do not upgrade these three with
   `npm audit fix`, because a converter of another version produces another schema; change them
   only together with the echarts-doc commit.

## 2. Extract and diff

1. Keep the previous schema: `Copy-Item -Recurse schemas/upstream/echarts-6.1.0.api artifacts/upgrade/before.api`.
2. Rename the version-named inputs and outputs with `git mv`: the schema directory `schemas/upstream/echarts-6.1.0.api/`,
   `schemas/overrides/echarts-6.1.0.json`, `docs/api-coverage/*-6.1.0.*`, `schemaPath` in
   `tools/BindingGenerator/src/schema.ts` and the paths at the top of `tools/BindingGenerator/src/cli.ts`. `git grep -n "6\.1\.0"` lists every other mention; each one
   is a pin (locks, asset names), a runtime check (step 5), a test expectation or documentation.
3. `npm run api:extract -- --allow-stale-overrides` writes the new schema,
   `artifacts/generator/api-changes.json` and `artifacts/generator/reconciliation.json`. Without the
   flag extraction stops at the first override that no longer matches; with it, stale overrides
   are skipped and listed in `artifacts/generator/stale-overrides.json`. Removed records and changed
   signatures stay in `apiChanges` of the schema until an explicit decision is recorded.
4. Diff the contract:

   ```powershell
   npm run api:diff -- --before artifacts/upgrade/before.api --after schemas/upstream/echarts-<new>.api --output artifacts/upgrade/api-diff.json
   ```

   The [diff codes](generator.md#semantic-api-diff-npm-run-apidiff) say what each entry needs.
   `rejected` entries (stale overrides) make the command exit 1; resolve them in step 4.

## 3. Reconcile the documentation

`artifacts/generator/reconciliation.json` lists docs-only paths, declaration-only paths and
conflicting types. A docs-only path stays an unresolved record until the declarations, the
runtime source or an override with a hash-pinned source span explains it; documentation alone
never makes an API implemented. Documented but unimplemented paths belong to K9 with a pinned
runtime span (`scope.k9`). Record every decision in `schemas/overrides/echarts-<new>.json` with a
reason and source; the evidence rules are in
[the reconciliation guide](../api-coverage/reconciliation.md).

## 4. Map and generate

1. Resolve each `STALE_OVERRIDE`: review the new contract of the record, then re-pin
   `expectedSignature` with `node tools/BindingGenerator/src/cli.ts signature <recordId>`, update
   the pinned `source` to the new package version and file hash, or remove the override when
   generation now covers the record.
2. Record each reviewed removal or signature change as an `apiDecisions` entry
   (`recordId`, `previousSignature`, `currentSignature`, `reason`) matching `apiChanges` of the new schema.
   Then run `npm run api:extract` without the flag: it must pass, which proves that no override is
   stale, and it applies the re-pinned overrides to the schema.
3. `npm run generate` maps additions automatically when their shapes are supported. Anything it
   cannot map is named in `schemas/generated/mapping-diagnostics.json`; map it with a `csharp`
   override that states its reason. Generated files are never edited by hand.
4. `npm run generate:check` must leave tracked files unchanged, and `npm run api:check` must report
   no unresolved S record, no residual record and no drift. A new record outside S changes
   `docs/api-coverage/scope-categories-<new>.json`; review its category before regenerating.
5. Review `git diff schemas/generated/public-api.txt`: every removed or changed line is a public
   C# change and needs a SemVer decision (step 7). `TYPE_NAME_LOCK` names a published type that
   the new version no longer generates; removing its entry from
   `schemas/generated/type-names.lock.json` is a major change
   ([type names](generator.md#type-names)).

## 5. Runtime assets and version constants

1. `npm run assets:build` copies the new `dist/echarts.esm.min.mjs` as `js/echarts-<new>.js`, the
   notices and `wwwroot/js/assets-manifest.json`. `npm run assets:check` rebuilds in memory and
   rejects drift; `npm run typecheck:runtime` checks the TypeScript runtime.
2. Update the runtime version checks: `tools/Assets/build.mjs`, `tools/Assets/build-wordcloud.mjs`,
   `tools/Assets/build-probe.mjs`, the development engine route in `tests/BrowserHost/Program.cs`,
   the module URL and default version in
   `src/BlazorECharts/JavaScript/runtime-loader.ts` and `runtime-provider.ts`,
   `EChartsRuntimeOptions` and `EChartsError.UpstreamVersion`, the package descriptions in both
   `.csproj` files and the package READMEs.
3. WordCloud checks the exact core version (`wordcloud-extension.ts`). Follow
   [Updating echarts-wordcloud](update-wordcloud.md) to re-verify or adapt it for the new core.

## 6. Verify

```powershell
npm run snapshots   # getOption() snapshots of the new runtime; review their diff
dotnet build BlazorECharts.slnx -c Release
dotnet test BlazorECharts.slnx -c Release --no-build
npm run typecheck:generator
npm run test:generator
npx vitest run --config vitest.config.ts --project javascript
npm run test:browser
npm run test:compatibility
npm run docs:check
./tools/Release/package.ps1 -SourceRoot $PWD.Path -OutputPath (Join-Path $PWD 'artifacts/packages') -Configuration Release
./tools/Release/test-aot.ps1 -SourceRoot $PWD.Path -PackageDirectory (Join-Path $PWD 'artifacts/packages') -ResultsDirectory (Join-Path $PWD 'artifacts/aot')
npm run test:performance
```

`dotnet build` includes `tests/Documentation`, so every documentation snippet compiles against
the new API. Compare `docs/compatibility/performance-baseline.md` with the previous baseline and
explain any regression; the overhead against native ECharts shows whether it comes from ECharts
or from the wrapper. A failed resource check needs a fix or a budget with a new reason. Update the compatibility documents (`docs/compatibility/*.md`) with the
new versions and the browsers that were actually run.

## 7. Choose the library version

`summary.semver` of the API diff is the lower bound:

| Evidence | Library version |
|---|---|
| A public C# member, union alternative or overload removed or changed incompatibly, or `apiDecisions` that drop behavior | major |
| New mapped API or a new upstream minor version, with no incompatible change | minor |
| Upstream patch release with no diff entry above `patch`, an unchanged `public-api.txt` and an unchanged [public API baseline](release.md#public-api-baseline) | patch |

Write the reasoning, the diff summary and the verification results into the release notes; see
[Release and packages](release.md#versions).
