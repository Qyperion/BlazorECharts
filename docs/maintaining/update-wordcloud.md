# Updating echarts-wordcloud

The `Qyperion.BlazorECharts.WordCloud` package ships the published npm package
[`@qyperion/echarts-wordcloud`](https://github.com/Qyperion/echarts-wordcloud), a fork of
`ecomfe/echarts-wordcloud` for ECharts 6. The fork carries the layout lifecycle that the extension
needs, so the package is used as published: the installer is built from its `index.js` without
changes. The archive, the hash of its UMD bundle and the hash of the installer are pinned in
`schemas/upstream/sources.lock.json`; the results are in the
[compatibility report](../compatibility/echarts-6.1.0-wordcloud.md).

A change that the extension needs from the WordCloud runtime is made and released in the fork;
this repository then moves the pin to the new release. Re-run this procedure for a new release of
the fork and for every ECharts upgrade: the extension refuses any core version other than the
tested one.

## 1. Pin the release

1. Pin the package as in [Updating Apache ECharts](update-echarts.md#1-pin-the-exact-artifacts):
   `version`, `url`, `integrity`, `sha256`, `upstreamCommit` (npm `gitHead`) and
   `files["dist/echarts-wordcloud.js"]`, then `npm run assets:acquire`. The scoped name holds a
   slash, so `directory` (`echarts-wordcloud`) names the archive
   (`artifacts/upstream/echarts-wordcloud-<version>.tgz`) and the extracted package; keep it, the
   generator and the builders read the package from that directory.
2. `node tools/Assets/build-probe.mjs` builds the installer from `installer.entry` (`index.js`)
   with `installer.buildTool` into a function that receives the page's ECharts runtime, and checks
   `installer.sha256`; on a new version it fails with the built and the pinned hash. Pin the built
   hash only after the compatibility tests pass. Run the builders from PowerShell: they call `tar`
   with Windows drive paths, which the GNU tar of Git Bash cannot open.

   ```powershell
   npm run test:compatibility
   ```

3. The extension relies on these behaviors of the fork; the test in brackets fails without each:
   - `setLayoutLifecycle(factory)` and a synchronously created layout instance with its own
     `canvas`, which starts after the lifecycle's readiness (`wordcloud.spec.ts`);
   - `dispose(retired)` cancels the layout, with no draw after disposal or replacement
     (`Layout_UpdateResizeDispose_NoLateDrawing`, `WordCloudCancellationDuringDraw_*`);
   - loop and callback errors end the layout with `wordcloudabort` and `detail.error`
     (`WordCloudAsyncFailure_RejectsWithoutUnhandledError`);
   - an iterative non-animated layout (`WordCloudNonAnimatedLayout_10000WordsComplete`);
   - `clearTimeout` only for the non-animated start timer
     (`WordCloudNonAnimatedLayout_CancelsInitialTimer`,
     `WordCloudAnimatedCancel_DoesNotClearTimeoutWithImmediateId`);
   - a mask that cannot be read fails with `WordCloud mask decode/CORS failed: …` instead of being
     skipped (`WordCloudMaskDecode_AndCorsFailureAreObserved`);
   - removal and disposal of a view whose first render failed
     (`WordCloudFailedFirstRender_UpdatesAndDisposes`);
   - `updateVisual` keeps the drawn words (`WordCloudBrush_KeepsWordsAndExport`);
   - `randomSeed`, `z`, `zlevel` and the opacity of a `visualMap`
     (`WordCloudSeed_RepeatsLayoutWithLayersAndVisualMapOpacity`).

   Without a lifecycle (a chart outside the library) the layout behaves like the plain package
   (`WordCloudForeignChart_RendersWithoutStability`).
4. Update the version in `WordCloudExtension.Version` and in `version` of
   `schemas/overrides/wordcloud-<version>.json`;
   `WordCloudExtensionVersion_MatchesShippedManifestLockAndOverrides` compares them with the lock
   and the shipped `assets-manifest.json`. Also update the package description and README,
   `docs/extensions.md`, `tests/browser/demo/demo.spec.ts`, `upstream` in
   `tests/browser/matrix/matrix-reporter.ts` and, when the package `LICENSE` changes,
   `THIRD-PARTY-NOTICES.md`. For a new core version also update the core version check in
   `src/BlazorECharts.WordCloud/JavaScript/wordcloud-extension.ts` and `coreVersion` in
   `tools/Assets/build-wordcloud.mjs`.

## 2. Models and assets

1. Rename `schemas/overrides/wordcloud-<version>.json` for the new version, update its `version`
   and the path in `tools/BindingGenerator/src/wordcloud.ts`. `npm run generate` writes the
   WordCloud inventory (`schemas/upstream/wordcloud-<version>.api.json`), the generated models and
   `docs/api-coverage/wordcloud-<version>.md`, and removes those of the previous version;
   `npm run api:check` gates them as S4 with no unresolved record. Every declared member needs a
   mapping; `omit:<reason>` keeps one that the series does not read from options, such as
   `mainType`, out of the model (it stays an unknown JSON field), and the reason is required.
   Re-check each omitted member against the new view and layout: one that takes effect gets a type
   again, as `z` and `zlevel` did in 3.0.0. `noEffect` gives a member without effect, such as
   `cursor`, its `No effect` remarks. A member whose TypeScript type changes keeps its C# type
   unless the change is a compatible widening; the `reason` of the overrides records each kept
   difference.
2. The core schema (`schemas/upstream/echarts-6.1.0.api`) is extracted from ECharts alone: the
   WordCloud declarations augment the ECharts module types and would change the core contract.
   `npm run api:extract` after a new pin only updates the WordCloud entry of its `sources`.
3. `npm run assets:build` writes the installer, the extension bundle, the notices (the package
   `LICENSE`, with the ISC text of echarts-wordcloud and the MIT text of wordcloud2.js) and
   `src/BlazorECharts.WordCloud/wwwroot/js/assets-manifest.json`; it fails if the extension would
   bundle a second copy of ECharts. `npm run assets:check` rejects drift.
4. New members change `tests/BlazorECharts.Tests/Api/PublicApi/BlazorECharts.WordCloud.txt`;
   accept them as described in [Public API baseline](release.md#public-api-baseline).

## 3. Verify

```powershell
npm run test:compatibility
npm run test:browser -- wordcloud.spec.ts wordcloud-registration.spec.ts
npx vitest run --config vitest.config.ts --project javascript
./tools/Release/package.ps1 -SourceRoot $PWD.Path -OutputPath (Join-Path $PWD 'artifacts/packages') -Configuration Release
./tools/Release/test-aot.ps1 -SourceRoot $PWD.Path -PackageDirectory (Join-Path $PWD 'artifacts/packages') -ResultsDirectory (Join-Path $PWD 'artifacts/aot')
```

The package consumers render and export a word cloud from the local packages, offline, in
Server, WebAssembly, trimmed and AOT builds. Update the compatibility report with the new
versions and the observed results.
