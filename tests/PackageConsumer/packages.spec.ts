import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdnRuntime } from './playwright.config.ts';
import { consumerPorts } from './ports.ts';
import { countColorPixels } from '../browser/image-pixels.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'schemas/upstream/sources.lock.json'), 'utf8'));
const echarts = lock.packages.find((entry: { name: string }) => entry.name === 'echarts');
const engineHash: string = echarts.files['dist/echarts.esm.min.mjs'];
const engine = `_content/BlazorECharts/js/echarts-${echarts.version}.js`;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ports = consumerPorts();
const host = (port: number, path = '') => `http://127.0.0.1:${port}${path}`;
const hosts = {
  server: host(ports.server), serverSubpath: host(ports.serverSubpath, '/charts-test'),
  cdn: host(ports.cdn), custom: host(ports.custom),
  wasm: host(ports.wasm), wasmSubpath: host(ports.wasmSubpath, '/charts-test'), coreOnly: host(ports.coreOnly),
  library: host(ports.library),
};

// Every request that leaves localhost is aborted and recorded. The CDN cases answer the CDN URL with the pinned engine.
async function offline(page: Page, cdnBody?: Buffer) {
  const blocked: string[] = [], requests: string[] = [], problems: string[] = [];
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), async route => {
    const url = route.request().url();
    if (cdnBody && url === cdnRuntime)
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: cdnBody, headers: { 'access-control-allow-origin': '*' } });
    blocked.push(url);
    return route.abort('blockedbyclient');
  });
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  return { blocked, requests, problems };
}

async function chartsWork(page: Page, base: string, wordCloud: boolean) {
  await page.goto(`${base}/charts`);
  await expect(page.getByTestId('status')).toHaveText('ready', { timeout: 60_000 });
  expect(Number(await page.getByTestId('png-length').innerText())).toBeGreaterThan(1_000);
  // The PNG is of the word cloud (text #2f5d8a) or, without WordCloud, of the magenta bars.
  expect(await countColorPixels(page, (await page.getByTestId('png-export').textContent())!, wordCloud ? '#2f5d8a' : '#ff00ff')).toBeGreaterThan(wordCloud ? 1_000 : 5_000);
  expect(await page.getByTestId('svg-export').textContent()).toContain('v=18');
  const browser = await page.evaluate(async wordCloud => {
    const bridge = await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href);
    const runtime = bridge.getECharts();
    let placed = 0;
    if (wordCloud) {
      const data = runtime.getInstanceByDom(document.querySelector('.cloud-chart')).getModel().getSeriesByType('wordCloud')[0].getData();
      for (let i = 0; i < data.count(); i++) if (data.getItemGraphicEl(i)) placed++;
    }
    return { version: runtime.version as string, placed, labels: [...document.querySelectorAll('.bar-chart svg text')].map(text => text.textContent) };
  }, wordCloud);
  expect(browser.version).toBe(echarts.version);
  expect(browser.labels).toEqual(expect.arrayContaining(['v=12', 'v=18', 'v=9']));
  if (wordCloud) expect(browser.placed).toBe(20);
}

for (const [mode, base, subpath] of [['server', hosts.server, hosts.serverSubpath], ['wasm', hosts.wasm, hosts.wasmSubpath]] as const) {
  test(`OfflineDefaultLoading ${mode}`, async ({ page }) => {
    const network = await offline(page);
    await chartsWork(page, base, true);
    expect(network.requests).toContain(`${base}/${engine}`);
    expect(network.requests.filter(url => url.includes('_content/BlazorECharts.WordCloud/'))).not.toEqual([]);
    // The chart runs where the render mode says: a .NET WebAssembly runtime, or a Server circuit.
    const host = mode === 'wasm' ? /\/_framework\/dotnet\.native\.[^/]*\.wasm$/ : /\/_blazor\/negotiate/;
    expect(network.requests.filter(url => host.test(url))).not.toEqual([]);
    const served = await page.request.get(`${base}/${engine}`);
    expect(sha256(await served.body())).toBe(engineHash);
    expect(network.blocked).toEqual([]);
    expect(network.problems).toEqual([]);
  });

  test(`PackagedAssetsRespectBasePath ${mode}`, async ({ page }) => {
    const network = await offline(page);
    await chartsWork(page, subpath, true);
    const origin = new URL(subpath).origin;
    const local = network.requests.filter(url => url.startsWith(origin));
    expect(local.filter(url => !url.startsWith(`${subpath}/`))).toEqual([]);
    expect(local).toContain(`${subpath}/${engine}`);
    expect(local).toContain(`${subpath}/consumer-functions.js`);
    expect(network.blocked).toEqual([]);
    expect(network.problems).toEqual([]);
  });

  test(`LazyNestedRouteLoadsRuntimeOnDemand ${mode}`, async ({ page }) => {
    const network = await offline(page);
    await page.goto(`${subpath}/`);
    await expect(page.getByRole('heading', { name: 'Package consumer' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(network.requests.filter(url => /echarts-6|runtime-loader|WordCloud|consumer-functions/.test(url))).toEqual([]);
    await page.getByRole('link', { name: 'Lazy chart', exact: true }).click();
    await expect(page.getByTestId('lazy-ready')).toHaveText('True');
    await expect(page.locator('.lazy-chart canvas')).toHaveCount(1);
    expect(network.requests).toContain(`${subpath}/${engine}`);
    expect(network.requests).toContain(`${subpath}/consumer-functions.js`);
    // Relative module URLs resolve against the base, never against the nested route.
    expect(network.requests.filter(url => url.includes('/nested/') && !url.endsWith('/nested/lazy'))).toEqual([]);
    expect(network.blocked).toEqual([]);
    expect(network.problems).toEqual([]);
  });
}

test('CoreOnlyDoesNotRequestWordCloud', async ({ page }) => {
  const network = await offline(page);
  await chartsWork(page, hosts.coreOnly, false);
  expect(network.requests).toContain(`${hosts.coreOnly}/${engine}`);
  expect(network.requests.filter(url => /wordcloud/i.test(url))).toEqual([]);
  expect((await page.request.get(`${hosts.coreOnly}/_content/BlazorECharts.WordCloud/js/wordcloud-extension.js`)).status()).toBe(404);
  expect(network.blocked).toEqual([]);
  expect(network.problems).toEqual([]);
});

test('WordCloudOnlyLibraryLoadsCoreTransitively', async ({ page }) => {
  const network = await offline(page);
  await chartsWork(page, hosts.library, true);
  expect(network.requests).toContain(`${hosts.library}/${engine}`);
  expect(network.requests).toContain(`${hosts.library}/_content/PackageConsumer.Library.Charts/consumer-functions.js`);
  expect(network.requests.filter(url => url.includes('_content/BlazorECharts.WordCloud/'))).not.toEqual([]);
  expect(sha256(await (await page.request.get(`${hosts.library}/${engine}`)).body())).toBe(engineHash);
  expect(network.blocked).toEqual([]);
  expect(network.problems).toEqual([]);
});

for (const [name, base, module] of [['CdnModuleProviderIsOptIn', hosts.cdn, null], ['CustomProviderIsOptIn', hosts.custom, 'custom-provider.js']] as const) {
  test(name, async ({ page }) => {
    const pinned = await readFile(join(root, 'src/BlazorECharts/wwwroot/js', `echarts-${echarts.version}.js`));
    expect(sha256(pinned)).toBe(engineHash);
    const network = await offline(page, pinned);
    await chartsWork(page, base, true);
    expect(network.requests).toContain(cdnRuntime);
    if (module) expect(network.requests).toContain(`${base}/${module}`);
    // The opt-in providers never fall back to the packaged engine.
    expect(network.requests.filter(url => url.endsWith(`/${engine}`))).toEqual([]);
    expect(network.blocked).toEqual([]);
    expect(network.problems).toEqual([]);
  });
}
