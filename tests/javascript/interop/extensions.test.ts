import { expect, it } from 'vitest';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';
import { ExtensionRegistry } from '../../../src/BlazorECharts/JavaScript/extension-registry.ts';
import * as echarts from '../../../src/BlazorECharts/wwwroot/js/echarts-6.1.0.js';

const base = 'https://example.test/';

// Undocumented helpers are not managed API: the typed global channel rejects them, the native bridge calls them.
it('UndocumentedHelpers_UseTheNativeBridgeOnly', async () => {
  // Arrange
  const page = new PageRuntime(async () => echarts, base, base + 'runtime.js');
  await page.openFacade('a');

  // Act & Assert
  expect(() => page.invokeGlobal('a', 'number.round', [1.234, 2])).toThrow();

  // Act
  const value = (envelope: unknown) => (envelope as { value: unknown }).value;

  // Assert
  expect(value(await page.invokeNative('a', 'number.round', false, { json: { args: [1.234, 2] }, bindings: [] }))).toBe(1.23);
  expect(value(await page.invokeNative('a', 'vector.add', false, { json: { args: [[0, 0], [1, 2], [3, 4]] }, bindings: [] }))).toEqual([4, 6]);
  expect(value(await page.invokeNative('a', 'zrUtil.slice', false, { json: { args: [[1, 2, 3], 1] }, bindings: [] }))).toEqual([2, 3]);
});

function nativeRuntime() {
  const maps = new Map<string, unknown>();
  const charts: any[] = [];
  return {
    version: '6.1.0',
    graphic: {},
    use() {},
    dispose() {},
    registerTheme() {},
    registerLocale() {},
    registerMap(name: string, value: unknown) {
      maps.set(name, value);
    },
    getMap(name: string) {
      return maps.get(name);
    },
    connect(value: string | any[]) {
      const id = typeof value === 'string' ? value : 'generated';
      if (Array.isArray(value))
        value.forEach(c => c.group = id);

      return id;
    },
    disconnect() {},
    getInstanceByDom(dom: unknown) {
      return charts.find(c => c.dom === dom);
    },
    getInstanceById(id: string) {
      return charts.find(c => c.id === id);
    },
    init(dom: unknown) {
      const c = {
        dom,
        id: `native:${charts.length}`,
        group: '',
        setOption() {},
        getOption() {
          return {};
        },
        dispose() {},
        isDisposed() {
          return false;
        },
      };
      charts.push(c);
      return c;
    },
  };
}

it('MapRoundTrip_PreservesGeoJsonAndSvg', async () => {
  // Arrange
  const page = new PageRuntime(async () => nativeRuntime(), base, base + 'runtime.js');
  await page.openFacade('a');
  const geo = { type: 'FeatureCollection', features: [], unknown: { zero: 0, flag: false } };

  // Act
  page.invokeGlobal('a', 'registerMap', ['geo', geo]);

  // Assert
  expect(page.invokeGlobal('a', 'getMap', ['geo'])).toEqual(geo);
  expect(page.invokeGlobal('a', 'getMap', ['missing'])).toBeNull();

  // Act
  page.invokeGlobal('a', 'registerMap', ['svg', { svg: '<svg/>' }]);

  // Assert
  expect(page.invokeGlobal('a', 'getMap', ['svg'])).toEqual({ svg: '<svg/>' });

  // Act & Assert
  expect(() => page.invokeGlobal('a', '__proto__.constructor', [])).toThrow();
});

it('Groups_TrackConnectDisconnectAndMembers', async () => {
  // Arrange
  const page = new PageRuntime(async () => nativeRuntime(), base, base + 'runtime.js');
  await page.openFacade('a');
  await page.openFacade('b');
  const a = page.createChart('a', {} as HTMLElement, null, {})!;
  const b = page.createChart('b', {} as HTMLElement, null, {})!;
  const changes: number[] = [];
  const stop = page.groups.subscribe(s => changes.push(s.version));
  const version = page.groups.snapshot('external').version;

  // Act
  page.groups.members('')[0].native.group = 'external';

  // Assert
  expect(page.groups.snapshot('external').version).toBeGreaterThan(version);
  expect(page.groups.snapshot('external').members).toEqual([a]);

  // Act
  const group = page.connect('a', [a, b]);

  // Assert
  expect(page.groups.snapshot(group)).toMatchObject({ connected: true, members: [a, b] });

  // Act
  page.recreateChart('b', b, {}, null);

  // Assert
  expect(page.groups.snapshot(group).members).toEqual([a, b]);
  expect(page.invokeMethod('b', b, 'getGroup', [])).toMatchObject({ value: group });

  // Act
  page.disconnect('a', group);

  // Assert
  expect(page.groups.snapshot(group)).toMatchObject({ connected: false, members: [a, b] });

  // Act
  page.releaseFacade('a');

  // Assert
  expect(page.groups.snapshot(group).members).toEqual([b]);

  // Act
  page.invokeMethod('b', b, 'setGroup', ['other']);

  // Assert
  expect(page.groups.snapshot(group).members).toEqual([]);
  expect(changes.length).toBeGreaterThanOrEqual(5);
  expect(new Set(changes).size).toBe(changes.length);
  stop();
});

it('ConsumerExtension_UsesSameRuntime_AndFacadeDisposalPreservesOtherRuntimeUser', async () => {
  // Arrange
  const native = nativeRuntime();

  // Act
  let registered = 0;

  // Assert
  const page = new PageRuntime(
    async url => url.endsWith('runtime.js') ? native : {
      register(runtime: object) {
        expect(runtime).toBe(native);
        registered++;
      },
    },
    base,
    base + 'runtime.js'
  );

  // Act
  const descriptor = { id: 'consumer', version: '1', dependencies: [], moduleUrl: 'consumer.js' };
  await Promise.all([page.openFacade('a', {}, [descriptor]), page.openFacade('b', {}, [descriptor])]);
  page.releaseFacade('a');
  page.invokeGlobal('b', 'registerTheme', ['theme', {}]);

  // Assert
  expect(registered).toBe(1);
});

it('Extensions_RejectConflictAndOrderDependencies_RetryDoesNotDuplicateSuccess', async () => {
  // Arrange
  const order: string[] = [];
  let available = false;
  const registry = new ExtensionRegistry(
    async () => ({}),
    async url => ({
      register() {
        if (url.endsWith('b.js') && !available)
          throw Error('unavailable');

        order.push(url);
      },
    }),
    base
  );
  const a = { id: 'a', version: '1', dependencies: [], moduleUrl: 'a.js' };
  const b = { id: 'b', version: '1', dependencies: ['a'], moduleUrl: 'b.js' };

  // Act & Assert
  await expect(registry.registerAll([b, a])).rejects.toThrow('unavailable');

  // Arrange
  available = true;

  // Act & Assert
  await expect(registry.registerAll([b])).rejects.toThrow('unavailable');

  // Act
  await registry.registerAll([b], true);

  // Assert
  expect(order).toEqual([base + 'a.js', base + 'b.js']);

  // Act & Assert
  await expect(registry.registerAll([{ ...a, version: '2' }])).rejects.toMatchObject({ code: 'ExtensionIdentityConflict' });
  await expect(registry.registerAll([{ ...a, id: 'c', dependencies: ['missing'] }])).rejects.toMatchObject({ code: 'ExtensionDependencyMissing' });
  await expect(registry.registerAll([{ ...a, id: 'c', dependencies: ['c'] }])).rejects.toMatchObject({ code: 'ExtensionDependencyCycle' });
});
