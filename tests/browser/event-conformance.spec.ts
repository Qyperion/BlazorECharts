import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { conformance, typedEvents } from './event-conformance/contract.ts';

// The payloads of these scenarios, read by every typed member in EventPayloadReadTests (xUnit).
// BLAZOR_ECHARTS_UPDATE_EVENT_FIXTURE=1 rewrites it; otherwise its JSON shapes must match the captured ones.
const fixture = 'tests/BlazorECharts.Tests/Fixtures/echarts-6.1.0-events.json';

// The number of ECharts' makeInner store (__ec_inner_N) depends on module initialization order.
const skeleton = (value: unknown): unknown => Array.isArray(value) ? value.map(skeleton)
  : value && typeof value === 'object' ? Object.fromEntries(
    Object.keys(value).sort().map(k => [k.replace(/^__ec_inner_\d+$/, '__ec_inner'), skeleton((value as Record<string, unknown>)[k])])
  )
    : value === null ? null : typeof value;

const shapes = (payloads: Payloads) => Object.fromEntries(Object.keys(payloads).sort().map(name =>
  [name, [...new Set(payloads[name].map(p => JSON.stringify(skeleton(p))))].sort()]));

let bundle: Promise<string> | undefined;

const scenarios = () => bundle ??= build({
  entryPoints: ['tests/browser/event-conformance/scenarios.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
}).then(result => result.outputFiles[0].text);

async function open(page: Page) {
  const body = await scenarios();
  await page.route('**/__test/event-conformance.js', route => route.fulfill({ contentType: 'text/javascript', body }));
  await page.route('**/__test/events.html', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><base href="/"></head><body style="margin:0"></body></html>`,
  }));
  await page.goto(`/__test/events.html`);
}

type Payloads = Record<string, { json: unknown; references: unknown }[]>;

test('EventPayloads_MatchTheTypedEventContracts', async ({ page }) => {
  // Arrange
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const { captured: actions, rejectedBatches }: { captured: Payloads; rejectedBatches: string[] } = await page.evaluate(async () => {
    const echarts = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    const harness = await import(new URL('__test/event-conformance.js', document.baseURI).href);
    (window as any).conformance = { echarts, harness };
    return harness.runActionScenarios(echarts);
  });
  const { bar, outside } = await page.evaluate(() => {
    const { echarts, harness } = (window as any).conformance;
    return harness.mountPointerChart(echarts);
  });
  await page.mouse.move(bar.x - 30, bar.y - 30);
  await page.mouse.move(bar.x, bar.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.dblclick(bar.x, bar.y);
  await page.mouse.click(bar.x, bar.y, { button: 'right' });
  await page.mouse.move(outside.x, outside.y, { steps: 3 });
  const pointer: Payloads = await page.evaluate(() => (window as any).conformance.harness.collectPointerEvents());

  // Act
  const payloads: Payloads = { ...actions, ...pointer };

  // Assert
  expect(errors).toEqual([]);

  // Act
  const report = conformance(payloads);
  mkdirSync('artifacts/event-conformance', { recursive: true });
  writeFileSync('artifacts/event-conformance/report.json', JSON.stringify({ ...report, rejectedBatches }, null, 2) + '\n');
  const sorted = Object.fromEntries(Object.keys(payloads).sort().map(name => [name, payloads[name]]));
  if (process.env.BLAZOR_ECHARTS_UPDATE_EVENT_FIXTURE === '1')
    writeFileSync(fixture, JSON.stringify(sorted, null, 1) + '\n');

  // Assert
  expect(Object.keys(typedEvents())).toHaveLength(52);
  expect(Object.keys(typedEvents()).filter(name => !payloads[name]?.length), 'events that no scenario emitted').toEqual([]);
  expect(rejectedBatches).toEqual([]);
  expect(report.failures).toEqual([]);
  expect(shapes(JSON.parse(readFileSync(fixture, 'utf8'))), `${fixture} is stale: run this spec with BLAZOR_ECHARTS_UPDATE_EVENT_FIXTURE=1`).toEqual(
    shapes(sorted)
  );
});
