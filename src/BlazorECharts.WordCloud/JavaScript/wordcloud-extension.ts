// The installer is copied byte-for-byte from the locked compatibility/lifecycle recipe.
// @ts-expect-error The generated distributable is an external ESM dependency.
import install from './wordcloud-installer.js';
// Optional RCL sibling: keep this import external so the page coordinator retains its identity.
// @ts-expect-error Resolved by the RCL static asset URL in the browser.
import { tryStabilityParticipant } from '../../BlazorECharts/js/blazor-echarts.js';
import { wordCloudStability, wordCloudResources } from './wordcloud-stability.ts';

const installed = new WeakSet<object>();
/** Receives the page's selected runtime; never imports or allocates another ECharts runtime. */
export function register(runtime: {version:string;[key:string]:unknown}): void {
  if (runtime?.version !== '6.1.0') throw new Error('WordCloud requires the tested ECharts 6.1.0 runtime.');
  if (installed.has(runtime)) return;
  for (const key of ['extendSeriesModel','extendChartView','registerLayout','registerPreprocessor','List']) {
    if (typeof runtime[key] !== 'function') throw new Error(`WordCloud runtime capability missing: ${key}`);
  }
  for (const key of ['helper','graphic','number','util','format']) {
    if (!runtime[key]) throw new Error(`WordCloud runtime capability missing: ${key}`);
  }
  const plugin = install(runtime);
  plugin.setLayoutLifecycle((series: any, api: any, canvas: HTMLCanvasElement) => {
    // A chart made outside the bridge keeps the upstream behavior: no stability ticket or readiness wait.
    const participant = tryStabilityParticipant((runtime.getInstanceByDom as Function)(api.getDom()));
    if (!participant) return null;
    const ticket = participant.begin('WordCloud', 'layout');
    const createStyle = (runtime.helper as { createTextStyle(model: unknown): Record<string, any> }).createTextStyle;
    const makeFont = (runtime.graphic as { Text: { makeFont(style: Record<string, any>): string | undefined } }).Text.makeFont;
    return wordCloudStability(ticket, canvas, () => wordCloudResources(series, createStyle, makeFont));
  });
  installed.add(runtime);
}
