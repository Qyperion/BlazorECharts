import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countColorPixels } from '../browser/image-pixels.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'schemas/upstream/sources.lock.json'), 'utf8'));
const echarts = lock.packages.find((entry: { name: string }) => entry.name === 'echarts');
const engine = `_content/BlazorECharts/js/echarts-${echarts.version}.js`;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const loader = '_content/BlazorECharts/js/runtime-loader.js';
type Statistics = { charts: number; subscriptions: number; references: number; leases: number; results: number; exports: number };

// Every request that leaves localhost is aborted and recorded; the page must reach "ready" without one.
async function open(page: Page) {
  const blocked: string[] = [], requests: string[] = [], problems: string[] = [];
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => {
    blocked.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  await page.goto('./');
  await expect(page.getByTestId('status')).toHaveText('ready', { timeout: 90_000 });
  return { blocked, requests, problems };
}

const statistics = (page: Page) => page.evaluate(async loader =>
  (await import(new URL(loader, document.baseURI).href)).resourceStatistics(), loader) as Promise<Statistics>;

// Client coordinates of a data value of the mixed chart, after scrolling it into view.
async function pixel(page: Page, seriesIndex: number, value: [number, number]) {
  await page.locator('.mixed-chart').scrollIntoViewIfNeeded();
  return page.evaluate(async ({ loader, seriesIndex, value }) => {
    const element = document.querySelector('.mixed-chart')!;
    const chart = (await import(new URL(loader, document.baseURI).href)).getECharts().getInstanceByDom(element);
    const [x, y] = chart.convertToPixel({ seriesIndex }, value);
    const box = element.getBoundingClientRect();
    return { x: box.left + x, y: box.top + y };
  }, { loader, seriesIndex, value });
}

test('PublishedOutputLoadsPackagedAssetsOffline', async ({ page, baseURL }) => {
  const network = await open(page);
  expect(network.requests).toContain(`${baseURL}${engine}`);
  expect(network.requests.filter(url => url.includes('_content/BlazorECharts.WordCloud/'))).not.toEqual([]);
  expect(network.requests.filter(url => /\/_framework\/dotnet\.native\.[0-9a-z]+\.wasm$/.test(url))).toHaveLength(1);
  expect(sha256(await (await page.request.get(`${baseURL}${engine}`)).body())).toBe(echarts.files['dist/echarts.esm.min.mjs']);
  const version = await page.evaluate(async loader => (await import(new URL(loader, document.baseURI).href)).getECharts().version, loader);
  expect(version).toBe(echarts.version);
  expect(network.blocked).toEqual([]);
  expect(network.problems).toEqual([]);
});

test('PublishedPolymorphicSeriesRetainsDerivedFields', async ({ page }) => {
  const network = await open(page);
  // Written through the SeriesOption base, read back by getOption and the registered typed readers.
  await expect(page.getByTestId('series')).toHaveText([
    'LineSeriesOption smooth=true symbol="diamond"', 'BarSeriesOption barWidth=18', 'ScatterSeriesOption datasetIndex=0',
    'PieSeriesOption radius=[0,36] center=["88%","22%"]', 'WordCloudSeriesOption gridSize=4 shape="circle"'].join(';'));
  const native = await page.evaluate(async loader => {
    const runtime = (await import(new URL(loader, document.baseURI).href)).getECharts();
    const mixed = runtime.getInstanceByDom(document.querySelector('.mixed-chart')).getOption();
    const cloud = runtime.getInstanceByDom(document.querySelector('.cloud-chart')).getOption();
    const [line, bar, , pie] = mixed.series;
    return { types: [...mixed.series, ...cloud.series].map((series: { type: string }) => series.type),
      line: [line.smooth, line.symbol, line.symbolSize], bar: bar.barWidth, pie: [pie.radius, pie.center],
      cloud: [cloud.series[0].gridSize, cloud.series[0].shape, cloud.series[0].sizeRange] };
  }, loader);
  expect(native).toEqual({ types: ['line', 'bar', 'scatter', 'pie', 'wordCloud'], line: [true, 'diamond', 9], bar: 18,
    pie: [[0, 36], ['88%', '22%']], cloud: [4, 'circle', [12, 40]] });
  expect(network.problems).toEqual([]);
});

// Regression: WebAssembly AOT compiled the interface-only writers of these containers as shared generic code,
// where a Nullable<T> passed by value faulted with "null function" and stopped the .NET runtime.
test('PublishedValueTypeContainersSerialize', async ({ page }) => {
  const network = await open(page);
  const native = await page.evaluate(async loader => {
    const option = (await import(new URL(loader, document.baseURI).href)).getECharts().getInstanceByDom(document.querySelector('.mixed-chart')).getOption();
    const pie = option.series[3];
    return { xAxis: [option.xAxis[0].type, option.xAxis[0].data], yAxis: option.yAxis[0].type, padding: option.legend[0].padding,
      selected: option.legend[0].selected, pie: [pie.center, pie.radius], line: option.series[0].data };
  }, loader);
  expect(native).toEqual({ xAxis: ['category', ['A', 'B', 'C', 'D']], yAxis: 'value', padding: [4, 8],
    selected: { bar: true, custom: true }, pie: [['88%', '22%'], [0, 36]], line: [3, null, { value: 4 }, 7] });
  expect(network.problems).toEqual([]);
});

test('CustomJsonTypeInfoDataRenders', async ({ page }) => {
  const network = await open(page);
  const rendered = await page.evaluate(async loader => {
    const chart = (await import(new URL(loader, document.baseURI).href)).getECharts().getInstanceByDom(document.querySelector('.mixed-chart'));
    const data = chart.getModel().getSeriesByIndex(2).getData();
    const points = [];
    for (let i = 0; i < data.count(); i++) points.push({ x: data.get('x', i), y: data.get('y', i), shown: !!data.getItemGraphicEl(i) });
    return { source: chart.getOption().dataset[0].source, points };
  }, loader);
  // Property names come from the consumer's source-generated metadata: camelCase plus [JsonPropertyName("tag")].
  expect(rendered.source).toEqual([{ x: 0, y: 4, tag: 'alpha' }, { x: 1, y: 9, tag: 'beta' }, { x: 2, y: 6, tag: 'gamma' }, { x: 3, y: 11, tag: 'delta' }]);
  expect(rendered.points).toEqual([{ x: 0, y: 4, shown: true }, { x: 1, y: 9, shown: true }, { x: 2, y: 6, shown: true }, { x: 3, y: 11, shown: true }]);
  expect(network.problems).toEqual([]);
});

test('PublishedEventPayloadDeserializes', async ({ page }) => {
  const network = await open(page);
  const bar = await pixel(page, 1, [1, 14]);
  await page.mouse.click(bar.x, bar.y);
  await expect(page.getByTestId('last-click')).toHaveText('bar|bar|B|1|18');
  const custom = await pixel(page, 2, [1, 9]);
  await page.mouse.click(custom.x, custom.y);
  // The event value is the consumer's own data object, as the chart received it.
  await expect(page.getByTestId('last-click')).toHaveText('scatter|custom|B|1|{"x":1,"y":9,"tag":"beta"}');
  await expect(page.getByTestId('clicks')).toHaveText('2');
  await page.getByRole('button', { name: 'Toggle legend' }).click();
  await expect(page.getByTestId('legend')).toHaveText('legendselectchanged|line|bar=True,custom=True,line=False');

  const subscribed = await statistics(page);
  await page.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(page.getByTestId('status')).toHaveText('unsubscribed');
  expect((await statistics(page)).subscriptions).toBe(subscribed.subscriptions - 2);
  await page.evaluate(async loader => {
    const chart = (await import(new URL(loader, document.baseURI).href)).getECharts().getInstanceByDom(document.querySelector('.mixed-chart'));
    (window as any).nativeClicks = 0;
    chart.on('click', () => (window as any).nativeClicks++);
  }, loader);
  // The hidden line series rescaled the axis: find the bar again, so the click reaches it.
  const moved = await pixel(page, 1, [1, 14]);
  await page.mouse.click(moved.x, moved.y);
  await expect.poll(() => page.evaluate(() => (window as any).nativeClicks)).toBe(1);
  // An ordered round trip: the next .NET event handler runs after any chart event the click had queued.
  await page.getByRole('button', { name: 'Toggle legend' }).click();
  await expect.poll(() => page.evaluate(async loader => (await import(new URL(loader, document.baseURI).href)).getECharts()
    .getInstanceByDom(document.querySelector('.mixed-chart')).getModel().getComponent('legend').isSelected('line'), loader)).toBe(true);
  await expect(page.getByTestId('clicks')).toHaveText('2');
  expect(network.problems).toEqual([]);
});

test('PublishedSnapshotUnionsDecodeAfterMouseInteraction', async ({ page }) => {
  const network = await open(page);
  // A real click on the legend item hides the line series; the snapshot then carries the changed selection.
  await page.locator('.mixed-chart').scrollIntoViewIfNeeded();
  const item = await page.evaluate(async loader => {
    const element = document.querySelector('.mixed-chart')!;
    const chart = (await import(new URL(loader, document.baseURI).href)).getECharts().getInstanceByDom(element);
    let point: { x: number; y: number } | undefined;
    chart.getViewOfComponentModel(chart.getModel().getComponent('legend')).group.traverse((node: any) => {
      if (node.type !== 'text' || node.style.text !== 'line') return;
      const rect = node.getBoundingRect().clone();
      rect.applyTransform(node.getComputedTransform());
      point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const box = element.getBoundingClientRect();
    return { x: box.left + point!.x, y: box.top + point!.y };
  }, loader);
  await page.mouse.click(item.x, item.y);
  await expect(page.getByTestId('legend')).toHaveText('legendselectchanged|line|bar=True,custom=True,line=False');
  await page.getByRole('button', { name: 'Read unions' }).click();
  await expect(page.getByTestId('status')).toHaveText('unions');
  // Every union value of the snapshot decodes through its generated TryGet in the trimmed and the AOT build.
  await expect(page.getByTestId('unions')).toHaveText('line=3,null,item:4,7 symbol=diamond size=9 smooth=True barWidth=18 bar=12,18,9,15 '
    + 'center=88%,22% radius=0,36 pie=3,5 dimensions=x,y,tag selected=bar=True,custom=True,line=False');
  expect(network.problems).toEqual([]);
});

test('PublishedFunctionsLeasesAndExportsWork', async ({ page }) => {
  const network = await open(page);
  // Exports ran after stable rendering; the SVG carries the module formatter's labels.
  const svg = await page.getByTestId('svg-export').textContent();
  expect(svg).toContain('<svg');
  for (const label of ['v=12', 'v=18', 'v=9', 'v=15']) expect(svg).toContain(label);
  expect(Number(await page.getByTestId('png-length').innerText())).toBeGreaterThan(1_000);
  expect(await countColorPixels(page, (await page.getByTestId('png-export').textContent())!, '#2f5d8a')).toBeGreaterThan(1_000);
  const placed = await page.evaluate(async loader => {
    const data = (await import(new URL(loader, document.baseURI).href)).getECharts().getInstanceByDom(document.querySelector('.cloud-chart'))
      .getModel().getSeriesByType('wordCloud')[0].getData();
    let placed = 0;
    for (let i = 0; i < data.count(); i++) if (data.getItemGraphicEl(i)) placed++;
    return placed;
  }, loader);
  expect(placed).toBe(20);

  const before = await statistics(page);
  await page.getByRole('button', { name: 'Snapshot references' }).click();
  await expect(page.getByTestId('status')).toHaveText('references-released');
  await expect(page.getByTestId('references')).toHaveText('references=1 bindings=1 labels=True gradient=True');
  const after = await statistics(page);
  // The gradient, its snapshot alias, the retained lease, the method result and the owned chart are all released.
  const owned = (s: Statistics) => ({ charts: s.charts, references: s.references, leases: s.leases, results: s.results, exports: s.exports });
  expect(owned(after)).toEqual(owned(before));

  await page.getByRole('button', { name: 'Measure serialization' }).click();
  await expect(page.getByTestId('status')).toHaveText('measured', { timeout: 60_000 });
  const measured = await page.getByTestId('serialization').innerText();
  expect(measured).toMatch(/^points=100000 medianMs=\d+(\.\d)?$/);
  test.info().annotations.push({ type: 'serialization', description: measured });
  expect(network.blocked).toEqual([]);
  expect(network.problems).toEqual([]);
});
