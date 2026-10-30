import { test, expect } from '@playwright/test';
import { routePageRuntime } from './page-runtime.ts';

test.beforeEach(({ page }) => routePageRuntime(page));

for (const mode of ['server', 'wasm']) {
  test(`IntrinsicValues_RoundTripAndInvokeRealCallback_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Intrinsic values', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('intrinsic:roundtrip');

    // Act
    const capture = () => page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const option = chart.getOption();
      const f = await import(new URL('modules/chart-functions.js', document.baseURI).href);
      return {
        version: ec.version,
        fixture: option.intrinsicFixture,
        same: option.series[0].renderItem === f.intrinsicRenderItem,
        calls: f.state.intrinsic,
        display: chart.getZr().storage.getDisplayList().filter((item: any) => item.type === 'rect').length,
      };
    });
    const before = await capture();

    // Assert
    expect(before).toMatchObject({
      version: '6.1.0',
      fixture: { text: 'А😀', number: 0, flag: false, empty: [], nothing: null, values: ['a', 0, false, null] },
      same: true,
      display: 2,
    });
    expect(before.calls).toContainEqual({ index: 0, text: 'А😀', values: [2, 3], result: 'rect' });
    expect(before.calls).toContainEqual({ index: 1, text: 'B', values: [6, 7], result: 'rect' });

    // Act
    await page.getByRole('button', { name: 'Snapshot reapply', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText(/^snapshot:\d+:True$/);

    // Act
    const after = await capture();

    // Assert
    expect(after.same).toBe(true);
    expect(after.fixture).toEqual(before.fixture);
    expect(after.calls.length).toBeGreaterThan(before.calls.length);
    expect(errors).toEqual([]);
  });

  test(`ExplicitBindingReader_ModuleAndInlineReachPinnedRuntime_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/functions/${mode}?inline=1`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Module binding round trip', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('restored:module');
    expect(await page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const functions = await import(new URL('modules/chart-functions.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const option = chart.getOption();
      return {
        version: ec.version,
        same: option.series[0].renderItem === functions.renderItem,
        renders: functions.state.renders.length,
        display: chart.getZr().storage.getDisplayList().filter((e: any) => e.type === 'rect').length,
      };
    })).toEqual({ version: '6.1.0', same: true, renders: 2, display: 2 });

    // Act
    await page.getByRole('button', { name: 'Inline binding round trip', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('restored:inline');
    expect(await page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getOption().inlineCallback(3);
    })).toBe(12);
    expect(errors).toEqual([]);
  });

  test(`RestoredInlineBinding_RequiresTheRuntimeOptIn_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Inline binding round trip', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('AllowInlineJavaScript');
  });

  test(`ColorCallback_ReceivesSourceArgumentsSynchronously_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Color callback', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('color');

    // Act
    const result = await page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const f = await import(new URL('modules/chart-functions.js', document.baseURI).href);
      const data = ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getData();
      return {
        colors: [data.getItemVisual(0, 'style').fill, data.getItemVisual(1, 'style').fill],
        args: f.state.colors.map((p: any) => ({ value: p.value, seriesType: p.seriesType, index: p.dataIndex })),
      };
    });

    // Assert
    expect(result.colors).toEqual(['#ff0000', '#0000ff']);
    expect(result.args).toEqual([{ value: 3, seriesType: 'bar', index: 0 }, { value: 7, seriesType: 'bar', index: 1 }]);
  });

  test(`Tooltip_AsyncNativeDomAndActionCallback_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Module', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('module');

    // Act
    await page.getByRole('button', { name: 'Action position', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('position');
    expect(await page.evaluate(async () => (await import(new URL('modules/chart-functions.js', document.baseURI).href)).state.position.dom)).toBe(
      true
    );

    // Act
    await page.getByRole('button', { name: 'Async tooltip', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('async tooltip');
    await expect(page.getByText('async:1', { exact: true })).toBeVisible();
  });

  test(`ModuleCallbacks_RunSynchronouslyInBrowser_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Module', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('module');

    // Act
    const result = await page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const callbacks = await import(new URL('modules/chart-functions.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const option = chart.getOption();
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 });
      return {
        renders: callbacks.state.renders,
        same: option.series[0].renderItem === callbacks.renderItem,
        sync: !(callbacks.formatter(3) instanceof Promise),
        ordinary: option.ordinary,
        executed: !!(window as any).accidentalExecution,
        display: chart.getZr().storage.getDisplayList().filter((e: any) => e.type === 'rect').length,
      };
    });

    // Assert
    expect(result.same).toBe(true);
    expect(result.sync).toBe(true);
    expect(result.executed).toBe(false);
    expect(result.ordinary.kind).toBe('inline');
    expect(result.ordinary.source).toBe('throw 1');
    expect(result.renders).toHaveLength(2);
    expect(result.renders[0]).toMatchObject({ index: 0, width: 640, height: 360, series: [0] });
    expect(result.renders[0].point.every(Number.isFinite)).toBe(true);
    expect(result.display).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('native-tooltip')).toHaveText('DOM:0');
    expect(errors).toEqual([]);
  });

  test(`GetOption_FunctionDomRoundTrip_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Module', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('module');

    // Act
    await page.getByRole('button', { name: 'Native values', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('native');

    // Act
    const capture = () => page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const f = await import(new URL('modules/chart-functions.js', document.baseURI).href);
      const n = await import(new URL('modules/native-values.js', document.baseURI).href);
      const o = ec.getInstanceByDom(element).getOption();
      return {
        fn: o.series[0].renderItem === f.renderItem,
        dom: o.nativeFixture.dom === n.state.dom,
        canvas: o.nativeFixture.pattern.image === n.state.pattern.image,
        decoded: o.nativeFixture.image.complete && o.nativeFixture.image.naturalWidth === 16,
      };
    });

    // Assert
    expect(await capture()).toEqual({ fn: true, dom: true, canvas: true, decoded: true });
    await expect.poll(() => page.locator('.functions-chart').evaluate((element: HTMLElement) => {
      const canvas = element.querySelector('canvas')!;
      const scale = canvas.width / element.clientWidth;
      return [...canvas.getContext('2d')!.getImageData(90 * scale, 30 * scale, 1, 1).data];
    })).toEqual([255, 170, 0, 255]);

    // Act
    await page.getByRole('button', { name: 'Snapshot reapply', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText(/^snapshot:\d+:True$/);
    expect(await capture()).toEqual({ fn: true, dom: true, canvas: true, decoded: true });

    // Act
    await page.getByRole('button', { name: 'Dispose', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('disposed');
    expect(await page.evaluate(async () => {
      const n = await import(new URL('modules/native-values.js', document.baseURI).href);
      return n.state.pattern.image.width;
    })).toBe(8);
  });

  test(`InlineCallbacks_RequireExplicitOptIn_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Inline', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('AllowInlineJavaScript');

    // Act
    await page.goto(`/harness/functions/${mode}?inline=1`);

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Inline', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('inline');
    expect(await page.locator('.functions-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getOption().inlineCallback(3);
    })).toBe(12);
  });

  test(`BindingFailures_AreAwaitedAndPathSpecific_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/functions/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Import failure', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('broken');
    await expect(page.getByTestId('status')).toContainText('missingExport');

    // Act
    await page.getByRole('button', { name: 'Decode failure', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toContainText('decode/CORS failed');
  });
}

test('OrdinaryJson_NeverExecutesCodeLikeStrings_StrictCSP', async ({ page }) => {
  // Arrange
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  // Act
  const response = await page.goto(`/harness/functions-csp`);

  // Assert
  expect(response!.headers()['content-security-policy']).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');
  expect(await page.evaluate(() => (window as any).cspProof)).toEqual({
    formatter: 'module:7',
    same: true,
    ordinary: 'function() { throw 1; }',
    noExecution: true,
  });
  expect(errors).toEqual([]);
});

test('DisposeDuringHydration_RejectsLateBindings_ActualRuntime', async ({ page }) => {
  // Arrange
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  let fulfill!: () => Promise<void>;
  const requested = Promise.withResolvers<void>();
  await page.route('**/modules/delayed.js', route => {
    fulfill = () => route.fulfill({ contentType: 'text/javascript', body: 'export function formatter(){ return "late"; }' });
    requested.resolve();
  });
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('test');
    const element = document.createElement('div');
    element.style.cssText = 'width:400px;height:200px';
    document.body.append(element);
    const id = p.createChart('test', element, null, {});
    (window as any).hydrationRace = {
      p,
      id,
      element,
      result: p.setOption(
        'test',
        id,
        {
          json: { callback: null },
          bindings: [
            {
              path: ['callback'],
              kind: 'module',
              token: 'binding:0',
              signature: 'fixture',
              moduleUrl: './modules/delayed.js',
              exportName: 'formatter',
            },
          ],
        },
        {}
      ).then(
        () => 'unexpected-success',
        e => e.message
      ),
    };
  });
  await requested.promise;
  await page.evaluate(() => {
    const r = (window as any).hydrationRace;
    r.p.disposeChart('test', r.id);
  });
  await fulfill();

  // Assert
  expect(await page.evaluate(() => (window as any).hydrationRace.result)).toMatch(/disposed/i);
  expect(await page.evaluate(() => (window as any).hydrationRace.element.querySelector('canvas'))).toBeNull();
  expect(errors).toEqual([]);
});

test('DisposeDuringDecode_CancelsOwnedImageWithoutWaitingForNetwork', async ({ page }) => {
  // Arrange
  let reply!: () => Promise<void>;
  const requested = Promise.withResolvers<void>();
  await page.route('**/modules/delayed.svg', route => {
    reply = () => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' });
    requested.resolve();
  });
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('test');
    const race = (window as any).decodeRace = { p, state: 'pending' };
    p.createNative('test', 'image', { src: './modules/delayed.svg' }, { json: { args: [] }, bindings: [] }).then(
      () => race.state = 'unexpected-success',
      e => race.state = e.message
    );
  });
  await requested.promise;
  await page.evaluate(() => (window as any).decodeRace.p.releaseFacade('test'));
  try {
    // Assert
    await expect.poll(() => page.evaluate(() => (window as any).decodeRace.state), { timeout: 1000 }).toMatch(/disposed/i);
  } finally {
    await reply();
  }

  expect(await page.evaluate(() => (window as any).decodeRace.p.referenceStatistics())).toEqual({ entries: 0, leases: 0, results: 0 });
});

test('EventNativeReference_CanBeRetainedBeyondHandlerAndChart', async ({ page }) => {
  // Arrange
  await page.goto(`/harness/functions-csp`);
  await expect(page.getByTestId('status')).toHaveText('csp-ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('test');
    const element = document.createElement('div');
    element.style.cssText = 'width:400px;height:200px';
    document.body.append(element);
    const id = p.createChart('test', element, null, {});
    const ready = Promise.withResolvers<any>();
    p.subscribe('test', id, 's', 'probe', null, {
      async invokeMethodAsync(method: string, subscription: string, epoch: number, data: any, references: any) {
        try {
          ready.resolve(await p.createNative('test', 'reference', references[0].reference, { json: { args: [] }, bindings: [] }));
        } catch (error) {
          ready.reject(error);
        }
      },
    });
    p.getECharts().getInstanceByDom(element).trigger('probe', { native: new Event('probe') });
    const retained = await ready.promise;
    await new Promise<void>(resolve => queueMicrotask(resolve));
    p.disposeChart('test', id);
    const checked = await p.invokeNative('test', 'zrUtil.isObject', false, {
      json: { args: [null] },
      bindings: [{ ...retained.bindings[0], path: ['args', 0] }],
    });
    await p.releaseResult('test', retained.leaseId);
    return { checked: checked.value, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result).toEqual({ checked: true, counts: { entries: 0, leases: 0, results: 0 } });
});

test('NativeValues_CorsAndModuleNetworkFailuresAreObservable', async ({ page }) => {
  // Arrange
  const messages: string[] = [];
  page.on('console', message => messages.push(message.text()));
  await page.goto(`/harness/functions/server`);
  await expect(page.getByTestId('status')).toHaveText('ready');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const p = new PageRuntime(url => import(url), document.baseURI, new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    await p.openFacade('test');
    const cross = new URL('modules/pixel.svg', document.baseURI);
    cross.hostname = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    const error = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return 'unexpected-success';
      } catch (e) {
        return (e as Error).message;
      }
    };
    const cors = await error(
      () => p.createNative('test', 'image', { src: cross.href, crossOrigin: 'anonymous' }, { json: { args: [] }, bindings: [] })
    );
    const module = await error(
      () => p.createNative('test', 'module', { moduleUrl: './modules/missing.js', exportName: 'native' }, { json: { args: [] }, bindings: [] })
    );
    return { cors, module, counts: p.referenceStatistics() };
  });

  // Assert
  expect(result.cors).toContain('decode/CORS failed');
  expect(result.module).toMatch(/missing.js.*native/);
  expect(result.counts).toEqual({ entries: 0, leases: 0, results: 0 });
  expect(messages.some(text => text.includes('CORS'))).toBe(true);
});

// A Blazor page with EChart, a module label formatter, a module renderItem and an HTML tooltip under a strict CSP.
// Without 'unsafe-inline' styles the chart still renders; the tooltip HTML of ECharts loses its inline styles.
for (const mode of ['server', 'wasm'])
  for (const style of ['inline', 'self']) {
    test(`StrictCsp_BlazorPageRendersModuleFunctions_${mode}_style_${style}`, async ({ page }) => {
      // Arrange
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        (window as any).violations = [];
        document.addEventListener('securitypolicyviolation', e => (window as any).violations.push(
          `${e.effectiveDirective} ${e.sourceFile.split('/').pop()} ${!!(e.target as Element).closest?.('.csp-chart')}`
        ));
      });
      const response = await page.goto(`/harness/csp/${mode}${style === 'self' ? '?style=self' : ''}`);

      // Act
      const policy = response!.headers()['content-security-policy'];

      // Assert
      expect(policy).not.toMatch(/'unsafe-eval'|script-src[^;]*'unsafe-inline'/);
      expect(policy).toContain(style === 'self' ? "style-src 'self';" : "style-src 'self' 'unsafe-inline';");
      await expect(page.getByTestId('status')).toHaveText('ready');

      // Act
      const chart = page.locator('.csp-chart');
      const drawn = await chart.evaluate(async (element: HTMLElement) => {
        const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
        const functions = await import(new URL('modules/csp-functions.js', document.baseURI).href);
        const model = ec.getInstanceByDom(element).getModel();
        const bars = model.getSeriesByIndex(0).getData();
        const custom = model.getSeriesByIndex(1).getData();
        return {
          label: bars.getItemGraphicEl(1).getTextContent().style.text,
          custom: custom.getItemGraphicEl(0)?.type,
          renders: functions.state.renders > 0,
        };
      });

      // Assert
      expect(drawn).toEqual({ label: 'csp:7', custom: 'circle', renders: true });
      expect(await page.evaluate(() => (window as any).violations)).toEqual([]);

      // Act
      await page.getByRole('button', { name: 'Show tooltip', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('tooltip');
      await expect(chart.locator('div').filter({ hasText: /^bars\s*B\s*7$/ }).last()).toBeAttached();

      // Act
      const marker = await chart.evaluate((element: HTMLElement) => {
        const tooltip = [...element.querySelectorAll('div')].filter(d => /^bars\s*B\s*7$/.test(d.textContent!.trim())).pop()!;
        return getComputedStyle(tooltip.querySelector('span')!).backgroundColor;
      });
      const violations: string[] = await page.evaluate(() => (window as any).violations);

      // Assert
      if (style === 'inline') {
        expect(violations).toEqual([]);
        expect(marker).not.toBe('rgba(0, 0, 0, 0)');
      } else {
        // TooltipHTMLContent.setContent assigns innerHTML with style attributes (marker, layout, arrow).
        expect(violations.length).toBeGreaterThan(0);
        expect([...new Set(violations)]).toEqual(['style-src-attr echarts-6.1.0.js true']);
        expect(marker).toBe('rgba(0, 0, 0, 0)');
      }

      expect(errors).toEqual([]);
    });
  }
