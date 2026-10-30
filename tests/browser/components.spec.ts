import { test, expect } from '@playwright/test';

for (const mode of ['server', 'wasm']) {
  for (const form of ['keyed', 'objects', 'native'])
    test(`Datasets_Preserve_${form}_Source ${mode}`, async ({ page }) => {
      // Arrange
      const issues: string[] = [];
      page.on('pageerror', e => issues.push(e.message));
      await page.goto(`/harness/components/${mode}`);
      await expect(page.getByTestId('status')).toHaveText('ready');

      // Act
      await page.getByLabel('Dataset form').selectOption(form);

      // Assert
      await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
        const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
        const c = ec.getInstanceByDom(el);
        const d = c.getModel().getSeriesByIndex(0).getData();
        const source = c.getOption().dataset[0].source;
        return {
          values: Array.from({ length: d.count() }, (_, i) => d.get('amount', i)),
          kind: ArrayBuffer.isView(source) ? source.constructor.name : Array.isArray(source) ? 'objects' : 'keyed',
        };
      })).toEqual({ values: [1, 10, 100], kind: form === 'native' ? 'Float64Array' : form });
      if (form === 'native') {
        await page.getByRole('button', { name: 'Reapply snapshot', exact: true }).click();
        await expect(page.getByTestId('status')).toHaveText('snapshot-reapplied');
        const kind = await page.locator('.component-chart').evaluate(async el => {
          const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
          return ec.getInstanceByDom(el).getOption().dataset[0].source.constructor.name;
        });
        expect(kind).toBe('Float64Array');
      }

      expect(issues).toEqual([]);
    });

  test(`DatasetMediaAndAria_PreserveShape ${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/components/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Transforms', exact: true }).click();

    // Assert
    await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const d = ec.getInstanceByDom(el).getModel().getSeriesByIndex(0).getData();
      return Array.from({ length: d.count() }, (_, i) => d.get('amount', i));
    })).toEqual([100, 10]);

    // Act
    const prepared = JSON.parse(await page.getByTestId('prepared').textContent() ?? '{}');

    // Assert
    expect(prepared.dataset[1].transform.map((t: any) => t.type)).toEqual(['filter', 'sort']);

    // Act
    await page.getByRole('button', { name: 'Media', exact: true }).click();

    // Assert
    await expect(page.getByTestId('prepared')).toContainText('Compact axes');

    // Act
    await page.setViewportSize({ width: 500, height: 800 });
    await page.getByRole('button', { name: 'Resize', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('resized');

    // Act
    const title = await page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      return ec.getInstanceByDom(el).getOption().title[0].text;
    });

    // Assert
    expect(title).toBe('Compact axes');
    expect(errors).toEqual([]);
  });

  test(`VisualMap_TypedChannelsDriveRuntimeVisuals ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/components/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Visual map', exact: true }).click();

    // Assert
    await expect(page.getByTestId('prepared')).toContainText('Warden');

    // Act
    const prepared = JSON.parse(await page.getByTestId('prepared').textContent() ?? '{}');

    // Assert
    expect(prepared.visualMap[0].inRange).toEqual({ color: ['#000000', '#ffffff'], symbolSize: [10, 40] });
    expect(prepared.visualMap[1].inRange.color).toEqual({ Warden: '#ff0000', '': '#00ff00' });
    await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const series = [0, 1].map(i => {
        const d = c.getModel().getSeriesByIndex(i).getData();
        return Array.from({ length: d.count() }, (_, j) => ({ fill: d.getItemVisual(j, 'style').fill, size: d.getItemVisual(j, 'symbolSize') }));
      });
      return { series, controller: c.getOption().visualMap[0].controller.inRange.color };
    })).toEqual({
      series: [
        [{ fill: 'rgba(0,0,0,1)', size: 10 }, { fill: 'rgba(128,128,128,1)', size: 25 }, { fill: 'rgba(255,255,255,1)', size: 40 }],
        [{ fill: '#ff0000', size: 12 }, { fill: '#00ff00', size: 30 }, { fill: '#00ff00', size: 12 }],
      ],
      controller: ['#336699', '#99ccff'],
    });
    expect(issues).toEqual([]);
  });

  test(`Timeline_BaseOptionStepsAndTypedChangeAction ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/components/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();

    // Assert
    await expect(page.getByTestId('prepared')).toContainText('baseOption');

    // Act
    const prepared = JSON.parse(await page.getByTestId('prepared').textContent() ?? '{}');

    // Assert
    expect(prepared.baseOption.timeline.data).toEqual(['2024', '2025', '2026']);
    expect(prepared.options.map((o: any) => o.series.data)).toEqual([[1, 2, 3], [10, 20, 30], [100, 200, 300]]);

    // Act
    const state = () => page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const m = c.getModel();
      const timeline = m.getComponent('timeline');
      const d = m.getSeriesByIndex(0).getData();
      return {
        index: timeline.getCurrentIndex(),
        steps: timeline.getData().count(),
        rendered: c.getViewOfComponentModel(timeline).group.childCount() > 0,
        values: Array.from({ length: d.count() }, (_, i) => d.get(d.mapDimension('y'), i)),
      };
    });

    // Assert
    await expect.poll(state).toEqual({ index: 0, steps: 3, rendered: true, values: [1, 2, 3] });

    // Act
    await page.getByRole('button', { name: 'Timeline step', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('timeline:2');
    await expect.poll(state).toEqual({ index: 2, steps: 3, rendered: true, values: [100, 200, 300] });
    expect(issues).toEqual([]);
  });

  test(`SeriesMarkers_PointLineAndAreaRenderOnBar ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/components/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Markers', exact: true }).click();

    // Assert
    await expect(page.getByTestId('prepared')).toContainText('markArea');
    await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const m = c.getModel();

      // Rendered marker elements point to the per-series marker model that holds the computed data.
      return Object.fromEntries(['markPoint', 'markLine', 'markArea'].map(type => {
        let model: any;
        c.getViewOfComponentModel(m.getComponent(type)).group.traverse((el: any) => { model ??= ec.helper.getECData(el).dataModel; });
        const d = model?.getData();
        return [type, d ? Array.from({ length: d.count() }, (_, i) => ({ name: d.getName(i), value: model.getRawValue(i) })) : null];
      }));
    })).toEqual({
      markPoint: [{ name: 'Highest', value: 36 }, { name: 'Lowest', value: 5 }],
      markLine: [{ name: 'Average', value: 17.75 }, { name: '' }],
      markArea: [{ name: 'Peak' }],
    });
    expect(issues).toEqual([]);
  });

  test(`Thumbnail_ShowsGraphInItsWindow ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/components/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Thumbnail', exact: true }).click();

    // Assert
    await expect(page.getByTestId('prepared')).toContainText('thumbnail');
    await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const thumbnail = c.getModel().getComponent('thumbnail');
      const view = c.getViewOfComponentModel(thumbnail);
      const box = view.group.getBoundingRect();

      // The frame and the window rectangle are always drawn; the graph copy is in the target group.
      let graph = 0;
      view._targetGroup.traverse((el: any) => {
        if (!el.isGroup)
          graph++;
      });
      return {
        width: thumbnail.get('width'),
        rendered: box.width > 0 && box.height > 0,
        graph: graph >= c.getModel().getSeriesByIndex(0).getData().count() + 2,
      };
    })).toEqual({ width: '30%', rendered: true, graph: true });
    expect(issues).toEqual([]);
  });

  test(`Components_InteractAndSnapshotThroughTypedContracts ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/components/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Components', exact: true }).click();

    // Assert
    await expect(page.getByTestId('prepared')).toContainText('dataZoom');
    await expect.poll(() => page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      return ec.getInstanceByDom(el).getOption().legend?.[0]?.data;
    })).toEqual(['first', 'second']);

    // Act
    const point = await page.locator('.component-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const view = c.getViewOfComponentModel(c.getModel().getComponent('legend'));
      let point: any;
      view.group.traverse((node: any) => {
        if (node.type === 'text' && node.style.text === 'second') {
          const rect = node.getBoundingRect().clone();
          rect.applyTransform(node.getComputedTransform());
          point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      });
      return point;
    });

    // Assert
    expect(point).toEqual({ x: expect.any(Number), y: expect.any(Number) });

    // Act
    const box = (await page.locator('.component-chart').boundingBox())!;
    await page.mouse.click(box.x + point.x, box.y + point.y);
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('snapshot');

    // Act
    const snapshot = JSON.parse(await page.getByTestId('snapshot').textContent() ?? '{}');

    // Assert
    expect(snapshot.legend[0].selected.second).toBe(false);
    expect(snapshot.dataZoom).toHaveLength(2);
    expect(snapshot.grid.map((g: any) => g.id)).toEqual(['left', 'right']);
    expect(issues).toEqual([]);
  });
}
