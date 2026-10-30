import { afterEach, describe, expect, it } from 'vitest';
import * as loader from '../../../src/BlazorECharts/JavaScript/runtime-loader.ts';
import * as stable from '../../../src/BlazorECharts/JavaScript/blazor-echarts.ts';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';
import { pageRuntimeKey, runtimeProtocol } from '../../../src/BlazorECharts/JavaScript/runtime-protocol.ts';

const base = 'https://example.test/charts-test/';
const globals = globalThis as unknown as Record<symbol, unknown>;

function install() {
  const chart = { setOption() {}, dispose() {}, isDisposed: () => false, on() {}, off() {} };
  const native = {
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
  };
  globals[pageRuntimeKey] = new PageRuntime(async () => native, base, `${base}_content/BlazorECharts/js/echarts-6.1.0.js`);
  return { native, chart };
}

afterEach(() => { delete globals[pageRuntimeKey]; });

describe('runtime protocol', () => {
  it('PageRuntimeKey_NamesTheProtocol', () => {
    // Act & Assert
    expect(pageRuntimeKey).toBe(Symbol.for(`BlazorECharts.page-runtime.v${runtimeProtocol}`));
  });

  it('OpenFacade_OfAnotherProtocol_FailsWithRuntimeVersionMismatch_AndAdvisesAReload', async () => {
    // Arrange
    install();

    // Act & Assert
    await expect(loader.openFacade(runtimeProtocol + 1, 'a', {}, [])).rejects.toMatchObject({
      code: 'RuntimeVersionMismatch',
      message: /Reload the page/,
    });

    // A caller from before the handshake sends the owner first.
    await expect((loader.openFacade as (...args: unknown[]) => Promise<string>)('a', {}, [])).rejects.toMatchObject({
      code: 'RuntimeVersionMismatch',
    });
    expect(loader.resourceStatistics().facades).toBe(0);
    await expect(loader.openFacade(runtimeProtocol, 'a', {}, [])).resolves.toBeTypeOf('string');
  });

  it('StableModule_ReadsThePageRuntimeOfItsProtocol', async () => {
    // Act & Assert
    expect(() => stable.getECharts()).toThrow(/Initialize ECharts/);
    expect(stable.tryStabilityParticipant({} as never)).toBeNull();
    expect(() => stable.stabilityParticipant({} as never)).toThrow(/ChartDisposed/);

    // Act
    const { native, chart } = install();
    await loader.openFacade(runtimeProtocol, 'a', {}, []);

    // Assert
    expect(stable.getECharts()).toBe(native);

    // Act
    loader.createChart('a', {} as HTMLElement, null, {});

    // Assert
    expect(stable.tryStabilityParticipant(chart as never)).not.toBeNull();
    expect(stable.stabilityParticipant(chart as never)).toHaveProperty('begin');
  });
});
