import { test, expect } from '@playwright/test';
import { installChartResourceCounters, chartResources } from './chart-resources.ts';

async function state(page: any) {
  return page.evaluate(async () => {
    const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    const chart = ec.getInstanceByDom(document.querySelector('.update-chart'));
    return { id: chart.id, option: chart.getOption(), renderer: chart.getZr().painter.getType() };
  });
}

for (const mode of ['server', 'wasm'])
  test(`ThemeAndRendererChange_RestoresPrimitiveState_${mode}`, async ({ page, browser }, info) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await installChartResourceCounters(page);

    // Act
    await page.goto(`/harness/updates/${mode}`);

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('1');

    // Act
    await page.getByRole('button', { name: 'Patch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('patched');

    // Act
    const original = await state(page);
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.backgroundColor).not.toBe(original.option.backgroundColor);
    expect((await state(page)).id).toBe(original.id);

    // Exact 6.1.0 native setTheme replays the initial option backup. Snapshot the current state after theme.
    expect((await state(page)).option.customUnknown).toBeUndefined();

    // Act
    await page.getByRole('button', { name: 'Patch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('patched');
    await expect.poll(async () => (await state(page)).option.customUnknown).toEqual({ zero: 0, flag: false, empty: [] });
    for (let i = 0; i < 4; i++) {
      await page.evaluate(async () => {
        const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
        (window as any).previousNative = ec.getInstanceByDom(document.querySelector('.update-chart'));
      });
      await page.getByRole('button', { name: 'Toggle renderer', exact: true }).click();
      await expect.poll(async () => (await state(page)).renderer).toBe(i % 2 === 0 ? 'svg' : 'canvas');
      const current = await state(page);
      expect(current.id).not.toBe(original.id);
      expect(current.option.customUnknown).toEqual({ zero: 0, flag: false, empty: [] });
      expect(current.option.series[0].data).toEqual([4, 8, 3]);
      expect(await page.locator('.update-chart').locator('canvas,svg').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).previousNative.isDisposed())).toBe(true);
      expect(await chartResources(page)).toEqual({ resize: 1, mutation: 1, errors: [] });
    }

    // Act
    await page.getByRole('button', { name: 'Patch after recreate', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.series[0].data).toEqual([6, 6, 6]);
    expect(errors).toEqual([]);
    await expect(page.getByTestId('error-count')).toHaveText('0');

    // Act
    await page.locator('.update-chart').evaluate(element => element.remove());

    // Assert
    await expect.poll(() => chartResources(page)).toEqual({ resize: 0, mutation: 0, errors: [] });
    await info.attach('recreate-resources', {
      body: JSON.stringify({ browser: browser.version(), final: await chartResources(page) }),
      contentType: 'application/json',
    });
  });

for (const mode of ['server', 'wasm'])
  test(`RecreateBeforeFirstSnapshot_UsesLatestAcceptedConfiguration_${mode}`, async ({ page }) => {
    // Delay only the first native apply through the real JS interop return Promise.

    // Arrange
    await page.route('**/runtime-loader*.js*', async route => {
      const response = await route.fetch();
      const code = await response.text();
      await route.fulfill({
        response,
        body: code + `
      const apply = PageRuntime.prototype.setOption;
      const recreate = PageRuntime.prototype.recreateChart;
      window.acceptedCommands = [];
      PageRuntime.prototype.setOption = function(...args) {
        window.acceptedCommands.push(['setOption', args[2].json]);
        if (window.acceptedCommands.length === 1) return new Promise(resolve => {
          window.releaseInitial = () => resolve(apply.apply(this, args));
        });
        return apply.apply(this, args);
      };
      PageRuntime.prototype.recreateChart = function(...args) {
        window.acceptedCommands.push(['recreate', args[2]]); return recreate.apply(this, args);
      };`,
      });
    });

    // Act
    await page.goto(`/harness/updates/${mode}`);

    // Assert
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseInitial)).toBe('function');

    // Act
    await page.getByRole('button', { name: 'Toggle renderer', exact: true }).click();
    await page.getByRole('button', { name: 'New reference', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('new reference');

    // Act
    await page.getByRole('button', { name: 'Patch', exact: true }).click();
    await page.evaluate(() => (window as any).releaseInitial());

    // Assert
    await expect(page.getByTestId('status')).toHaveText('patched');
    await expect(page.getByTestId('ready')).toHaveText('1');

    // Act
    const current = await state(page);

    // Assert
    expect(current.renderer).toBe('svg');
    expect(current.option.series[0].data).toEqual([1, 5, 2]);
    expect(current.option.customUnknown).toEqual({ zero: 0, flag: false, empty: [] });
    expect(await page.evaluate(() => (window as any).acceptedCommands.map((c: any[]) => c[0]))).toEqual([
      'setOption', 'recreate', 'setOption', 'setOption',
    ]);
  });

for (const mode of ['server', 'wasm'])
  test(`Recreate_ThemeDefaultsFollowNewTheme_ExplicitColorsSurvive_${mode}`, async ({ page }) => {
    // Act
    await page.goto(`/harness/updates/${mode}`);

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('1');

    // Act
    const initial = await state(page);
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.backgroundColor).not.toBe(initial.option.backgroundColor);

    // Act
    await page.getByRole('button', { name: 'Theme and renderer', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).renderer).toBe('svg');
    expect((await state(page)).option.backgroundColor).toBe(initial.option.backgroundColor);
    expect((await state(page)).option.color).toEqual(initial.option.color);

    // Act
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.backgroundColor).not.toBe(initial.option.backgroundColor);

    // Act
    await page.getByRole('button', { name: 'Explicit colors', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('explicit colors');

    // Act
    await page.getByRole('button', { name: 'Theme and renderer', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).renderer).toBe('canvas');
    expect((await state(page)).option.backgroundColor).toBe('#123456');
    expect((await state(page)).option.color).toEqual(['#abcdef', '#fedcba']);

    // Act
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).option.darkMode).toBe(true);
    expect((await state(page)).option.backgroundColor).toBe('#123456');
    expect((await state(page)).option.color).toEqual(['#abcdef', '#fedcba']);
  });

for (const mode of ['server', 'wasm'])
  test(`HiddenTabRecreation_KeepsTheChartAndRecreatesWhenShown_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    // Act
    await page.goto(`/harness/updates/${mode}`);

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('1');

    // Act
    const original = await state(page);
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle renderer', exact: true }).click();
    await page.getByRole('button', { name: 'Patch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('patched');
    await expect(page.locator('.update-chart')).toHaveAttribute('data-chart-state', 'Ready');
    expect((await state(page)).id).toBe(original.id);
    await expect(page.getByTestId('error-count')).toHaveText('0');

    // Act
    await page.getByRole('button', { name: 'Show', exact: true }).click();

    // Assert
    await expect.poll(async () => (await state(page)).renderer).toBe('svg');

    // Act
    const shown = await state(page);

    // Assert
    expect(shown.id).not.toBe(original.id);
    expect(shown.option.customUnknown).toEqual({ zero: 0, flag: false, empty: [] });
    await expect(page.locator('.update-chart')).toHaveAttribute('data-chart-state', 'Ready');
    await expect(page.getByTestId('error-count')).toHaveText('0');
    await expect(page.getByTestId('ready')).toHaveText('1');
    expect(errors).toEqual([]);
  });
