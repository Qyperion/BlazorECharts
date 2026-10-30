import { test, expect, type Page } from '@playwright/test';
import { chartResources, installChartResourceCounters } from './chart-resources.ts';

interface Statistics {
  facades: number;
  charts: number;
  observations: number;
  subscriptions: number;
  exports: number;
  results: number;
  references: number;
  leases: number;
  groupMembers: number;
  toBrowser: Record<string, number>;
  toDotNet: Record<string, number>;
}

// Page-wide registry counters; reading them does not count as bridge traffic.
const statistics = (page: Page) => page.evaluate(async () =>
  (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href)).resourceStatistics()) as Promise<Statistics>;

async function owned(page: Page) {
  const { toBrowser, toDotNet, ...registry } = await statistics(page);
  const observers = await chartResources(page);
  const live = await page.locator('[_echarts_instance_]:not([_echarts_instance_=""])').count();
  return { ...registry, resizeObservers: observers.resize, mutationObservers: observers.mutation, live };
}

const unhandled = async (page: Page) => (await chartResources(page)).errors as string[];

async function open(page: Page, mode: string, query = '') {
  await installChartResourceCounters(page);
  await page.goto(`/harness/resources/${mode}${query}`);
  await expect(page.getByTestId('interactive')).toHaveText('True');
}

async function mount(page: Page, count = 1) {
  await page.getByRole('button', { name: count === 1 ? 'Mount chart' : 'Mount four charts', exact: true }).click();
  await expect(page.getByTestId('ready-count')).toHaveText(String(count));
  await expect(page.locator('.resource-chart[data-chart-state="Ready"]')).toHaveCount(count);
}

async function unmount(page: Page) {
  await page.getByRole('button', { name: 'Unmount charts', exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText('unmounted');
}

async function run(page: Page, button: string, status: string, timeout = 60_000) {
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText(`${status}: done`, { timeout });
  return JSON.parse(await page.getByTestId('result').innerText() || '{}');
}

const frames = (page: Page, count = 2) => page.evaluate(
  n => new Promise<void>(resolve => {
    const step = (left: number) => left ? requestAnimationFrame(() => step(left - 1)) : resolve();
    step(n);
  }),
  count
);

const nativeOption = (page: Page) => page.locator('.resource-chart').first().evaluate(async element => {
  const bridge = await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href);
  const option = bridge.getECharts().getInstanceByDom(element).getOption();
  return { title: option.title[0].text as string, first: option.series[0].data[0] as number };
});

for (const mode of ['server', 'wasm']) {
  test(`RepeatedMountLeavesNoOwnedResources ${mode}`, async ({ page }, info) => {
    // Arrange
    test.setTimeout(240_000);

    await open(page, mode);
    await mount(page);

    // Act
    await unmount(page);

    // Assert
    await expect.poll(async () => (await owned(page)).charts).toBe(0);

    // Act
    const baseline = await owned(page);
    const before = await statistics(page);

    await page.getByRole('button', { name: 'Run churn', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('churn: done', { timeout: 200_000 });
    await expect(page.getByTestId('cycles')).toHaveText('100');

    await expect.poll(() => owned(page)).toEqual(baseline);
    expect(baseline).toMatchObject({
      charts: 0,
      observations: 0,
      subscriptions: 0,
      exports: 0,
      results: 0,
      references: 0,
      leases: 0,
      groupMembers: 0,
      live: 0,
    });
    await expect(page.getByTestId('error-count')).toHaveText('0');
    expect(await unhandled(page)).toEqual([]);

    // Act
    const after = await statistics(page);

    // Assert
    expect(after.toBrowser.createChart - before.toBrowser.createChart).toBe(100);
    expect(after.toBrowser.disposeChart - before.toBrowser.disposeChart).toBe(100);
    await info.attach('churn-statistics', { body: JSON.stringify({ baseline, before, after }, null, 2), contentType: 'application/json' });
  });

  test(`RepeatedNavigationLeavesNoOwnedResources ${mode}`, async ({ page }, info) => {
    // Arrange
    test.setTimeout(240_000);

    // Act
    await open(page, mode, '?mount=true');

    // Assert
    await expect(page.getByTestId('ready-count')).toHaveText('1');
    await expect.poll(async () => (await owned(page)).resizeObservers).toBe(1);

    // Act
    const baseline = await owned(page);

    // Assert
    for (let visit = 0; visit < 100; visit++) {
      await page.getByRole('link', { name: 'Away', exact: true }).click();
      await expect(page.getByTestId('away')).toHaveText(mode);
      await page.getByRole('link', { name: 'Back', exact: true }).click();
      await expect(page.getByTestId('ready-count')).toHaveText('1');
    }

    await expect.poll(() => owned(page)).toEqual(baseline);
    expect(baseline).toMatchObject({ charts: 1, observations: 1, subscriptions: 0, exports: 0, results: 0, references: 0, leases: 0, live: 1 });
    expect(await unhandled(page)).toEqual([]);
    await info.attach('navigation-statistics', {
      body: JSON.stringify({ baseline, final: await statistics(page) }, null, 2),
      contentType: 'application/json',
    });
  });

  test(`ResizeStaysInBrowserWithoutSubscription ${mode}`, async ({ page }) => {
    // Arrange
    await open(page, mode);
    await mount(page);
    await frames(page, 4);
    const before = await statistics(page);
    for (let i = 0; i < 20; i++) {
      await page.locator('.resource-host').evaluate((host, width) => { (host as HTMLElement).style.width = `${width}px`; }, i % 2 ? 640 : 420);
      await frames(page);
    }

    // Act
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.setViewportSize({ width: 1280, height: 720 });

    // Assert
    await expect.poll(() => page.locator('.resource-chart canvas').first().evaluate(c => (c as HTMLCanvasElement).style.width)).toBe('640px');

    // Act
    await frames(page, 4);
    const after = await statistics(page);

    // Assert
    expect(after.toDotNet).toEqual(before.toDotNet);
    expect(after.toBrowser).toEqual(before.toBrowser);

    // Act
    // Control: an explicit subscription is the only way resize work reaches .NET.
    await run(page, 'Subscribe finished', 'subscribe');
    await page.locator('.resource-host').evaluate(host => { (host as HTMLElement).style.width = '420px'; });

    // Assert
    await expect(page.getByTestId('finished-count')).not.toHaveText('0');
    expect((await statistics(page)).toDotNet.Deliver ?? 0).toBeGreaterThan(before.toDotNet.Deliver ?? 0);
    expect(await unhandled(page)).toEqual([]);
  });

  test(`LatestRevisionWinsWithoutLateCapture ${mode}`, async ({ page }) => {
    // Arrange
    await open(page, mode, '?renderer=svg');
    await mount(page);

    // Act
    const result = await run(page, 'Burst updates', 'burst');

    // Assert
    expect(result.patches).toBe(35);
    expect(result.exportTitles).toEqual(['export-20']);
    expect(await nativeOption(page)).toEqual({ title: 'export-20', first: result.expectedFirst });
    await expect(page.getByTestId('error-count')).toHaveText('0');
    expect(await unhandled(page)).toEqual([]);
  });

  test(`UpdateDuringStableAndExportCoversLatestRevision ${mode}`, async ({ page }) => {
    // Arrange
    await open(page, mode, '?renderer=svg');
    await mount(page);

    // Act
    const result = await run(page, 'Update during stable', 'update during stable');

    // Assert
    expect(result.stableTitles).toEqual(['after']);
    expect(result.exportTitles).toEqual(['after']);
    expect(await nativeOption(page)).toEqual({ title: 'after', first: result.expectedFirst });
    expect(await unhandled(page)).toEqual([]);
  });

  test(`DisposeDuringExportRejectsAndReleases ${mode}`, async ({ page }) => {
    // Arrange
    await open(page, mode);
    await mount(page);

    // Act
    const result = await run(page, 'Dispose during export', 'dispose during export');

    // Assert
    expect(['OperationCanceledException', 'TaskCanceledException', 'ObjectDisposedException']).toContain(result.outcome);
    await expect.poll(() => owned(page)).toMatchObject({ charts: 0, observations: 0, exports: 0, results: 0, references: 0, leases: 0, live: 0 });
    await expect(page.getByTestId('error-count')).toHaveText('0');
    expect(await unhandled(page)).toEqual([]);
  });

  test(`DisposeDuringWordCloudLayoutReleasesFacade ${mode}`, async ({ page }) => {
    // Arrange
    await open(page, mode);
    const baseline = await owned(page);

    // Act
    const result = await run(page, 'Dispose during layout', 'dispose during layout');

    // Assert
    expect(result.layoutWasRunning).toBe(true);
    await expect.poll(() => owned(page)).toEqual(baseline);
    expect(await unhandled(page)).toEqual([]);
  });

  test(`DisposeDuringImportWithConcurrentCharts ${mode}`, async ({ page }) => {
    // Arrange
    let release!: () => void;
    const pending = new Promise<void>(resolve => release = resolve);
    await page.route('**/echarts-6.1.0.js*', async route => {
      await pending;
      await route.continue();
    });
    await open(page, mode);

    // Act
    await page.getByRole('button', { name: 'Mount four charts', exact: true }).click();

    // Assert
    await expect(page.locator('.resource-chart[data-chart-state="Initializing"]')).toHaveCount(4);

    // Act
    await unmount(page);
    release();
    await mount(page, 4);

    // Assert
    expect(await owned(page)).toMatchObject({ charts: 4, observations: 4, live: 4, resizeObservers: 4 });

    // Act
    await unmount(page);

    // Assert
    await expect.poll(() => owned(page)).toMatchObject({ charts: 0, observations: 0, live: 0, resizeObservers: 0, mutationObservers: 0 });
    await expect(page.getByTestId('error-count')).toHaveText('0');
    expect(await unhandled(page)).toEqual([]);
  });
}
