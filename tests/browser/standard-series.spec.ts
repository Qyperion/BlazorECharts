import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const partition = JSON.parse(readFileSync('docs/api-coverage/series-partition.json', 'utf8'));
const assigned = partition.series.filter((s: any) => s.group === 'standard').map((s: any) => s.name) as string[];

const counts: Record<string, number> = {
  bar: 2,
  boxplot: 2,
  candlestick: 2,
  effectScatter: 2,
  funnel: 2,
  gauge: 2,
  heatmap: 2,
  line: 2,
  lines: 2,
  map: 2,
  parallel: 2,
  pictorialBar: 2,
  pie: 2,
  radar: 2,
  scatter: 2,
  themeRiver: 4,
};

for (const mode of ['server', 'wasm']) {
  for (const name of assigned)
    test(`StandardSeriesCatalog_RendersEachDiscriminator ${name} ${mode}`, async ({ page }, info) => {
      // Arrange
      const issues: string[] = [];
      page.on('pageerror', e => issues.push(e.message));
      page.on('console', m => {
        if (['warning', 'error'].includes(m.type()))
          issues.push(m.text());
      });

      // Act
      await page.goto(`/harness/series/${mode}`);

      // Assert
      await expect(page.getByTestId('status')).toHaveText('ready:bar');
      expect(
        await page.getByLabel('Series').locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).sort())
      ).toEqual([...assigned].sort());

      // Act
      await page.getByLabel('Series').selectOption(name);

      // Assert
      await expect(page.getByTestId('status')).toHaveText('ready:' + name);

      // Act
      const state = await page.locator('.series-chart').evaluate(async el => {
        const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
        const c = ec.getInstanceByDom(el);
        const s = c.getModel().getSeriesByIndex(0);
        const v = c.getViewOfSeriesModel(s);
        let drawn = 0;
        v.group.traverse((node: any) => {
          if (!node.isGroup && !node.ignore && !node.invisible)
            drawn++;
        });
        return {
          version: ec.version,
          type: s.subType,
          id: s.id,
          count: s.getData().count(),
          drawn,
          callbacks: (window as any).seriesCallbackCalls ?? 0,
        };
      });

      // Assert
      expect(state.version).toBe('6.1.0');
      expect(state.type).toBe(name);
      expect(state.id).toBe(name);
      expect(state.count).toBe(counts[name]);
      expect(state.drawn).toBeGreaterThan(0);
      if (name === 'line')
        expect(state.callbacks).toBeGreaterThan(0);

      // Act
      await info.attach('actual-series.json', { body: JSON.stringify(state), contentType: 'application/json' });

      // Assert
      expect(issues).toEqual([]);
    });

  test(`StandardSeries_MixedDatasetUpdateWorks ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/series/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:bar');

    // Act
    const state = () => page.locator('.series-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      return c.getModel().getSeries().map((s: any) => {
        const d = s.getData();
        const dim = d.mapDimension('y');
        return { id: s.id, type: s.subType, values: Array.from({ length: d.count() }, (_, i) => d.get(dim, i)) };
      });
    });
    await page.getByRole('button', { name: 'Mixed', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('mixed');
    expect(await state()).toEqual([
      { id: 'trend', type: 'line', values: [2, 4] },
      { id: 'bars', type: 'bar', values: [2, 4] },
      { id: 'points', type: 'scatter', values: [3, 5] },
    ]);

    // Act
    await page.getByRole('button', { name: 'Update mixed', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('mixed-updated');
    expect(await state()).toEqual([{ id: 'trend', type: 'line', values: [4, 6] }, { id: 'bars', type: 'bar', values: [3, 5] }]);

    // Act
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('snapshot');

    // Act
    const snapshot = JSON.parse(await page.getByTestId('snapshot').textContent() ?? '{}');

    // Assert
    expect(snapshot.series.filter(Boolean).map((s: any) => s.id)).toEqual(['trend', 'bars']);
    expect(issues).toEqual([]);
  });

  test(`StandardSeries_EventsContainSourceData ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/series/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:bar');

    // Act
    await page.getByLabel('Series').selectOption('pie');

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:pie');

    // Act
    const point = await page.locator('.series-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const shape = c.getModel().getSeriesByIndex(0).getData().getItemGraphicEl(0).shape;
      const angle = (shape.startAngle + shape.endAngle) / 2;
      return { x: shape.cx + Math.cos(angle) * shape.r * .6, y: shape.cy + Math.sin(angle) * shape.r * .6 };
    });
    const box = (await page.locator('.series-chart').boundingBox())!;
    await page.mouse.click(box.x + point.x, box.y + point.y);

    // Assert
    await expect(page.getByTestId('typed-event')).toHaveText('pie|pie|0|A');
    await expect(page.getByTestId('selection')).toHaveText('True|0');

    // Act
    const payload = JSON.parse(await page.getByTestId('event').textContent() ?? '{}');

    // Assert
    expect(payload.seriesId).toBe('pie');
    expect(payload.value).toBe(3);
    expect(payload.color).toBe('#2480cc');
    expect(payload.data.itemStyle.color).toBe('#2480cc');
    expect(payload.data.meta).toEqual({ source: 'synthetic', flag: false });
    expect(issues).toEqual([]);
  });
}
