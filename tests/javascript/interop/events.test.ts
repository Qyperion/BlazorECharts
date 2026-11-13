import { describe, expect, it } from 'vitest';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';

function fixture() {
  const natives: any[] = [];
  const runtime = {
    version: '6.1.0',
    graphic: {},
    use() {},
    dispose() {},
    registerMap() {},
    registerTheme() {},
    registerLocale() {},
    connect() {},
    disconnect() {},
    getInstanceById() {},
    getInstanceByDom() {},
    init() {
      const listeners = new Map<string, Set<(...args: any[]) => unknown>>();
      const zrListeners = new Map<string, Set<(...args: any[]) => unknown>>();
      const zr = {
        listeners: zrListeners,
        on(name: string, handler: any) {
          if (!zrListeners.has(name))
            zrListeners.set(name, new Set());

          zrListeners.get(name)!.add(handler);
        },
        off(name: string, handler: any) {
          zrListeners.get(name)?.delete(handler);
        },
        emit(name: string, data?: unknown) {
          for (const handler of zrListeners.get(name) ?? [])
            handler(data);
        },
      };
      const native = {
        listeners,
        zr,
        getZr: () => zr,
        options: {},
        disposed: false,
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
        dispatchAction(value: any) {
          this.emit(value.type.toLowerCase(), value);
        },
        setOption(value: any) {
          this.options = value;
        },
        getOption() {
          return this.options;
        },
        dispose() {
          this.disposed = true;
        },
      };
      natives.push(native);
      return native;
    },
  };
  const modules: Record<string, unknown> = {};
  const page = new PageRuntime(async url => modules[url] ?? runtime, 'https://example.test/', 'https://example.test/ec.js');
  return { page, natives, modules };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('event subscriptions', () => {
  it('BrowserHandler_ReceivesTheNativeEventAndChart_WithoutADelivery', async () => {
    // Arrange
    const { page, natives, modules } = fixture();
    const seen: unknown[] = [];
    modules['https://example.test/js/handlers.js'] = {
      select(event: { name: string }, chart: unknown) {
        seen.push([event.name, chart === natives[0]]);
        if (event.name === 'broken')
          throw Error('handler failed');
      },
    };
    await page.openFacade('a');
    const errors: string[] = [];
    const element = { dispatchEvent: (event: { detail: { code: string } }) => errors.push(event.detail.code) } as unknown as HTMLElement;
    const id = page.createChart('a', element, null, {})!;
    const binding = { path: ['handler'], kind: 'module', token: 'handler', signature: 'runtime:chart-event-handler', moduleUrl: 'js/handlers.js' } as const;

    // Act
    await page.subscribeBrowser('a', id, 'one', 'click', null, { ...binding, exportName: 'select' });
    await page.subscribeBrowser('a', id, 'limited', 'click', null, { ...binding, exportName: 'select' }, 10_000);
    natives[0].emit('click', { name: 'A' });
    natives[0].emit('click', { name: 'broken' });
    page.unsubscribe('a', id, 'one');
    natives[0].emit('click', { name: 'C' });

    // Assert: the throttled subscription takes only the first event; a failure reaches the error event, not the dispatch.
    expect(seen).toEqual([['A', true], ['A', true], ['broken', true]]);
    expect(errors).toEqual(['EventHandlerFailed']);
    expect(page.resourceStatistics().toDotNet).toEqual({});
    await expect(page.subscribeBrowser('a', id, 'missing', 'click', null, { ...binding, exportName: 'absent' })).rejects.toThrow(/Export must be a browser function/);
  });

  it('CustomEvent_PreservesSerializableRootEventField', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    const calls: any[] = [];
    page.subscribe('a', id, 'custom', 'business', null, { invokeMethodAsync: async (...args: any[]) => { calls.push(args); } });
    natives[0].emit('business', { event: { category: 'sale' } });

    // Act
    await tick();

    // Assert
    expect(calls[0][3]).toEqual({ event: { category: 'sale' } });
    expect(calls[0][4]).toEqual([]);
  });

  it('HighFrequency_ThrottlingIsExplicitOptIn', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    let normal = 0;
    let throttled = 0;
    page.subscribe('a', id, 'normal', 'mousemove', null, { invokeMethodAsync: async () => { normal++; } });
    page.subscribe('a', id, 'limited', 'mousemove', null, { invokeMethodAsync: async () => { throttled++; } }, 10_000);
    for (let i = 0; i < 10; i++)
      natives[0].emit('mousemove', { value: i });

    // Act
    await tick();

    // Assert
    expect(normal).toBe(10);
    expect(throttled).toBe(1);
  });

  it('EventPayload_PreservesKnownAndUnknownFields_without_serializing_native_event', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    const calls: any[] = [];
    page.subscribe('a', id, 'one', 'datazoom', null, { invokeMethodAsync: async (...args: any[]) => { calls.push(args); } });
    const event: any = {
      type: 'datazoom',
      start: 0,
      end: 99,
      batch: [{ start: 5 }],
      extra: { flag: false, empty: [], event: { values: [0, false] } },
    };
    event.event = event;
    natives[0].emit('datazoom', event);

    // Act
    await tick();

    // Assert
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toMatchObject({ start: 0, end: 99, batch: [{ start: 5 }], extra: { flag: false, empty: [], event: { values: [0, false] } } });
    expect(calls[0][4]).toHaveLength(1);
    expect(calls[0][4][0]).toMatchObject({ path: ['event'], reference: { runtimeId: page.id } });
  });

  it('DisposedGeneration_CannotDeliverEvent_and_rebinds_once', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    let count = 0;
    const callback = { invokeMethodAsync: async () => { count++; } };
    page.subscribe('a', id, 'one', 'click', null, callback);
    const old = [...natives[0].listeners.get('click')][0] as any;
    page.recreateChart('a', id, {}, null);
    old({});
    natives[1].emit('click', {});

    // Act
    await tick();

    // Assert
    expect(count).toBe(1);
    expect(natives[0].listeners.get('click').size).toBe(0);

    // Act
    page.subscribe('a', id, 'two', 'click', null, callback);
    page.unsubscribe('a', id, 'one');
    natives[1].emit('click', {});
    await tick();

    // Assert
    expect(count).toBe(2);

    // Act
    page.disposeChart('a', id);
    natives[1].emit('click', {});
    await tick();

    // Assert
    expect(count).toBe(2);
    expect(natives[1].listeners.get('click').size).toBe(0);
  });

  it('ZrEvent_ListensOnZRenderAndSendsOnlyThePointerFields', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    const calls: any[] = [];
    page.subscribe('a', id, 'zr', 'zr:click', null, { invokeMethodAsync: async (...args: any[]) => { calls.push(args); } });
    const element = new (class Rect {})();
    natives[0].zr.emit('click', {
      type: 'click',
      offsetX: 120.5,
      offsetY: 40,
      wheelDelta: 0,
      zrByTouch: false,
      target: element,
      topTarget: element,
      event: { button: 2, ctrlKey: true, shiftKey: false, altKey: false, metaKey: true },
      stop() {},
    });

    // Act
    await tick();

    // Assert
    expect(natives[0].listeners.get('click')).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0][3]).toEqual({
      type: 'click', offsetX: 120.5, offsetY: 40, button: 2, ctrlKey: true, shiftKey: false, altKey: false, metaKey: true,
      wheelDelta: 0, byTouch: false, hasTarget: true,
    });
    expect(calls[0][4]).toEqual([]);

    // Act
    natives[0].zr.emit('click', { type: 'click', offsetX: 1, offsetY: 2, zrByTouch: true, event: {} });
    await tick();

    // Assert
    expect(calls[1][3]).toMatchObject({ button: null, ctrlKey: false, byTouch: true, hasTarget: false });
  });

  it('ZrEvent_RebindsOnTheNewZRenderAfterRecreateAndUnbindsOnDispose', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    let count = 0;
    page.subscribe('a', id, 'down', 'zr:mousedown', null, { invokeMethodAsync: async () => { count++; } }, 5);
    const old = [...natives[0].zr.listeners.get('mousedown')][0] as any;

    // Act
    page.recreateChart('a', id, {}, null);
    old({ type: 'mousedown', offsetX: 0, offsetY: 0 });
    natives[1].zr.emit('mousedown', { type: 'mousedown', offsetX: 0, offsetY: 0 });
    await tick();

    // Assert
    expect(count).toBe(1);
    expect(natives[0].zr.listeners.get('mousedown').size).toBe(0);
    expect(natives[1].zr.listeners.get('mousedown').size).toBe(1);

    // Act
    page.disposeChart('a', id);

    // Assert
    expect(natives[1].zr.listeners.get('mousedown').size).toBe(0);
  });

  it('ZrEvent_RejectsAQueryAndAnUnsupportedName', async () => {
    // Arrange
    const { page } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    const callback = { invokeMethodAsync: async () => {} };

    // Act & Assert
    expect(() => page.subscribe('a', id, 'query', 'zr:click', { seriesIndex: 0 }, callback)).toThrow('ZRender events take no query.');
    expect(() => page.subscribe('a', id, 'drag', 'zr:drag', null, callback)).toThrow('zr:drag is not a supported ZRender event.');
  });

  it('EventHandler_FaultReachesErrorChannel_without_unhandled_rejection', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const errors: any[] = [];
    const element = {
      dispatchEvent: (e: any) => {
        errors.push(e.detail);
        return true;
      },
    } as HTMLElement;
    const id = page.createChart('a', element, null, {})!;
    page.subscribe('a', id, 'one', 'click', null, { invokeMethodAsync: async () => { throw new Error('handler failed'); } });
    natives[0].emit('click', {});

    // Act
    await tick();

    // Assert
    expect(errors).toEqual([expect.objectContaining({ code: 'EventHandlerFailed', subscriptionId: 'one' })]);
  });

  it('GradientColor_FromACallback_IsSerializedAsJson', async () => {
    // Arrange
    const { page, natives } = fixture();
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {})!;
    const calls: any[] = [];
    page.subscribe('a', id, 'click', 'click', null, { invokeMethodAsync: async (...args: any[]) => { calls.push(args); } });

    // The shape of echarts.graphic.LinearGradient and RadialGradient: class instances with a type and color stops.
    class LinearGradient {
      type = 'linear';
      global = false;

      constructor(public x: number, public y: number, public x2: number, public y2: number, public colorStops: unknown[]) {}
    }

    class Pattern {
      type = 'pattern';

      constructor(public image: unknown) {}
    }

    const linear = new LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'red' }, { offset: 1, color: 'blue' }]);
    natives[0].emit('click', { color: linear, borderColor: new Pattern({}) });

    // Act
    await tick();

    // Assert
    expect(calls[0][3].color).toEqual({
      type: 'linear',
      global: false,
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [{ offset: 0, color: 'red' }, { offset: 1, color: 'blue' }],
    });
    expect(calls[0][3].borderColor).toBeNull();
    expect(calls[0][4].map((r: any) => r.path)).toEqual([['borderColor']]);
  });
});
