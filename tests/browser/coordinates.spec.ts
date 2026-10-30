import { test, expect } from '@playwright/test';

for (const mode of ['server', 'wasm']) {
  test(`Coordinates_PreserveTimeLogAndMultipleAxes ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/coordinates/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    const state = await page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const m = c.getModel();
      return {
        version: ec.version,
        x: m.getComponent('xAxis', 0).axis.scale.type,
        y: m.getComponent('yAxis', 0).axis.scale.type,
        series: m.getSeries().map(
          (s: any) => ({ count: s.getData().count(), x: s.coordinateSystem.getAxis('x').model.id, y: s.coordinateSystem.getAxis('y').model.id })
        ),
        callbackCount: (window as any).componentTimeLabels,
        drawn: c.getZr().storage.getDisplayList().length,
        aria: el.getAttribute('aria-label'),
      };
    });

    // Assert
    expect(state.version).toBe('6.1.0');
    expect(state.x).toBe('time');
    expect(state.y).toBe('log');
    expect(state.series).toEqual([{ count: 3, x: 'time', y: 'log' }, { count: 3, x: 'category', y: 'value' }]);
    expect(state.callbackCount).toBeGreaterThan(0);
    expect(state.drawn).toBeGreaterThan(10);
    expect(state.aria).toContain('Synthetic');
    expect(issues).toEqual([]);
  });

  for (const coordinate of ['polar', 'calendar', 'single', 'parallel', 'radar', 'matrix', 'geo']) {
    test(`Coordinates_Render_${coordinate} ${mode}`, async ({ page }) => {
      // Arrange
      const issues: string[] = [];
      page.on('pageerror', e => issues.push(e.message));
      page.on('console', m => {
        if (['warning', 'error'].includes(m.type()))
          issues.push(m.text());
      });
      await page.goto(`/harness/coordinates/${mode}`);
      await expect(page.getByTestId('status')).toHaveText('ready');

      // Act
      await page.getByLabel('Coordinate system').selectOption(coordinate);

      // Assert
      await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
        const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
        return ec.getInstanceByDom(el).getModel().getSeriesByIndex(0).coordinateSystem.type;
      })).toBe(coordinate);
      await expect(page.getByTestId('status')).toHaveText('ready');

      // Act
      const count = await page.locator('.component-chart').evaluate(async el => {
        const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
        const c = ec.getInstanceByDom(el);
        return { data: c.getModel().getSeriesByIndex(0).getData().count(), display: c.getZr().storage.getDisplayList().length };
      });

      // Assert
      expect(count.data).toBeGreaterThan(0);
      expect(count.display).toBeGreaterThan(0);
      expect(issues).toEqual([]);
    });
  }
}

for (const mode of ['server', 'wasm']) {
  test(`LargeSnapshot_OverTheDefaultServerLimit_IsResultTooLarge ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    await page.goto(`/harness/coordinates/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Large snapshot', exact: true }).click();

    // Assert
    // Server: the default 32 KiB limit rejects the snapshot in the browser and the circuit keeps working; WASM has no limit.
    await expect(page.getByTestId('status')).toHaveText(
      mode === 'server' ? /^snapshot-failed:\[ResultTooLarge\] width:\d+$/ : /^snapshot-ok width:\d+$/
    );
    expect(issues).toEqual([]);
  });
}
