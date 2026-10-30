import { describe, expect, it, vi } from 'vitest';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';
import { retryingModuleImporter, validateRuntime } from '../../../src/BlazorECharts/JavaScript/runtime-provider.ts';

function runtime() {
  const charts: { disposed: boolean; options?: unknown }[] = [];
  return {
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
    init() {
      const state = { disposed: false, options: undefined as unknown };
      charts.push(state);
      return {
        setOption(value: unknown) {
          state.options = value;
        },
        dispose() {
          state.disposed = true;
        },
      };
    },
    charts,
  };
}

const base = 'https://example.test/charts-test/';
const local = `${base}_content/BlazorECharts/js/echarts-6.1.0.js`;

describe('page runtime', () => {
  it('Loader_TwentyConcurrentRequests_LoadOnce', async () => {
    // Arrange
    const native = runtime();
    const importer = vi.fn(async () => native);
    const page = new PageRuntime(importer, base, local);

    // Act
    const loaded = await Promise.all(Array.from({ length: 20 }, () => page.load()));

    // Assert
    expect(new Set(loaded)).toEqual(new Set([native]));
    expect(importer).toHaveBeenCalledExactlyOnceWith(local);
    expect(loaded[0].version).toBe('6.1.0');
  });

  it('Loader_FailedLoad_ExplicitRetryCanSucceed', async () => {
    // Arrange
    let available = false;
    const importer = vi.fn(async () => {
      if (!available)
        throw new Error('offline');

      return runtime();
    });
    const page = new PageRuntime(importer, base, local);

    // Act & Assert
    await expect(page.load()).rejects.toMatchObject({ code: 'RuntimeLoadFailed' });

    // Arrange
    available = true;

    // Act & Assert
    await expect(page.load()).rejects.toMatchObject({ code: 'RuntimeLoadFailed' });
    expect(importer).toHaveBeenCalledTimes(1);
    await expect(page.load({}, true)).resolves.toHaveProperty('version', '6.1.0');
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('Importer_RetryAfterFailure_ChangesOnlySameOriginUrls', async () => {
    // Arrange
    const importer = vi.fn(async (_url: string) => { throw new Error('integrity'); });
    const retrying = retryingModuleImporter(importer, base);
    const remote = 'https://cdn.example.test/format.js';
    const own = `${base}format.js`;

    // Act & Assert
    for (let i = 0; i < 2; i++) {
      await expect(retrying(remote)).rejects.toThrow('integrity');
      await expect(retrying(own)).rejects.toThrow('integrity');
    }

    expect(importer.mock.calls.map(([url]) => url)).toEqual([remote, own, remote, `${own}?__blazorecharts_retry=1`]);
  });

  it('ModuleFunction_CrossOriginImportFails_NextUpdateKeepsIntegrityUrl', async () => {
    // Arrange
    const native = runtime();
    const urls: string[] = [];
    const page = new PageRuntime(
      async url => {
        if (url === local)
          return native;

        urls.push(url);
        throw new Error('integrity');
      },
      base,
      local
    );
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {});
    const prepared = () => ({
      json: { formatter: null },
      bindings: [
        {
          kind: 'module' as const,
          path: ['formatter'],
          token: 'binding:1',
          signature: 'formatter',
          moduleUrl: 'https://cdn.example.test/format.js',
          exportName: 'format',
        },
      ],
    });

    // Act & Assert
    await expect(page.setOption('a', id, prepared(), {})).rejects.toThrow(/integrity/);
    await expect(page.setOption('a', id, prepared(), {})).rejects.toThrow(/integrity/);
    expect(urls).toEqual(['https://cdn.example.test/format.js', 'https://cdn.example.test/format.js']);
  });

  it('Provider_ConflictingPageConfiguration_Rejects', async () => {
    // Arrange
    const page = new PageRuntime(async () => runtime(), base, local);
    await page.load();

    // Act & Assert
    await expect(page.load({ provider: 'module', moduleUrl: './other.js' })).rejects.toMatchObject({ code: 'RuntimeConfigurationConflict' });
    await expect(page.load({ version: '6.0.0' })).rejects.toMatchObject({ code: 'RuntimeConfigurationConflict' });
  });

  it('Provider_NormalizedUrlsShareIdentity_AndCustomLoadIsValidated', async () => {
    // Arrange
    const native = runtime();
    const load = vi.fn(async () => native);

    // Act
    const page = new PageRuntime(async () => ({ load }), base, local);

    // Assert
    expect(await page.load({ provider: 'custom', moduleUrl: './provider.js' })).toBe(native);
    expect(await page.load({ provider: 'custom', moduleUrl: `${base}provider.js` })).toBe(native);
    expect(load).toHaveBeenCalledTimes(1);

    // Act & Assert
    expect(() => validateRuntime({ ...native, version: '5.0.0' }, '6.1.0')).toThrow(/version/i);
    expect(() => validateRuntime({ ...native, init: undefined }, '6.1.0')).toThrow(/init/);
    expect(() => validateRuntime({ ...native, registerMap: undefined }, '6.1.0')).toThrow(/registerMap/);
  });

  it('FacadeDisposal_DoesNotInvalidateOtherFacade', async () => {
    // Arrange
    const native = runtime();
    const page = new PageRuntime(async () => native, base, local);
    await Promise.all([page.openFacade('a'), page.openFacade('b')]);
    const a = page.createChart('a', {} as HTMLElement, null, {});
    const b = page.createChart('b', {} as HTMLElement, null, {});
    page.releaseFacade('a');

    // Act
    page.setOption('b', b, { json: { series: [] }, bindings: [] }, {});

    // Assert
    expect(native.charts.map(c => c.disposed)).toEqual([true, false]);
    expect(native.charts[1].options).toEqual({ series: [] });

    // Act & Assert
    expect(() => page.setOption('b', a, { json: {}, bindings: [] }, {})).toThrow();

    // Act
    page.releaseFacade('b');

    // Assert
    expect(native.charts[1].disposed).toBe(true);
    expect(await page.load()).toBe(native);
  });

  it('DisposalDuringImport_PreventsLateHandleCreation', async () => {
    // Arrange
    const pending = Promise.withResolvers<ReturnType<typeof runtime>>();
    const native = runtime();
    const page = new PageRuntime(() => pending.promise, base, local);
    const opening = page.openFacade('a');
    page.releaseFacade('a');
    pending.resolve(native);

    // Act & Assert
    await expect(opening).rejects.toMatchObject({ code: 'FacadeDisposed' });
    expect(() => page.createChart('a', {} as HTMLElement, null, {})).toThrow();
    expect(native.charts).toHaveLength(0);
  });

  it('Instance_RejectsDisposedHandleAndMissingCallbackExport', async () => {
    // Arrange
    const native = runtime();
    const page = new PageRuntime(async () => native, base, local);
    await page.openFacade('a');
    const id = page.createChart('a', {} as HTMLElement, null, {});

    // Act & Assert
    await expect(page.setOption(
      'a',
      id,
      {
        json: { formatter: null },
        bindings: [
          {
            kind: 'module',
            path: ['formatter'],
            token: 'binding:1',
            signature: 'formatter',
            moduleUrl: './formatter.js',
            exportName: 'format',
          },
        ],
      },
      {}
    )).rejects.toThrow(/formatter.*formatter.js.*format/);
    expect(native.charts[0].options).toBeUndefined();

    // Arrange
    page.disposeChart('a', id);

    // Act & Assert
    expect(() => page.setOption('a', id, { json: {}, bindings: [] }, {})).toThrow();
  });
});
