import { test, expect } from '@playwright/test';
import { loadSchema } from '../../tools/BindingGenerator/src/schema.ts';

const schema = loadSchema();
const expected = schema.series.map((s: { name: string }) => s.name).sort() as string[];

for (const mode of ['server', 'wasm']) {
  test(`GraphicGeometry_ReservedKindsRemainExplicitNativeFailures ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/all-series/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:bar');

    // Act
    const errors = await page.evaluate(async () => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      return ['path', 'compoundPath'].map(type => {
        const el = document.createElement('div');
        el.style.cssText = 'width:300px;height:200px';
        document.body.append(el);
        const chart = ec.init(el);
        try {
          chart.setOption({ animation: false, graphic: [{ type, shape: { paths: [] } }] });
          return { type, error: '' };
        } catch (error) {
          return { type, error: String(error) };
        } finally {
          chart.dispose();
          el.remove();
        }
      });
    });

    // Assert
    expect(errors.map(e => e.type)).toEqual(['path', 'compoundPath']);
    for (const error of errors)
      expect(error.error).toMatch(/can not be found|not a constructor/);
  });

  test(`GraphicGeometry_TypedShapesReachPinnedNativeRuntime ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/all-series/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:bar');

    // Act
    await page.getByRole('button', { name: 'Graphic geometry', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:graphics');

    // Act
    const state = await page.locator('.complete-series-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const chart = ec.getInstanceByDom(el);
      const model = chart.getModel().getComponent('graphic');
      const view = chart.getViewOfComponentModel(model);
      return {
        version: ec.version,
        elements: model.option.elements.map((option: any) => {
          const native = view._elMap.get(option.id);
          const bounds = native.getBoundingRect();
          return {
            id: option.id,
            type: native.type,
            width: bounds.width,
            height: bounds.height,
            r: native.shape.r,
            clockwise: native.shape.clockwise,
          };
        }),
        during: (window as any).graphicGeometryDuringCalls ?? 0,
      };
    });

    // Assert
    expect(state.version).toBe('6.1.0');
    expect(state.elements).toHaveLength(10);
    expect(state.elements.find((e: any) => e.id === 'arc')).toMatchObject({ type: 'arc', r: 30, clockwise: false });
    for (const element of state.elements) {
      expect(element.width, element.id).toBeGreaterThan(0);
      expect(element.height, element.id).toBeGreaterThan(0);
    }

    expect(state.during).toBeGreaterThan(0);
    expect(issues).toEqual([]);
  });

  test(`SeriesCatalog_FunnelComparatorAndCustomDataItemsReachRuntime ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/all-series/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:bar');

    // Act
    await page.getByLabel('Series').selectOption('funnel');

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:funnel');

    // Act
    const funnel = await page.locator('.complete-series-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const data = ec.getInstanceByDom(el).getModel().getSeriesByIndex(0).getData();
      const top = (i: number) => Math.min(...data.getItemLayout(i).points.map((p: number[]) => p[1]));
      return { calls: (window as any).funnelSortCalls ?? 0, names: [data.getName(0), data.getName(1)], topA: top(0), topB: top(1) };
    });

    // Assert
    expect(funnel.calls).toBeGreaterThan(0);
    expect(funnel.names).toEqual(['A', 'B']);
    expect(funnel.topB).toBeLessThan(funnel.topA);

    // Act
    await page.getByLabel('Series').selectOption('custom');

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:custom');

    // Act
    const custom = await page.locator('.complete-series-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const data = ec.getInstanceByDom(el).getModel().getSeriesByIndex(0).getData();
      return { values: [data.getValues(0), data.getValues(1)], name: data.getName(1), groupId: data.getRawDataItem(1).groupId };
    });

    // Assert
    expect(custom).toEqual({ values: [[1, 2], [3, 4]], name: 'B', groupId: 'pair' });
    expect(issues).toEqual([]);
  });

  test(`CompleteSeriesCatalog_AllPinnedDiscriminators ${mode}`, async ({ page }, info) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });

    // Act
    await page.goto(`/harness/all-series/${mode}`);

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:bar');
    expect(await page.getByLabel('Series').locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).sort())).toEqual(
      expected
    );

    // Act
    const evidence: unknown[] = [];

    // Assert
    for (const name of expected) {
      await page.mouse.move(0, 0);
      await page.getByLabel('Series').selectOption(name);
      await expect(page.getByTestId('status')).toHaveText('ready:' + name);
      const state = await page.locator('.complete-series-chart').evaluate(async el => {
        const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
        const chart = ec.getInstanceByDom(el);
        const model = chart.getModel().getSeriesByIndex(0);
        let drawn = 0;
        chart.getViewOfSeriesModel(model).group.traverse((node: any) => {
          if (!node.isGroup && !node.ignore && !node.invisible)
            drawn++;
        });
        return { version: ec.version, type: model.subType, id: model.id, count: model.getData().count(), drawn };
      });
      expect(state.version).toBe('6.1.0');
      expect(state.type).toBe(name);
      expect(state.id).toBe(name);
      expect(state.count).toBe(Number(await page.getByTestId('expected-count').textContent()));
      expect(state.drawn).toBeGreaterThan(0);
      evidence.push(state);
      expect(issues, name).toEqual([]);
    }

    await info.attach('complete-series-catalog.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  });
}
