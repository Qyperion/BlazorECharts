import { test, expect } from '@playwright/test';
import { pageRuntimeBundle, routePageRuntime } from './page-runtime.ts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const engineBuilds: Record<string, string> = JSON.parse(readFileSync('schemas/upstream/sources.lock.json', 'utf8'))
  .packages.find((p: { name: string }) => p.name === 'echarts').files;

test.beforeEach(({ page }) => routePageRuntime(page));

test('Runtime_PrimitiveCanvasAndSvg_RendersWithoutGlobal', async ({ page, browser }, info) => {
  // Arrange
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Act
  await page.goto(`/harness/runtime`);

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('Ready');
  await expect(page.locator('#runtime-svg svg path')).not.toHaveCount(0);

  // Act
  const evidence = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#runtime-canvas canvas')!;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      nonempty: pixels.some((v, i) => i % 4 === 3 && v > 0),
      global: 'echarts' in window,
      result: document.querySelector('[data-testid="runtime-evidence"]')!.textContent,
    };
  });

  // Assert
  expect(evidence.nonempty).toBe(true);
  expect(evidence.global).toBe(false);
  expect(evidence.result).toContain('6.1.0');
  expect(evidence.result).toContain('shared identity: True');

  // Act
  await page.getByRole('button', { name: 'Dispose first facade' }).click();

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('First disposed; second updated');
  await expect(page.locator('#runtime-canvas canvas')).toHaveCount(0);
  await expect(page.locator('#runtime-svg svg')).toHaveCount(1);

  // Act
  await page.getByRole('button', { name: 'Dispose remaining facade' }).click();

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('Disposed');
  await expect(page.locator('#runtime-svg svg')).toHaveCount(0);
  expect(errors).toEqual([]);
  await info.attach('runtime-proof', { body: JSON.stringify({ ...evidence, browser: browser.version() }), contentType: 'application/json' });
});

test('Runtime_ManifestAssetsAreServedWithTheirHashes', async ({ page, request }) => {
  // Arrange
  const missing: string[] = [];
  page.on('response', response => {
    if (response.status() >= 400)
      missing.push(response.url());
  });

  // Act
  await page.goto(`/harness/runtime`);

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('Ready');

  // Act
  const manifestResponse = await request.get(`/_content/BlazorECharts/js/assets-manifest.json`);

  // Assert
  expect(manifestResponse.ok()).toBe(true);

  // Act
  const manifest = await manifestResponse.json();

  // Assert
  expect(manifest.runtime.version).toBe('6.1.0');
  expect(manifest.runtime.sourceSha256).toBe(engineBuilds['dist/echarts.esm.min.mjs']);
  for (const entry of manifest.files) {
    const response = await request.get(`/_content/BlazorECharts/${entry.path}`);
    expect(response.ok(), entry.path).toBe(true);

    // The package ships the minified build; the test host serves the development build of the same release for its warnings.
    const expected = entry.path === 'js/echarts-6.1.0.js' ? engineBuilds['dist/echarts.esm.mjs'] : entry.sha256;
    expect(createHash('sha256').update(await response.body()).digest('hex'), entry.path).toBe(expected);
  }

  expect(missing).toEqual([]);
});

test('Runtime_ModuleAndCustomProviders_ValidateAndRetry', async ({ page }) => {
  // Act
  await page.goto(`/harness/runtime`);

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('Ready');

  // Act
  const result = await page.evaluate(async () => {
    const { runProviderProbe } = await import(new URL('harness/runtime-probe.js', document.baseURI).href);
    return runProviderProbe();
  });

  // Assert
  expect(result).toEqual({
    version: '6.1.0',
    sameIdentity: true,
    conflict: 'RuntimeConfigurationConflict',
    badVersion: 'RuntimeVersionMismatch',
    badCapability: 'RuntimeCapabilityMissing',
    retry: '6.1.0',
  });
});

test('Runtime_ModuleNetworkFailure_ExplicitRetry', async ({ page }) => {
  // Act
  await page.goto(`/harness/runtime`);

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('Ready');

  // Act
  let available = false;
  await page.route('**/echarts-6.1.0.js?transient*', async route => {
    if (available)
      await route.continue();
    else
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
  });
  const failure = await page.evaluate(async () => {
    const { PageRuntime } = await import(new URL('__test/page-runtime.js', document.baseURI).href);
    const runtimeUrl = new URL('_content/BlazorECharts/js/echarts-6.1.0.js?transient', document.baseURI).href;
    const probe = new PageRuntime(url => import(url), document.baseURI, runtimeUrl);
    (window as any).retryProbe = probe;
    try {
      await probe.load();
      return 'unexpected-success';
    } catch (error) {
      return error.code;
    }
  });

  // Assert
  expect(failure).toBe('RuntimeLoadFailed');

  // Act
  available = true;
  const version = await page.evaluate(async () => (await (window as any).retryProbe.load({}, true)).version);

  // Assert
  expect(version).toBe('6.1.0');
});

test('Runtime_FacadeLoaderImportFailure_ExplicitRetry', async ({ page }) => {
  // Arrange
  let available = false;
  await page.route('**/runtime-loader*.js*', async route => {
    if (available)
      await route.continue();
    else
      await route.fulfill({ status: 503, body: 'Temporarily unavailable' });
  });

  // Act
  await page.goto(`/harness/runtime`);

  // Assert
  await expect(page.getByTestId('runtime-status')).toContainText('Failed:');

  // Act
  available = true;
  await page.getByRole('button', { name: 'Retry loader' }).click();

  // Assert
  await expect(page.getByTestId('runtime-status')).toHaveText('Ready', { timeout: 5_000 });
  await expect(page.locator('#runtime-svg svg')).toHaveCount(1);
});

test('Runtime_HttpOrigin_DoesNotRequireSecureContext', async ({ page }) => {
  // Arrange
  const module = await pageRuntimeBundle();
  await page.route('http://runtime-probe.invalid/**', async route => {
    if (new URL(route.request().url()).pathname === '/page-runtime.js')
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: module });
    else
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>HTTP runtime probe</title>' });
  });
  await page.goto('http://runtime-probe.invalid/');

  // Act
  const result = await page.evaluate(async () => {
    const { PageRuntime } = await import('/page-runtime.js');
    const importer = async () => ({});
    const first = new PageRuntime(importer, document.baseURI, 'http://runtime-probe.invalid/echarts.js');
    const second = new PageRuntime(importer, document.baseURI, 'http://runtime-probe.invalid/echarts.js');
    return { secure: isSecureContext, distinct: first.id !== second.id, nonempty: first.id.length > 0 };
  });

  // Assert
  expect(result).toEqual({ secure: false, distinct: true, nonempty: true });
});
