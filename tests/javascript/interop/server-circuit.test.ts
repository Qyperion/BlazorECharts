import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';

function fixture(option: () => unknown = () => ({})) {
  const natives: any[] = [];
  const maps = new Map<string, unknown>();
  const runtime = {
    version: '6.1.0',
    graphic: {},
    use() {},
    dispose() {},
    registerTheme() {},
    registerLocale() {},
    connect() {},
    disconnect() {},
    getInstanceById() {},
    getInstanceByDom() {},
    util: { clone: (value: unknown) => structuredClone(value) },
    registerMap(name: string, geoJson: unknown) {
      maps.set(name, geoJson);
    },
    getMap(name: string) {
      const geoJson = maps.get(name);
      return geoJson ? { geoJson, geoJSON: geoJson, specialAreas: {} } : undefined;
    },
    init(dom?: unknown) {
      const listeners = new Map<string, Set<(...args: any[]) => unknown>>();
      const native = {
        listeners,
        on(name: string, query: any, callback?: any) {
          const handler = callback ?? query;
          if (!listeners.has(name))
            listeners.set(name, new Set());

          listeners.get(name)!.add(handler);
        },
        off(name: string, handler: any) {
          listeners.get(name)?.delete(handler);
        },
        emit(name: string, data?: unknown) {
          for (const handler of listeners.get(name) ?? [])
            handler(data);
        },
        setOption() {},
        getOption: option,
        getWidth: () => 640,
        getDom: () => dom,
        dispose() {},
      };
      natives.push(native);
      return native;
    },
  };
  const page = new PageRuntime(async () => runtime, 'https://example.test/', 'https://example.test/ec.js');
  return { page, natives, maps };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const element = () => Object.assign(new EventTarget(), { isConnected: true, clientWidth: 600, clientHeight: 300 }) as unknown as HTMLElement;

afterEach(() => vi.unstubAllGlobals());

describe('Interactive Server circuit', () => {
  it('ResultOverTheServerLimit_IsASmallResultTooLargeError', async () => {
    // Arrange
    const big = { series: [{ type: 'line', data: Array.from({ length: 5_000 }, (_, i) => [i, i]) }], formatter: () => 'x' };
    const { page } = fixture(() => big);
    await page.openFacade('server', {}, [], false, true, 32 * 1024);
    const id = page.createChart('server', element(), null, {})!;

    // Act & Assert
    expect(() => page.invokeMethod('server', id, 'getOption', [])).toThrow(/^\[ResultTooLarge\] .*getOption.*32768.*MaximumReceiveMessageSize/);
    expect(page.referenceStatistics()).toMatchObject({ entries: 0, results: 0 });
    expect(page.invokeMethod('server', id, 'getWidth', [])).toEqual({ value: 640, bindings: [], leaseId: null });
  });

  it('NativeResultOverTheServerLimit_IsASmallResultTooLargeError', async () => {
    // Arrange
    const big = Array.from({ length: 5_000 }, (_, i) => [i, i]);
    const { page } = fixture();
    await page.openFacade('server', {}, [], false, true, 32 * 1024);

    // Act & Assert
    await expect(page.invokeNative('server', 'util.clone', false, { json: { args: [big] }, bindings: [] }))
      .rejects.toThrow(/^\[ResultTooLarge\] .*util\.clone.*32768/);
    expect(page.referenceStatistics()).toMatchObject({ results: 0 });
    expect(await page.invokeNative('server', 'util.clone', false, { json: { args: [[1, 2]] }, bindings: [] })).toMatchObject({ value: [1, 2] });
  });

  it('ResultWithoutALimit_IsReturned', async () => {
    // Arrange
    const big = { series: [{ type: 'line', data: Array.from({ length: 5_000 }, (_, i) => [i, i]) }] };
    const { page } = fixture(() => big);
    await page.openFacade('wasm');

    // Act
    const id = page.createChart('wasm', element(), null, {})!;

    // Assert
    expect((page.invokeMethod('wasm', id, 'getOption', []) as { value: unknown }).value).toEqual(big);
  });

  it('GetMap_ReturnsTheGeoJsonOnce', async () => {
    // Arrange
    const { page } = fixture();
    await page.openFacade('a');
    const geoJson = { type: 'FeatureCollection', features: [] };

    // Act
    page.invokeGlobal('a', 'registerMap', ['m', geoJson]);

    // Assert
    expect(page.invokeGlobal('a', 'getMap', ['m'])).toEqual({ geoJSON: geoJson, specialAreas: {} });
  });

  it('EventsDuringAnOutage_AreNotSentAndReportOneDisconnection', async () => {
    // Arrange
    vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { children: [] } }));
    const { page, natives } = fixture();
    await page.openFacade('server', {}, [], false, true, null);
    const target = element();
    const codes: string[] = [];
    target.addEventListener('blazorecharts:error', event => codes.push((event as CustomEvent<{ code: string }>).detail.code));
    const id = page.createChart('server', target, null, {})!;
    const deliver = vi.fn(async () => {});
    page.subscribe('server', id, 's', 'rendered', null, { invokeMethodAsync: deliver });
    const reconnect = (state: string) => document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state } }));
    reconnect('show');
    natives[0].emit('rendered', { image: new (class Native {})() });
    natives[0].emit('rendered', {});

    // Act
    await tick();

    // Assert
    expect(deliver).not.toHaveBeenCalled();
    expect(codes).toEqual(['CircuitDisconnected']);

    // Act
    reconnect('hide');
    natives[0].emit('rendered', {});
    await tick();

    // Assert
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('EventOverTheServerLimit_IsNotSentAndRaisesEventTooLarge', async () => {
    // Arrange
    vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { children: [] } }));
    const { page, natives } = fixture();
    await page.openFacade('server', {}, [], false, true, 32 * 1024);
    const target = element();
    const details: Record<string, unknown>[] = [];
    target.addEventListener('blazorecharts:error', event => details.push((event as CustomEvent).detail));
    const id = page.createChart('server', target, null, {})!;
    const deliver = vi.fn(async () => {});
    page.subscribe('server', id, 's', 'brushselected', null, { invokeMethodAsync: deliver });
    const selected = Array.from({ length: 7_000 }, (_, i) => i);
    natives[0].emit('brushselected', { batch: [{ selected: [{ seriesIndex: 0, dataIndex: selected }] }], native: new (class Native {})() });

    // Act
    await tick();

    // Assert
    expect(deliver).not.toHaveBeenCalled();
    expect(details).toEqual([
      expect.objectContaining({ code: 'EventTooLarge', operation: 'event:brushselected', subscriptionId: 's', upstreamVersion: '6.1.0' }),
    ]);
    expect(details[0].message).toMatch(/^brushselected .*about \d+ bytes.*32768.*MaximumServerResultSize/);
    expect(page.resourceStatistics()).toMatchObject({ deliveries: 0, eventLeases: 0 });

    // Act
    natives[0].emit('brushselected', { batch: [{ selected: [{ seriesIndex: 0, dataIndex: [1, 2] }] }] });
    await tick();

    // Assert
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('EventWithoutALimit_IsSent', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('wasm');
    const id = page.createChart('wasm', element(), null, {})!;
    const deliver = vi.fn(async () => {});
    page.subscribe('wasm', id, 's', 'brushselected', null, { invokeMethodAsync: deliver });
    natives[0].emit('brushselected', { batch: [{ selected: [{ seriesIndex: 0, dataIndex: Array.from({ length: 7_000 }, (_, i) => i) }] }] });

    // Act
    await tick();

    // Assert
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('DeliveriesPendingWhenAnOutageIsDetected_ReleaseTheirReferences', async () => {
    // Arrange
    vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { children: [] } }));
    const { page, natives } = fixture();
    await page.openFacade('server', {}, [], false, true, null);
    const id = page.createChart('server', element(), null, {})!;

    // The socket is dead but SignalR has not noticed yet: these sends never get a reply.
    page.subscribe('server', id, 'move', 'mousemove', null, { invokeMethodAsync: () => new Promise(() => {}) });

    class ZrEvent {
      constructor(readonly offsetX: number) {}
    }

    for (let i = 0; i < 1_800; i++)
      natives[0].emit('mousemove', { componentType: 'series', dataIndex: i, event: new ZrEvent(i) });

    // Act
    await tick();

    // Assert
    expect(page.resourceStatistics()).toMatchObject({ deliveries: 1_800, eventLeases: 1_800 });

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'show' } }));
    await tick();

    // Assert
    expect(page.resourceStatistics()).toMatchObject({ deliveries: 0, eventLeases: 0 });
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
  });

  it('DeliveriesPendingWhenTheFallbackOverlayShows_ReleaseOnTheNextEvent', async () => {
    // Arrange
    const overlay = { shadowRoot: { querySelector: () => null as unknown } };
    vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { children: [overlay] } }));
    const { page, natives } = fixture();
    await page.openFacade('server', {}, [], false, true, null);
    const id = page.createChart('server', element(), null, {})!;
    page.subscribe('server', id, 'move', 'mousemove', null, { invokeMethodAsync: () => new Promise(() => {}) });

    class ZrEvent {}

    for (let i = 0; i < 10; i++)
      natives[0].emit('mousemove', { event: new ZrEvent() });

    // Act
    await tick();

    // Assert
    expect(page.resourceStatistics()).toMatchObject({ deliveries: 10, eventLeases: 10 });

    // Act
    overlay.shadowRoot.querySelector = () => ({});
    natives[0].emit('mousemove', { event: new ZrEvent() });
    await tick();

    // Assert
    expect(page.resourceStatistics()).toMatchObject({ deliveries: 0, eventLeases: 0 });
  });

  it('InvokeGlobalOnAReleasedFacade_FailsBeforeChangingThePage', async () => {
    // Arrange
    const { page, maps } = fixture();
    await page.openFacade('a');
    page.releaseFacade('a');

    // Act & Assert
    expect(() => page.invokeGlobal('a', 'registerMap', ['m', { type: 'FeatureCollection', features: [] }])).toThrow(/FacadeDisposed/);
    expect(maps.size).toBe(0);
  });

  it('ReleaseResult_OnlyByItsOwner_AndReleaseFacadeReleasesItsResults', async () => {
    // Arrange
    const { page } = fixture();
    await page.openFacade('a');
    await page.openFacade('b');
    const target = element();
    const chart = page.createChart('a', target, null, {})!;

    // Act
    const result = page.invokeMethod('a', chart, 'getDom', []) as { leaseId: string };

    // Assert
    expect(result.leaseId).toMatch(/^result:/);
    expect(page.referenceStatistics()).toMatchObject({ results: 1, leases: 1 });

    // Act
    await page.releaseResult('b', result.leaseId);

    // Assert
    expect(page.referenceStatistics()).toMatchObject({ results: 1, leases: 1 });

    // Act
    await page.releaseResult('a', result.leaseId);

    // Assert
    expect(page.referenceStatistics()).toMatchObject({ results: 0, leases: 0 });

    // Act
    const retained = page.invokeMethod('a', chart, 'getDom', []) as { leaseId: string };

    // Assert
    expect(retained.leaseId).toMatch(/^result:/);

    // Act
    page.releaseFacade('a');
    await tick();

    // Assert
    expect(page.referenceStatistics()).toMatchObject({ results: 0, entries: 0, leases: 0 });
  });

  it('AFailingDotNetHandlerOnServer_IsEventHandlerFailed', async () => {
    // Arrange
    vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { children: [] } }));
    const { page, natives } = fixture();
    await page.openFacade('server', {}, [], false, true, null);
    const target = element();
    const codes: string[] = [];
    target.addEventListener('blazorecharts:error', event => codes.push((event as CustomEvent<{ code: string }>).detail.code));
    const id = page.createChart('server', target, null, {})!;
    page.subscribe('server', id, 's', 'rendered', null, {
      invokeMethodAsync: async () => {
        throw new Error("There was an exception invoking 'Deliver'. For more details turn on detailed exceptions in 'CircuitOptions.DetailedErrors'");
      },
    });
    natives[0].emit('rendered', {});

    // Act
    await tick();

    // Assert
    expect(codes).toEqual(['EventHandlerFailed']);
  });
});
