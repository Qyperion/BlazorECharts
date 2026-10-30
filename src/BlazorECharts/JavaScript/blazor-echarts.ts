// The stable browser API for function modules and extensions (_content/BlazorECharts/js/blazor-echarts.js).
// Its exports follow the package version (SemVer). It reads the page coordinator that the .NET interop module
// (runtime-loader.js) registers under its protocol key and never imports that module: a failed request of the
// interop module URL cannot break this one.
import { EChartsError } from './errors.ts';
import { pageRuntimeKey } from './runtime-protocol.ts';
import type { PageRuntime } from './page-runtime.ts';
import type { ChartObject, EChartsRuntimeObject } from './runtime-provider.ts';

const page = () => (globalThis as unknown as Record<symbol, PageRuntime | undefined>)[pageRuntimeKey];

/** The ECharts runtime that the page selected, after .NET initialized it. */
export function getECharts(): EChartsRuntimeObject {
  const runtime = page();
  if (!runtime)
    throw Error('Initialize ECharts before using browser helpers.');

  return runtime.getECharts();
}

/** Extension contract: begin synchronously inside the render/layout command, settle exactly once. */
export function stabilityParticipant(native: ChartObject) {
  const runtime = page();
  if (!runtime)
    throw new EChartsError('ChartDisposed', 'Stability participants require a live bridge-owned chart.');

  return runtime.stabilityParticipant(native);
}

/** Same as stabilityParticipant, but null for a chart that the bridge does not own (for example from getECharts().init). */
export function tryStabilityParticipant(native: ChartObject) {
  return page()?.tryStabilityParticipant(native) ?? null;
}
