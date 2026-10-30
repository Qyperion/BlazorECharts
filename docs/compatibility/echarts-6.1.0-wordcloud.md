# ECharts 6.1.0 / WordCloud 3.0.0 compatibility

The `Qyperion.BlazorECharts.WordCloud` package ships the published npm package
`@qyperion/echarts-wordcloud` 3.0.0, built against ECharts 6.1.0 without changes. The package is
a fork of [ecomfe/echarts-wordcloud](https://github.com/ecomfe/echarts-wordcloud) for ECharts 6,
maintained in [Qyperion/echarts-wordcloud](https://github.com/Qyperion/echarts-wordcloud); it is
not an Apache ECharts release. Verified on 2026-10-30 with Windows, Node 24.18.0, npm 12.2.0,
.NET SDK 10.0.403 and Google Chrome 156.0.8078.74.

## Why the fork

The original echarts-wordcloud 2.1.0 renders with ECharts 6.1.0, but:

- disposal does not stop the layout: after an update, resize or removal the old layout keeps
  drawing, and a replaced series keeps its offscreen canvas listener;
- the default non-animated layout calls itself once per word: 10,000 words overflow the stack
  ("Maximum call stack size exceeded") and the layout never completes;
- a mask that cannot be read is only logged: the layout then reads the empty, transparent canvas
  as occupied and places no word, and a cross-origin image taints the canvas so that the layout
  throws a `SecurityError`;
- after a failed first render (another series throws while the chart renders), removing the
  series or disposing the chart throws, and the chart stays registered;
- a `brush` action in a mixed chart re-renders the word cloud without a layout and clears it.

Version 1.0.0 of the package fixed these with a local patch of 2.1.0. Since the original is no
longer maintained, the fixes moved to the fork, which 3.0.0 publishes with tests of its own. The
fork also adds `randomSeed`, applies the series `z` and `zlevel` to the words and the opacity of a
`visualMap`, makes the `wordcloudstart` and `wordclouddrawn` events cancelable, can be imported
without a DOM and declares typed options for ECharts 6.

## What the extension uses

| Package member | Use |
|---|---|
| `setLayoutLifecycle(factory)` | The hook of the package's stability adapter: `run(start, cleanupFailure)`, `retire()`, `cancel()`, `fail(error)`. |
| `layoutInstance.canvas`, `dispose(retired)` | The layout canvas emits `wordcloudstop` and `wordcloudabort`; disposal cancels the layout and removes its listeners. |
| `src/layout.js` | A `cancelLayout` closure, an iterative non-animated layout, `wordcloudabort` with `detail.error` for loop and callback errors, `clearTimeout` only for the non-animated start timer. |
| `src/wordCloud.js` | The layout instance is created synchronously and starts after the lifecycle's readiness; a mask that cannot be read fails with `WordCloud mask decode/CORS failed: …`. |
| `src/WordCloudView.js` | A reused view retires the old layout; removal and disposal also work after a failed first render; `updateVisual` keeps the drawn words. |

## Package lifecycle

The extension module (`src/BlazorECharts.WordCloud/JavaScript`) connects the layout to the
chart's stability:

- A chart owned by the library gets a layout ticket synchronously, through
  `tryStabilityParticipant`. `AwaitStableAsync` and exports wait for it; `OnReady`,
  `SetOptionAsync` and the ECharts `finished` event do not mean that the layout ended.
- Before the layout starts, the extension loads every font the words use (`document.fonts.load`
  with the pinned `createTextStyle` and `Text.makeFont`, including item and rich-token fonts), for
  at most 3 seconds, and decodes the mask. Other fonts of the page are not awaited.
- A font that fails to load, is invalid or does not load within 3 seconds fails the ticket
  (`LayoutFailed`, also raised as a `blazorecharts:error` event), and the layout still draws with
  the browser's fallback font. A mask that cannot be decoded fails the ticket and no layout starts.
- `wordcloudstop` completes the ticket; abort, callback failure and cancellation cannot become a
  success. Visual-only updates (`hideLoading`, `highlight`) keep the current layout; replacement,
  removal and recreation retire it.
- A chart created outside the library (`getECharts().init(...)`) gets no ticket and behaves like
  the plain package.

## Reproduction

From the repository root:

```powershell
npm ci
npm run assets:acquire
dotnet build BlazorECharts.slnx -c Release
npm run test:compatibility
```

`npm run test:compatibility` re-verifies the archives, builds the installer from a copy of the
package under `artifacts/compatibility/`, checks its hash and runs the standalone probe
(`tests/browser/compatibility/wordcloud.spec.ts`, served at `/compatibility/`). Acquisition checks
exact registry URLs, SHA-512 npm integrity, SHA-256 archive hashes and selected file hashes; a
corrupt cache fails without rewriting the lock, and `--offline` uses already verified archives.

## Locked inputs

The machine-readable record is [`sources.lock.json`](../../schemas/upstream/sources.lock.json).

| Package | Version | npm gitHead | Archive SHA-256 |
|---|---|---|---|
| echarts | 6.1.0 | c5a48f5f97d23e5379720870b8444cd05b50ffb4 | 681aff88cc1038c3fa941a3a53d1b177a52250b05335efc607d6105ae13be481 |
| @qyperion/echarts-wordcloud | 3.0.0 | ade0b8d3d96d9956af7c45945d70fd578109212f | 9103333e91b67071d4822a7bc721aa2b34c980e80113c9b0dfeb02828b5aabf1 |
| zrender | 6.1.0 | 32b6686724832dcea026e9443d056ea216ed0ab2 | 38f2fb722a638be016ca0175b139c40c886ef47fc2afdb741b2e7e7ae9683f9c |
| tslib | 2.3.0 | 0b9301459c223140c9a01b4215cbbc1639a396ca | ae285639feff7e3c39de4626352181a5d73b815725e42639b411c43848abffdb |

| Build | SHA-256 |
|---|---|
| UMD bundle `dist/echarts-wordcloud.js` | `9a21315f1a0b43eec3e32d2a991e6717b367661d04880c0173c56d2c74f017f5` |
| Installer `js/wordcloud-installer.js` | `787351c0b914c20281b181c6fd71569a81f54fc8dea28876e473fb0657df0f7c` |

The packages ship ECharts' minified ESM build `dist/echarts.esm.min.mjs` byte for byte; the test
host serves the development build of the same archive at the same URL. The installer is built
from the package's `index.js` with esbuild 0.28.2, and its only external dependency resolves to
the runtime passed to `register`, so the WordCloud package contains no second ECharts.

## Standalone probe

| Case | Result |
|---|---|
| ExactPair_ReportsLockedVersions | pass: 6.1.0, 3.0.0, the locked archive and installer hashes |
| RegisterIntoPassedRuntime_UsesSingleIdentity | pass: one registration after two calls, no `window.echarts` |
| WordCloud_CanvasAndSvg_Render200Words | pass: 200 of 200 words on both renderers |
| MaskImage_DecodeBeforeLayout | pass: decoded 1200×800 mask, no word outside it |
| MaskImage_FailureRejects | pass: decoding rejects and no layout starts |
| Layout_UpdateResizeDispose_NoLateDrawing | pass: no late draws or retained listeners |
| Export_AfterLayoutContainsLastWord | pass: the PNG and SVG contain the last word |
| PackageDistribution_RendersTheUmdBundle | pass: the published UMD file renders 200 words |

The probe workload is 1200×800 pixels, Arial 12px, grid size 4 and 200 short words, with a unique
color for the last one. The probe page enforces `script-src 'self'` without `unsafe-eval` and
fails on console or page errors.

## Package tests

`tests/browser/wordcloud.spec.ts` runs against `/harness/wordcloud/{server|wasm}` and checks,
in both render modes:

- exports wait for the actual final layout, not for `finished`; old update, resize and recreate
  layouts cannot release the newest one;
- 10,000 words without `LayoutAnimation` complete; 2,000 long Ukrainian words complete on Canvas
  and SVG, and the export shows the placed subset;
- with `RandomSeed` a layout at another size and back repeats every word's position and rotation;
  the words take the series `Z` and `Zlevel` and the opacity of a continuous `visualMap`;
- delayed fonts and masks block the layout; a missing, hanging (3 s) or invalid unquoted font is
  reported and the words are drawn with the fallback; a missing or cross-origin mask fails the
  layout; a throwing callback fails it without an unhandled error;
- empty, cancelled and disposed layouts end; cancelling an animated layout clears only its
  pending `setImmediate`, and the non-animated one exactly its start `setTimeout`;
- after a failed first render the series can be replaced and the chart disposed; a `brush` action
  keeps the words and the export;
- a chart created with `getECharts().init(...)` renders without a ticket;
- after cleanup, plugin listeners, timers and reference entries return to zero.

`tests/browser/wordcloud-registration.spec.ts` covers registration, masks, inline callbacks,
text styles, a click on a word delivered as `ChartEvents.Click` and that pages without WordCloud
do not load it. Exports and event order from a local
run are in `artifacts/wordcloud/`.

## Notices

The package `LICENSE` carries the ISC text of echarts-wordcloud and the MIT text of wordcloud2.js,
whose layout `src/layout.js` is based on. The NuGet package ships it as
`notices/echarts-wordcloud/LICENSE`, next to `notices/PROVENANCE.md` with the hashes above.

Primary sources: [@qyperion/echarts-wordcloud npm 3.0.0](https://registry.npmjs.org/@qyperion/echarts-wordcloud/3.0.0),
[published layout source](https://github.com/Qyperion/echarts-wordcloud/blob/ade0b8d3d96d9956af7c45945d70fd578109212f/src/layout.js),
[published registration source](https://github.com/Qyperion/echarts-wordcloud/blob/ade0b8d3d96d9956af7c45945d70fd578109212f/src/wordCloud.js),
[ECharts npm 6.1.0](https://registry.npmjs.org/echarts/6.1.0).
