import { afterEach, describe, expect, it, vi } from 'vitest';
import * as loader from '../../../src/BlazorECharts/JavaScript/runtime-loader.ts';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';
import { pageRuntimeKey as key, runtimeProtocol } from '../../../src/BlazorECharts/JavaScript/runtime-protocol.ts';

const base = 'https://example.test/charts-test/';

function runtime() {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const applied: unknown[] = [];
  const chart = {
    setOption(option: unknown) {
      applied.push(option);
    },
    dispose() {},
    isDisposed: () => false,
    on(name: string, listener: (payload?: unknown) => void) {
      listeners.set(name, listener);
    },
    off(name: string) {
      listeners.delete(name);
    },
  };
  return {
    native: {
      version: '6.1.0',
      use() {},
      dispose() {},
      registerMap() {},
      registerTheme() {},
      registerLocale() {},
      connect() {},
      disconnect() {},
      getInstanceById() {},
      getInstanceByDom() {},
      graphic: {},
      init: () => chart,
    },
    emit: (name: string) => listeners.get(name)?.({ type: name }),
    applied,
  };
}

function install() {
  const fake = runtime();
  const page = new PageRuntime(async () => fake.native, base, `${base}_content/BlazorECharts/js/echarts-6.1.0.js`);
  (globalThis as unknown as Record<symbol, unknown>)[key] = page;
  return fake;
}

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[key];
  vi.unstubAllGlobals();
});

describe('resource statistics', () => {
  it('ResourceStatistics_CountsBridgeCallsInBothDirections', async () => {
    // Arrange
    const fake = install();
    const deliver = vi.fn(async () => {});
    await loader.openFacade(runtimeProtocol, 'a', {}, []);
    const id = loader.createChart('a', {} as HTMLElement, null, {})!;

    // Act
    loader.setOption('a', id, new TextEncoder().encode('{"series":[],"title":{"text":"Å"}}'), null, {});

    // Assert
    expect(fake.applied).toEqual([{ series: [], title: { text: 'Å' } }]);

    // Act
    loader.subscribe('a', id, 's1', 'finished', null, { invokeMethodAsync: deliver });
    fake.emit('finished');
    fake.emit('finished');

    // Assert
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));

    // Act
    const statistics = loader.resourceStatistics();

    // Assert
    expect(statistics.toBrowser).toEqual({ openFacade: 1, createChart: 1, setOption: 1, subscribe: 1 });
    expect(statistics.toDotNet).toEqual({ Deliver: 2 });
    expect(statistics).toMatchObject({
      facades: 1,
      charts: 1,
      observations: 0,
      subscriptions: 1,
      exports: 0,
      results: 0,
      references: 0,
      leases: 0,
      groupMembers: 1,
    });
  });

  it('ResourceStatistics_ReturnToZeroAfterChartAndFacadeRelease', async () => {
    // Arrange
    install();
    await loader.openFacade(runtimeProtocol, 'a', {}, []);
    const id = loader.createChart('a', {} as HTMLElement, null, {})!;
    loader.subscribe('a', id, 's1', 'click', null, { invokeMethodAsync: async () => {} });

    // Act
    loader.disposeChart('a', id);

    // Assert
    expect(loader.resourceStatistics()).toMatchObject({ facades: 1, charts: 0, subscriptions: 0, groupMembers: 0 });

    // Act
    loader.releaseFacade('a');

    // Assert
    expect(loader.resourceStatistics()).toMatchObject({
      facades: 0,
      charts: 0,
      observations: 0,
      subscriptions: 0,
      exports: 0,
      results: 0,
      references: 0,
      leases: 0,
      groupMembers: 0,
    });
  });

  it('ResourceStatistics_ReadingDoesNotCountAsBridgeTraffic', async () => {
    // Arrange
    install();

    // Act
    loader.resourceStatistics();
    loader.resourceStatistics();

    // Assert
    expect(loader.resourceStatistics().toBrowser).toEqual({});
  });
});
