// The .NET interop module: internal, changes with the package. The stable browser API is blazor-echarts.ts.
import { PageRuntime } from './page-runtime.ts';
import type { JsBinding, PreparedOptionTransport } from './binding-contracts.ts';
import type { ExtensionDescriptor } from './extension-registry.ts';
import type { EventCallbacks } from './events.ts';
import type { ManagedChartCallbacks } from './chart-observers.ts';
import type { ChartObject, RuntimeConfiguration, ThemeValue } from './runtime-provider.ts';
import { EChartsError } from './errors.ts';
import { pageRuntimeKey, runtimeProtocol } from './runtime-protocol.ts';

export { runtimeProtocol };

// Symbol.for also shares identity if a consumer imports another copy of the facade module.
function page(): PageRuntime {
  const global = globalThis as unknown as Record<symbol, PageRuntime>;
  return global[pageRuntimeKey] ??= new PageRuntime(
    url => import(/* @vite-ignore */ url),
    document.baseURI,
    new URL('./echarts-6.1.0.js', import.meta.url).href
  );
}

/** The handshake: the protocol always comes first, so this check also rejects callers of other package versions. */
export const openFacade = (
  protocol: number,
  ownerId: string,
  config: RuntimeConfiguration,
  extensions: readonly ExtensionDescriptor[],
  retry = false,
  server = false,
  resultLimit: number | null = null
) =>
  protocol !== runtimeProtocol
    ? Promise.reject(new EChartsError('RuntimeVersionMismatch', `The page has BlazorECharts browser scripts of protocol ${runtimeProtocol}, `
      + `but the .NET package uses protocol ${typeof protocol === 'number' ? protocol : 'unknown'}: the page kept the scripts of another package version. Reload the page.`))
    : page().bridged('openFacade').openFacade(ownerId, config, extensions, retry, server, resultLimit);

export const createChart = (
  ownerId: string,
  element: HTMLElement,
  theme: ThemeValue,
  init: Record<string, unknown>,
  observationId?: string | null,
  exportReadiness?: EventCallbacks | null
) =>
  page().bridged('createChart').createChart(ownerId, element, theme, init, observationId, exportReadiness);

export const observeChart = (
  ownerId: string,
  observationId: string,
  element: HTMLElement,
  autoResize: boolean,
  generation: number,
  callbacks: ManagedChartCallbacks,
  serverCallbacks = false
) => page().bridged('observeChart').observeChart(ownerId, observationId, element, autoResize, generation, callbacks, serverCallbacks);

export const releaseObservation = (ownerId: string, observationId: string) =>
  page().bridged('releaseObservation').releaseObservation(ownerId, observationId);

export const setAutoResize = (ownerId: string, observationId: string, autoResize: boolean) =>
  page().bridged('setAutoResize').setAutoResize(ownerId, observationId, autoResize);

export const checkChartSize = (ownerId: string, observationId: string) => page().bridged('checkChartSize').checkChartSize(ownerId, observationId);
const utf8 = new TextDecoder();

// .NET sends the options as UTF-8 bytes: one JSON.parse without Blazor's per-node reviver.
export const setOption = (
  ownerId: string,
  chartId: string,
  json: Uint8Array,
  bindings: readonly JsBinding[] | null,
  update: Record<string, unknown>,
  generation?: number | null,
  revision?: number | null,
  sequence?: number | null
) =>
  page().bridged('setOption').setOption(
    ownerId,
    chartId,
    { json: JSON.parse(utf8.decode(json)) as Record<string, unknown>, bindings: bindings ?? [] },
    update,
    generation,
    revision,
    sequence
  );

export const setTheme = (
  ownerId: string,
  chartId: string,
  theme: string | null,
  generation?: number | null,
  revision?: number | null,
  sequence?: number | null
) => page().bridged('setTheme').setTheme(ownerId, chartId, theme, generation, revision, sequence);

export const recreateChart = (
  ownerId: string,
  chartId: string,
  init: Record<string, unknown>,
  theme: string | null,
  generation?: number | null,
  revision?: number | null,
  sequence?: number | null
) => page().bridged('recreateChart').recreateChart(ownerId, chartId, init, theme, generation, revision, sequence);

export const disposeChart = (ownerId: string, chartId: string) => page().bridged('disposeChart').disposeChart(ownerId, chartId);
export const releaseFacade = (ownerId: string) => page().bridged('releaseFacade').releaseFacade(ownerId);

export const subscribe = (ownerId: string, chartId: string, id: string, name: string, query: unknown, callback: EventCallbacks, throttle = 0) =>
  page().bridged('subscribe').subscribe(ownerId, chartId, id, name, query, callback, throttle);

export const unsubscribe = (ownerId: string, chartId: string, id: string) => page().bridged('unsubscribe').unsubscribe(ownerId, chartId, id);

export const dispatchAction = (
  ownerId: string,
  chartId: string,
  payload: Record<string, unknown>,
  settings: boolean | Record<string, unknown> | null,
  generation?: number | null,
  revision?: number | null,
  sequence?: number | null
) => page().bridged('dispatchAction').dispatchAction(ownerId, chartId, payload, settings, generation, revision, sequence);

export const dispatchBoundAction = (
  owner: string,
  chartId: string,
  prepared: PreparedOptionTransport,
  settings: boolean | Record<string, unknown> | null,
  generation?: number | null,
  revision?: number | null,
  sequence?: number | null
) => page().bridged('dispatchBoundAction').dispatchBoundAction(owner, chartId, prepared, settings, generation, revision, sequence);

export const invokeMethod = (
  ownerId: string,
  chartId: string,
  method: string,
  args: unknown[],
  generation?: number | null,
  revision?: number | null,
  sequence?: number | null
) => page().bridged('invokeMethod').invokeMethod(ownerId, chartId, method, args, generation, revision, sequence);

export const releaseResult = (ownerId: string, leaseId: string) => page().bridged('releaseResult').releaseResult(ownerId, leaseId);

export const exportChart = (owner: string, id: string, operation: string, method: string, args: PreparedOptionTransport, timeout: number) =>
  page().bridged('exportChart').exportChart(owner, id, operation, method, args, timeout);

export const cancelExport = (owner: string, operation: string) => page().bridged('cancelExport').cancelExport(owner, operation);

/** Extension contract: begin synchronously inside the render/layout command, settle exactly once. */
export const stabilityParticipant = (native: ChartObject) => page().stabilityParticipant(native);

/** Same as stabilityParticipant, but null for a chart that the bridge does not own (for example from getECharts().init). */
export const tryStabilityParticipant = (native: ChartObject) => page().tryStabilityParticipant(native);

export const createNative = (owner: string, kind: string, options: Record<string, unknown>, prepared: PreparedOptionTransport) =>
  page().bridged('createNative').createNative(owner, kind, options, prepared);

export const invokeNative = (owner: string, path: string, construct: boolean, prepared: PreparedOptionTransport) =>
  page().bridged('invokeNative').invokeNative(owner, path, construct, prepared);

export const getECharts = () => page().getECharts();
export const referenceStatistics = () => page().referenceStatistics();
export const resourceStatistics = () => page().resourceStatistics();

export const invokeGlobalMethod = (owner: string, method: string, args: unknown[], omitted: number[] = [], numbers: number[] = []) =>
  page().bridged('invokeGlobalMethod').invokeGlobal(owner, method, args.map((value, index) => omitted.includes(index) ? undefined : value), numbers);

export const connect = (owner: string, value: string | string[]) => page().bridged('connect').connect(owner, value);
export const disconnect = (owner: string, group: string) => page().bridged('disconnect').disconnect(owner, group);

export const findInstance = (owner: string, kind: 'id' | 'dom', value: string | HTMLElement) =>
  page().bridged('findInstance').findInstance(owner, kind, value);

export const groupSnapshot = (owner: string, group: string) => page().bridged('groupSnapshot').groupSnapshot(owner, group);
