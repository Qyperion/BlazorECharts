import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const partition = JSON.parse(readFileSync('docs/api-coverage/series-partition.json', 'utf8'));
const assigned = partition.series.filter((s: any) => s.group === 'advanced').map((s: any) => s.name) as string[];
const counts: Record<string, number> = { chord: 3, custom: 2, graph: 3, sankey: 3, sunburst: 5, tree: 5, treemap: 5 };

for (const mode of ['server', 'wasm']) {
  for (const name of assigned)
    test(`AdvancedCatalog_RendersEveryRemainingDiscriminator ${name} ${mode}`, async ({ page }, info) => {
      // Arrange
      const issues: string[] = [];
      page.on('pageerror', e => issues.push(e.message));
      page.on('console', m => {
        if (['warning', 'error'].includes(m.type()))
          issues.push(m.text());
      });

      // Act
      await page.goto(`/harness/advanced/${mode}`);

      // Assert
      await expect(page.getByTestId('status')).toHaveText('ready:graph');
      expect(
        await page.getByLabel('Series').locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).sort())
      ).toEqual([...assigned].sort());

      // Act
      await page.getByLabel('Series').selectOption(name);

      // Assert
      await expect(page.getByTestId('status')).toHaveText('ready:' + name);

      // Act
      const state = await page.locator('.advanced-chart').evaluate(async el => {
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
          custom: (window as any).customRenderEvidence ?? null,
        };
      });

      // Assert
      expect(state.version).toBe('6.1.0');
      expect(state.type).toBe(name);
      expect(state.id).toBe(name);
      expect(state.count).toBe(counts[name]);
      expect(state.drawn).toBeGreaterThan(0);
      if (name === 'custom') {
        expect(state.custom.calls).toBeGreaterThanOrEqual(2);
        expect(state.custom.zr).toBe(true);
        expect(state.custom.sync).toBe(true);
        expect(state.custom.params).toEqual(['custom', 0, 2, 'cartesian2d']);
        expect(state.custom.result).toEqual(['group', 'rect', 'text']);
      }

      // Act
      await page.getByRole('button', { name: 'Update', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('updated:' + name);

      // Act
      await page.getByRole('button', { name: 'Snapshot', exact: true }).click();

      // Assert
      await expect(page.getByTestId('status')).toHaveText('snapshot');

      // Act
      const snapshot = JSON.parse(await page.getByTestId('snapshot').textContent() ?? '{}');

      // Assert
      expect(snapshot.series[0].id).toBe(name);
      expect(snapshot.series[0].name).toBe('updated');

      // Act
      const updated = snapshot.series[0];

      // Assert
      if (['chord', 'sankey', 'graph'].includes(name))
        expect(updated.links[0].value).toBe(7);
      else if (name === 'custom')
        expect(updated.data[0]).toEqual([1, 7]);
      else if (name === 'tree')
        expect(updated.data[0].children[0].children[0].value).toBe(7);
      else
        expect(updated.data[0].children[0].value).toBe(7);

      if (name === 'sankey') {
        expect(updated.levels[0].edgeLabel.position).toBe('inside');
        expect(updated.levels[0].edgeLabel.distance).toBe(0);
        expect(updated.levels[0].emphasis.edgeLabel.position).toBe('inside');
      }

      // Act
      await info.attach('actual-series.json', { body: JSON.stringify(state), contentType: 'application/json' });

      // Assert
      expect(issues).toEqual([]);
    });

  test(`GraphHierarchyCustom_InteractionsPreserveData ${mode}`, async ({ page }) => {
    // Arrange
    const issues: string[] = [];
    page.on('pageerror', e => issues.push(e.stack ?? e.message));
    page.on('console', m => {
      if (['warning', 'error'].includes(m.type()))
        issues.push(m.text());
    });
    await page.goto(`/harness/advanced/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:graph');

    // Act
    const clickGraphic = async (edge: boolean) => {
      const point = await page.locator('.advanced-chart').evaluate(
        async (el, edge) => {
          const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
          const c = ec.getInstanceByDom(el);
          const s = c.getModel().getSeriesByIndex(0);
          const graphic = (edge ? s.getEdgeData() : s.getData()).getItemGraphicEl(0);
          const r = graphic.getBoundingRect().clone();
          r.applyTransform(graphic.getComputedTransform());
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
        edge
      );
      const box = (await page.locator('.advanced-chart').boundingBox())!;
      await page.mouse.click(box.x + point.x, box.y + point.y);
    };
    await clickGraphic(false);

    // Assert
    await expect(page.getByTestId('typed-event')).toHaveText('graph|graph|node|A');

    // Act
    const node = JSON.parse(await page.getByTestId('event').textContent() ?? '{}');

    // Assert
    expect(node.data.meta).toEqual({ source: 'synthetic', flag: false });
    expect(node.data.itemStyle.color).toBe('#2480cc');

    // Act
    await clickGraphic(true);

    // Assert
    await expect(page.getByTestId('typed-event')).toHaveText(/^graph\|graph\|edge\|/);

    // Act
    const edge = JSON.parse(await page.getByTestId('event').textContent() ?? '{}');

    // Assert
    expect(edge.data.source).toBe('a');
    expect(edge.data.target).toBe('b');
    expect(edge.value).toBe(3);

    // Act
    // Flush the old graph hover before replacing its series with a different data model.
    // ECharts 6.1.0 otherwise dispatches mouseout with stale edge data to the new treemap model.
    await page.mouse.move(0, 0);
    await page.getByLabel('Series').selectOption('treemap');

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:treemap');

    // Act
    await page.getByRole('button', { name: 'Drill', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('drilled');
    expect(await page.locator('.advanced-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const s = ec.getInstanceByDom(el).getModel().getSeriesByIndex(0);
      return { root: s.getViewRoot().name, count: s.getData().count() };
    })).toEqual({ root: 'A', count: 5 });

    // Act
    await page.getByRole('button', { name: 'Update', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('updated:treemap');
    expect(await page.locator('.advanced-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const s = ec.getInstanceByDom(el).getModel().getSeriesByIndex(0);
      return s.getData().getRawDataItem(2).value;
    })).toBe(7);
    expect(issues).toEqual([]);
  });

  test(`CustomRenderItem_UsesBrowserModuleAndZrReference ${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/advanced/${mode}`);
    await expect(page.getByTestId('status')).toHaveText('ready:graph');

    // Act
    await page.getByLabel('Series').selectOption('custom');

    // Assert
    await expect(page.getByTestId('status')).toHaveText('ready:custom');

    // Act
    await page.getByRole('button', { name: 'Zr reference', exact: true }).click();

    // Assert
    await expect(page.getByTestId('zr')).toHaveText('reference');
    expect(await page.locator('.advanced-chart').evaluate(async el => {
      const ec = await import('/_content/BlazorECharts/js/echarts-6.1.0.js');
      const c = ec.getInstanceByDom(el);
      const data = c.getModel().getSeriesByIndex(0).getData();
      const group = data.getItemGraphicEl(0);
      return {
        function: typeof c.getOption().series[0].renderItem,
        children: group.children().map((child: any) => child.type),
        text: group.childAt(1).style.text,
        zr: (window as any).customRenderEvidence.zr,
      };
    })).toEqual({ function: 'function', children: ['rect', 'text'], text: 'Value 2', zr: true });
  });
}
