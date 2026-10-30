import { test, expect, type Page } from '@playwright/test';

// The .NET interop module (runtime-loader.js) and the page coordinator it shares across facades and render modes.
const loaderPath = /\/_content\/BlazorECharts\/js\/runtime-loader(\.[0-9a-z]+)?\.js$/;

const statistics = (page: Page) => page.evaluate(async () =>
  (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href)).resourceStatistics()) as Promise<{
    facades: number;
    charts: number;
  }>;

const nativeTitle = (page: Page, selector: string) => page.locator(selector).evaluate(async element => {
  const bridge = await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href);
  return bridge.getECharts().getInstanceByDom(element).getOption().title[0].text as string;
});

async function mount(page: Page) {
  await expect(page.getByTestId('interactive')).toHaveText('True');
  await page.getByRole('button', { name: 'Mount chart', exact: true }).click();
}

let issues: string[] = [];

test.beforeEach(({ page }) => {
  issues = [];
  page.on('pageerror', error => issues.push(error.message));
});

test('Loader_OnAMapStaticAssetsHost_IsImportedByItsFingerprintedUrl', async ({ page }) => {
  // Arrange
  const loaders: string[] = [];
  page.on('request', request => {
    if (loaderPath.test(new URL(request.url()).pathname))
      loaders.push(request.url());
  });
  await page.goto('/harness/lifecycle/server');

  // Act
  await mount(page);

  // Assert
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Ready');

  // A new deployment changes the fingerprint, so its circuit never receives the module an open page already holds.
  expect(loaders).toHaveLength(1);
  expect(new URL(loaders[0]).pathname).toMatch(/\/runtime-loader\.[0-9a-z]+\.js$/);
  expect(issues).toEqual([]);
});

test('ScriptsOfAnotherProtocolKeptByThePage_FailWithRuntimeVersionMismatch_UntilAReload', async ({ page }) => {
  // Scripts of an earlier deployment: the same URL served a loader of another protocol.

  // Arrange
  const loaders = (url: URL) => loaderPath.test(url.pathname);
  await page.route(loaders, async route => {
    const response = await route.fetch();
    let body = await response.text();

    // The bundle inlines the protocol constant into the handshake.
    for (const [current, earlier] of [['protocol!==3?', 'protocol!==2?'], ['"BlazorECharts.page-runtime.v3"', '"BlazorECharts.page-runtime.v2"']]) {
      if (!body.includes(current))
        throw new Error(`The loader bundle has no ${current}.`);

      body = body.replace(current, earlier);
    }

    await route.fulfill({ response, body });
  });
  await page.goto('/harness/versioning');
  const loader = await page.getByTestId('loader-url').innerText();
  await page.evaluate(async url => { await import(new URL(url, document.baseURI).href); }, loader);
  await page.unroute(loaders);

  // Enhanced navigation keeps the document and its module map; the new circuit imports the URL the page already holds.
  await page.getByRole('link', { name: 'Chart page' }).click();

  // Act
  await mount(page);

  // Assert
  await expect(page.getByTestId('last-detail')).toHaveText('RuntimeVersionMismatch');
  await expect(page.getByTestId('last-message')).toContainText('Reload the page');
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Failed');

  // Act
  await page.getByRole('button', { name: 'Retry chart', exact: true }).click();

  // Assert
  await expect(page.getByTestId('error-count')).toHaveText('2');
  await expect(page.getByTestId('last-detail')).toHaveText('RuntimeVersionMismatch');

  // Act
  await page.reload();
  await mount(page);

  // Assert
  await expect(page.locator('.echart')).toHaveAttribute('data-chart-state', 'Ready');
  await expect(page.getByTestId('error-count')).toHaveText('0');
  expect(issues).toEqual([]);
});

test('FailedFirstLoaderRequest_DoesNotBreakTheStableBrowserModule', async ({ page }) => {
  // The first request of every loader URL fails. The probe's own facade imports the stable URL first and retries with
  // its facade URL; WordCloud reads the page coordinator through blazor-echarts.js, which no longer imports the stable URL
  // that the failure left in the module map.

  // Arrange
  const failed = new Set<string>();
  await page.route(url => loaderPath.test(url.pathname) && url.search === '', async route => {
    const url = route.request().url();
    if (failed.has(url))
      await route.continue();
    else {
      failed.add(url);
      await route.fulfill({ status: 503, body: 'transient' });
    }
  });

  // Act
  await page.goto('/harness/wordcloud/server');

  // Assert
  await expect(page.getByTestId('status')).toHaveText('ready', { timeout: 20_000 });
  expect([...failed].map(url => new URL(url).pathname)).toEqual(['/_content/BlazorECharts/js/runtime-loader.js']);
  expect(issues).toEqual([]);
});

test('ServerAndWebAssemblyChartsOnOnePage_ShareThePageRuntime_AndDisposeIndependently', async ({ page }) => {
  // Act
  await page.goto('/harness/mixed');

  // Assert
  await expect(page.getByTestId('server-renderer')).toHaveText('Server');
  await expect(page.getByTestId('wasm-renderer')).toHaveText('WebAssembly', { timeout: 30_000 });
  await expect(page.locator('.mixed-server')).toHaveAttribute('data-chart-state', 'Ready');
  await expect(page.locator('.mixed-wasm')).toHaveAttribute('data-chart-state', 'Ready');
  expect(await statistics(page)).toMatchObject({ facades: 2, charts: 2 });

  // Act
  await page.getByRole('button', { name: 'Remove server', exact: true }).click();

  // Assert
  await expect(page.locator('.mixed-server')).toHaveCount(0);
  await expect.poll(async () => (await statistics(page)).charts).toBe(1);

  // Act
  await page.getByRole('button', { name: 'Update wasm', exact: true }).click();

  // Assert
  await expect.poll(() => nativeTitle(page, '.mixed-wasm')).toBe('2');
  await expect(page.locator('.mixed-wasm')).toHaveAttribute('data-chart-state', 'Ready');

  // Act
  await page.getByRole('button', { name: 'Remove wasm', exact: true }).click();

  // Assert
  await expect.poll(async () => (await statistics(page)).charts).toBe(0);
  await expect(page.getByTestId('server-errors')).toHaveText('0');
  await expect(page.getByTestId('wasm-errors')).toHaveText('0');
  await expect(page.getByTestId('server-ready')).toHaveText('1');
  await expect(page.getByTestId('wasm-ready')).toHaveText('1');
  expect(issues).toEqual([]);
});
