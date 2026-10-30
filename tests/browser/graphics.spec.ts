import { test, expect } from '@playwright/test';
import { routePageRuntime } from './page-runtime.ts';
import { readFileSync } from 'node:fs';

const nativePaths = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'))
  .globalMethods.filter((m: any) => m.owner === 'native' && m.recordId.startsWith('public:echarts.'))
  .map((m: any) => m.recordId.slice(15));

test.beforeEach(({ page }) => routePageRuntime(page));

test('Review_NativeImagesPatternsAndDomSurviveRendererRecreation', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('r');
    const element = document.createElement('div');
    element.style.cssText = 'width:400px;height:240px';
    document.body.append(element);
    const id = p.createChart('r', element, null, {});
    const canvas = await p.createNative('r', 'canvas', { width: 32, height: 16 }, { json: { args: [] }, bindings: [] });
    const dom = await p.createNative('r', 'module', { moduleUrl: './modules/native-values.js', exportName: 'makeDom' }, {
      json: { args: [] },
      bindings: [],
    });
    const image = await p.createNative('r', 'image', { src: './modules/pixel.svg' }, { json: { args: [] }, bindings: [] });
    await p.setOption(
      'r',
      id,
      {
        json: {
          animation: false,
          nativeDom: null,
          graphic: [
            { type: 'image', style: { image: null, width: 20, height: 20 } },
            { type: 'rect', shape: { x: 30, y: 0, width: 20, height: 20 }, style: { fill: { image: null, repeat: 'repeat' } } },
          ],
          series: [],
        },
        bindings: [
          { ...dom.bindings[0], path: ['nativeDom'] },
          { ...image.bindings[0], path: ['graphic', 0, 'style', 'image'] },
          { ...canvas.bindings[0], path: ['graphic', 1, 'style', 'fill', 'image'] },
        ],
      },
      {}
    );
    const old = p.getECharts().getInstanceByDom(element).getOption();
    for (const r of [canvas, dom, image])
      await p.releaseResult('r', r.leaseId);

    p.recreateChart('r', id, { renderer: 'svg' }, null);
    const next = p.getECharts().getInstanceByDom(element).getOption();
    const identity = [
      next.nativeDom === old.nativeDom,
      next.graphic[0].elements[0].style.image === old.graphic[0].elements[0].style.image,
      next.graphic[0].elements[1].style.fill.image === old.graphic[0].elements[1].style.fill.image,
    ];
    p.disposeChart('r', id);
    return { identity, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ identity: [true, true, true], counts: { entries: 0, leases: 0, results: 0 } });
});

test('Review_NativeConnectDisconnectDisposeUseManagedOwnership', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('r');
    const make = () => {
      const el = document.createElement('div');
      el.style.cssText = 'width:400px;height:200px';
      document.body.append(el);
      return el;
    };
    const a = make();
    const b = make();
    const one = p.createChart('r', a, null, {});
    const two = p.createChart('r', b, null, {});
    const ec = p.getECharts();
    const first = ec.getInstanceByDom(a);
    const second = ec.getInstanceByDom(b);
    first.group = second.group = 'review';
    await p.invokeNative('r', 'connect', false, { json: { args: ['review'] }, bindings: [] });
    const connected = p.groupSnapshot('r', 'review').connected;
    await p.invokeNative('r', 'disconnect', false, { json: { args: ['review'] }, bindings: [] });
    const disconnected = !p.groupSnapshot('r', 'review').connected;
    const canvas = await p.createNative('r', 'canvas', { width: 32, height: 16 }, { json: { args: [] }, bindings: [] });
    await p.setOption('r', one, { json: { canvas: null, series: [] }, bindings: [{ ...canvas.bindings[0], path: ['canvas'] }] }, {});
    const held = first.getOption().canvas;
    await p.releaseResult('r', canvas.leaseId);
    await p.invokeNative('r', 'dispose', false, { json: { args: [first.id] }, bindings: [] });
    const afterNativeDispose = held.width;
    p.disposeChart('r', one);
    p.disposeChart('r', two);
    return { connected, disconnected, afterNativeDispose, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ connected: true, disconnected: true, afterNativeDispose: 0, counts: { entries: 0, leases: 0, results: 0 } });
});

test('Review_RegistrationAppendFirstWinsAndPlatformMergeKeepDependencies', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const moduleUrl = './modules/native-review.js';
    const fixture = await import(new URL(moduleUrl, document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('r');
    const prepared = (json: any, refs: [any, (string | number)[]][]) => ({ json, bindings: refs.map(([r, path]) => ({ ...r.bindings[0], path })) });
    const callback = async (width: number, key: string, factory = 'probe') => {
      const canvas = await p.createNative('r', 'canvas', { width, height: 8 }, { json: { args: [] }, bindings: [] });
      const fn = await p.createNative('r', 'module', { moduleUrl, exportName: factory }, prepared({ args: [null, key] }, [[canvas, ['args', 0]]]));
      return { canvas, fn };
    };
    const all = [];
    for (const [width, key] of [[32, 'first'], [48, 'second']] as const) {
      const c = await callback(width, key);
      all.push(c);
      await p.invokeNative('r', 'registerUpdateLifecycle', false, prepared({ args: ['afterupdate', null] }, [[c.fn, ['args', 1]]]));
      await p.invokeNative('r', 'registerAction', false, prepared({ args: ['reviewaction', null] }, [[c.fn, ['args', 1]]]));
    }

    const measure = await callback(64, 'measure', 'measure');
    all.push(measure);
    await p.invokeNative('r', 'setPlatformAPI', false, prepared({ args: [{ measureText: null }] }, [[measure.fn, ['args', 0, 'measureText']]]));
    const load = await p.createNative('r', 'module', { moduleUrl, exportName: 'loadImage' }, { json: { args: [] }, bindings: [] });
    await p.invokeNative('r', 'setPlatformAPI', false, prepared({ args: [{ loadImage: null }] }, [[load, ['args', 0, 'loadImage']]]));
    for (const c of all) {
      await p.releaseResult('r', c.fn.leaseId);
      await p.releaseResult('r', c.canvas.leaseId);
    }

    await p.releaseResult('r', load.leaseId);
    const el = document.createElement('div');
    el.style.cssText = 'width:400px;height:200px';
    document.body.append(el);
    const id = p.createChart('r', el, null, {});
    await p.setOption('r', id, { json: { animation: false, title: { text: 'registration' }, series: [] }, bindings: [] }, {});
    const append = [fixture.state.first, fixture.state.second];
    const platform = fixture.state.measure;
    fixture.state.first = fixture.state.second = null;
    fixture.state.actionsOnly = true;
    p.dispatchAction('r', id, { type: 'reviewaction' }, null);
    const action = [fixture.state.first, fixture.state.second];
    p.releaseFacade('r');
    return { append, platform, action };
  });

  // Assert
  expect(result).toEqual({ append: [32, 48], platform: 64, action: [32, null] });
});

test('Review_GraphicVoidMutationRetainsPropertiesUntilTargetRemoval', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('r');
    const prepared = (json: any, refs: [any, (string | number)[]][]) => ({ json, bindings: refs.map(([r, path]) => ({ ...r.bindings[0], path })) });
    const el = document.createElement('div');
    el.style.cssText = 'width:400px;height:200px';
    document.body.append(el);
    const id = p.createChart('r', el, null, {});
    const zr = p.invokeMethod('r', id, 'getZr', []);
    const target = await p.invokeNative('r', 'graphic.Image', true, {
      json: { args: [{ style: { x: 0, y: 0, width: 30, height: 20 } }] },
      bindings: [],
    });
    const added = await p.createNative(
      'r',
      'module',
      { moduleUrl: './modules/native-review.js', exportName: 'add' },
      prepared({ args: [null, null] }, [[target, ['args', 0]], [zr, ['args', 1]]])
    );
    const canvas = await p.createNative('r', 'canvas', { width: 32, height: 16 }, { json: { args: [] }, bindings: [] });
    await p.invokeNative(
      'r',
      'graphic.initProps',
      false,
      prepared({ args: [null, { style: { image: null } }, null] }, [[target, ['args', 0]], [canvas, ['args', 1, 'style', 'image']]])
    );
    const fixture = await import(new URL('modules/native-review.js', document.baseURI).href);
    const image = fixture.state.target.style.image;
    for (const r of [canvas, target, added, zr])
      await p.releaseResult('r', r.leaseId);

    const retained = image.width;
    fixture.state.target.__zr.remove(fixture.state.target);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    p.disposeChart('r', id);
    return { retained, released: image.width, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ retained: 32, released: 0, counts: { entries: 0, leases: 0, results: 0 } });
});

test('Review_GraphicAnimationRetainsCallbacksUntilActualCompletion', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('r');
    const prepared = (json: any, refs: [any, (string | number)[]][]) => ({ json, bindings: refs.map(([r, path]) => ({ ...r.bindings[0], path })) });
    const el = document.createElement('div');
    el.style.cssText = 'width:400px;height:200px';
    document.body.append(el);
    const id = p.createChart('r', el, null, {});
    const zr = p.invokeMethod('r', id, 'getZr', []);
    const target = await p.invokeNative('r', 'graphic.Rect', true, {
      json: { args: [{ shape: { x: 0, y: 0, width: 20, height: 20 }, style: { fill: 'red' } }] },
      bindings: [],
    });
    const moduleUrl = './modules/native-review.js';
    const added = await p.createNative(
      'r',
      'module',
      { moduleUrl, exportName: 'add' },
      prepared({ args: [null, null] }, [[target, ['args', 0]], [zr, ['args', 1]]])
    );
    const canvas = await p.createNative('r', 'canvas', { width: 32, height: 16 }, { json: { args: [] }, bindings: [] });
    const callback = await p.createNative(
      'r',
      'module',
      { moduleUrl, exportName: 'probe' },
      prepared({ args: [null, 'done'] }, [[canvas, ['args', 0]]])
    );
    const model = await p.createNative('r', 'module', { moduleUrl, exportName: 'animationModel' }, { json: { args: [] }, bindings: [] });
    const fixture = await import(new URL(moduleUrl, document.baseURI).href);
    const done = Promise.withResolvers<void>();
    fixture.state.completed = () => done.resolve();
    await p.invokeNative(
      'r',
      'graphic.updateProps',
      false,
      prepared({ args: [null, { x: 60 }, null, 0, null] }, [[target, ['args', 0]], [model, ['args', 2]], [callback, ['args', 4]]])
    );
    for (const r of [canvas, callback, model, target, added, zr])
      await p.releaseResult('r', r.leaseId);

    await done.promise;
    const seen = fixture.state.done;
    const released = fixture.state.doneCanvas.width;
    p.disposeChart('r', id);
    return { seen, released, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ seen: 32, released: 0, counts: { entries: 0, leases: 0, results: 0 } });
});

test('Review_GraphicMutationWithoutAnimationReleasesCallbackAndRepeats', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('r');
    const prepared = (json: any, refs: [any, (string | number)[]][]) => ({ json, bindings: refs.map(([r, path]) => ({ ...r.bindings[0], path })) });
    const el = document.createElement('div');
    el.style.cssText = 'width:400px;height:200px';
    document.body.append(el);
    const id = p.createChart('r', el, null, {});
    const zr = p.invokeMethod('r', id, 'getZr', []);
    const target = await p.invokeNative('r', 'graphic.Image', true, {
      json: { args: [{ style: { x: 0, y: 0, width: 30, height: 20 } }] },
      bindings: [],
    });
    const moduleUrl = './modules/native-review.js';
    const added = await p.createNative(
      'r',
      'module',
      { moduleUrl, exportName: 'add' },
      prepared({ args: [null, null] }, [[target, ['args', 0]], [zr, ['args', 1]]])
    );
    const canvas = await p.createNative('r', 'canvas', { width: 32, height: 16 }, { json: { args: [] }, bindings: [] });
    const callback = await p.createNative(
      'r',
      'module',
      { moduleUrl, exportName: 'probe' },
      prepared({ args: [null, 'still'] }, [[canvas, ['args', 0]]])
    );
    const fixture = await import(new URL(moduleUrl, document.baseURI).href);

    // No animatable model: ECharts sets the props and calls back at once, so no animator holds the callback.
    const errors: string[] = [];
    for (let i = 0; i < 2; i++)
      await p.invokeNative('r', 'graphic.updateProps', false, prepared(
        { args: [null, { style: { image: null } }, null, 0, null] },
        [[target, ['args', 0]], [canvas, ['args', 1, 'style', 'image']], [callback, ['args', 4]]]
      )).catch((e: unknown) => errors.push(String(e)));

    const called = fixture.state.still;
    for (const r of [canvas, callback, target, added, zr])
      await p.releaseResult('r', r.leaseId);

    const retained = fixture.state.target.style.image.width;
    fixture.state.target.__zr.remove(fixture.state.target);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    p.disposeChart('r', id);
    return { errors, called, retained, released: fixture.state.stillCanvas.width, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ errors: [], called: 32, retained: 32, released: 0, counts: { entries: 0, leases: 0, results: 0 } });
});

test('GraphicInventory_AllSourceExportsResolveOnSelectedRuntime', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const missing = await page.evaluate(
    async (paths: string[]) => {
      const { getECharts } = await import(new URL('_content/BlazorECharts/js/blazor-echarts.js', document.baseURI).href);
      const ec = getECharts();
      return paths.filter(path => {
        let value: any = ec;
        for (const segment of path.split('.'))
          value = value?.[segment];

        return typeof value !== (path === 'graphic' ? 'object' : 'function');
      });
    },
    nativePaths
  );

  // Assert
  expect(missing).toEqual([]);
});

test('NativeResult_RetainsOwnedArgumentDependenciesAfterResultDisposal', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const runtimeUrl = new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href;
    const p = new PageRuntime(url => import(url), document.baseURI, runtimeUrl);
    await p.openFacade('test');
    const canvas = await p.createNative('test', 'canvas', { width: 32, height: 16 }, { json: { args: [] }, bindings: [] });
    const bound = await p.invokeNative('test', 'zrUtil.bind', false, {
      json: { args: [null, null] },
      bindings: [
        {
          path: ['args', 0],
          kind: 'module',
          token: 'binding:0',
          signature: 'fixture',
          moduleUrl: './modules/chart-functions.js',
          exportName: 'canvasWidth',
        },
        { ...canvas.bindings[0], path: ['args', 1] },
      ],
    });
    const element = document.createElement('div');
    element.style.cssText = 'width:400px;height:200px';
    document.body.append(element);
    const id = p.createChart('test', element, null, {});
    await p.setOption('test', id, { json: { callback: null, series: [] }, bindings: [{ ...bound.bindings[0], path: ['callback'] }] }, {});
    const fn = p.getECharts().getInstanceByDom(element).getOption().callback;
    await p.releaseResult('test', canvas.leaseId);
    await p.releaseResult('test', bound.leaseId);
    const retained = fn();
    const snapshot = p.invokeMethod('test', id, 'getOption', []);
    p.disposeChart('test', id);
    const snapshotRetained = fn();
    const next = p.createChart('test', element, null, {});
    await p.setOption('test', next, { json: snapshot.value, bindings: snapshot.bindings }, {});
    await p.releaseResult('test', snapshot.leaseId);
    const reapplied = fn();
    p.disposeChart('test', next);
    return { retained, snapshotRetained, reapplied, released: fn(), statistics: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ retained: 32, snapshotRetained: 32, reapplied: 32, released: 0, statistics: { entries: 0, leases: 0, results: 0 } });
});

for (const mode of ['server', 'wasm']) {
  test(`GraphicConstructors_UseSelectedRuntimeAndNativeReferences_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Graphic helpers', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('graphics');

    // Act
    const result = await page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const n = await import(new URL('modules/native-values.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const list = chart.getZr().storage.getDisplayList();
      const canvas = element.querySelector('canvas')!;
      return {
        selected: n.state.rect instanceof ec.graphic.Rect,
        displayed: list.includes(n.state.rect),
        width: n.state.rect.shape.width,
        gradient: chart.getOption().backgroundColor.type,
        nonempty: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0),
      };
    });

    // Assert
    expect(result).toEqual({ selected: true, displayed: true, width: 90, gradient: 'linear', nonempty: true });
  });
}
