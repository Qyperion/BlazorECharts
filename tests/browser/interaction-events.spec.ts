import { test, expect, type Page } from '@playwright/test';

// Typed actions and the events they emit in the real ECharts, read back through the typed .NET payloads.
const events = (page: Page) => page.getByTestId('events');

// How often each event type arrived during the last group: a summary keeps only the last event of a type.
const counts = (page: Page) => page.getByTestId('counts');
const once = (...types: string[]) => types.map(type => `${type} 1`).join('\n');

const native = <T>(page: Page, read: (chart: any) => T) => page.locator('.interaction-chart').evaluate(
  async (element: HTMLElement, body: string) => {
    const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    return new Function('chart', `return (${body})(chart);`)(ec.getInstanceByDom(element));
  },
  read.toString()
) as Promise<T>;

async function open(page: Page, mode: string) {
  const issues: string[] = [];
  page.on('pageerror', e => issues.push(e.message));
  page.on('console', m => {
    if (['warning', 'error'].includes(m.type()))
      issues.push(m.text());
  });
  await page.goto(`/harness/interactions/${mode}`);
  await expect(page.getByTestId('ready')).toHaveText('ready');
  return issues;
}

async function run(page: Page, button: string, status: string | RegExp) {
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText(status);
}

for (const mode of ['server', 'wasm']) {
  test(`LegendActions_EmitTypedSelectionAndScrollEvents_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Legend actions', 'legend');

    // Assert
    await expect(events(page)).toHaveText([
      'legendinverseselect 0|A=False,B=False,C=False,D=False,E=False,F=False',
      'legendscroll 3|legend',
      'legendselectall 0|A=True,B=True,C=True,D=True,E=True,F=True',
      'legendselected A|A=True,B=True,C=True,D=True,E=True,F=True',
      'legendunselected A|A=False,B=True,C=True,D=True,E=True,F=True',
    ].join('\n'));
    await expect(counts(page)).toHaveText(once('legendinverseselect', 'legendscroll', 'legendselectall', 'legendselected', 'legendunselected'));
    expect(issues).toEqual([]);
  });

  test(`GeoActions_EmitTypedSelectionEvents_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Geo actions', 'geo');

    // Assert
    await expect(events(page)).toHaveText([
      'geoselectchanged Right|Left=False,Right=True|1', 'geoselected Left|Left=True,Right=False',
      'geounselected Left|Left=False,Right=False',
    ].join('\n'));
    expect(issues).toEqual([]);
  });

  test(`TimelineActions_EmitTypedChangeAndPlayEvents_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Timeline actions', 'timeline');

    // Assert
    await expect(events(page)).toHaveText('timelinechanged 1\ntimelineplaychanged False');

    // Act
    const index = await page.locator('.interaction-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getModel().getComponent('timeline').getCurrentIndex();
    });

    // Assert
    expect(index).toBe(1);
    expect(issues).toEqual([]);
  });

  test(`AxisBreakActions_ExpandCollapseAndToggle_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    // Expand, then collapse, then toggle back to expanded; old is the state before each action.
    await run(page, 'Axis break actions', 'axis break expandAxisBreak|200-900:True/False collapseAxisBreak|200-900:False/True');

    // Assert
    await expect(events(page)).toHaveText('axisbreakchanged toggleAxisBreak|200-900:True/False');
    expect(issues).toEqual([]);
  });

  test(`PointerEvents_DeliverEveryMouseEventType_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);
    await run(page, 'Pointer fixture', 'pointer');
    const chart = page.locator('.interaction-chart');
    const bar = await chart.evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const layout = ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().getItemLayout(1);
      const box = element.getBoundingClientRect();
      return { x: box.x + layout.x + layout.width / 2, y: box.y + layout.y + layout.height / 2 };
    });
    await page.mouse.move(bar.x, bar.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.dblclick(bar.x, bar.y);
    await page.mouse.click(bar.x, bar.y, { button: 'right' });
    const box = (await chart.boundingBox())!;

    // Act
    await page.mouse.move(box.x + box.width + 40, box.y + box.height + 40, { steps: 4 });

    // Assert
    // A click also reports the unchanged selection of a series without selectedMode.
    await expect(events(page)).toHaveText([
      ...['click', 'contextmenu', 'dblclick', 'globalout', 'mousedown', 'mousemove', 'mouseout', 'mouseover', 'mouseup']
        .map(type => type === 'globalout' ? 'globalout ||' : `${type} series|Pointer|1`),
      'selectchanged select|',
    ].join('\n'));
    expect(issues).toEqual([]);
  });

  test(`SeriesSelectionActions_SelectUnselectAndToggle_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Series selection actions', 'selection select|0:0 unselect|');

    // Assert
    await expect(events(page)).toHaveText('selectchanged toggleSelect|0:1');
    await expect(counts(page)).toHaveText('selectchanged 3');
    expect(await native(page, chart => [0, 1, 2].map(i => !!chart.getModel().getSeriesByIndex(0).isSelected(i)))).toEqual([false, true, false]);
    expect(issues).toEqual([]);
  });

  test(`RestoreAction_ResetsTheOptionAndEmitsRestore_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Restore action', 'restore');

    // Assert
    await expect(events(page)).toHaveText('restore restore');
    await expect(counts(page)).toHaveText(once('restore'));
    expect(await native(page, chart => chart.getModel().getComponent('dataZoom').getPercentRange())).toEqual([0, 100]);
    expect(issues).toEqual([]);
  });

  test(`TreemapZoomToNodeAction_ZoomsTheLayoutToTheNode_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);
    await run(page, 'Treemap zoom action', 'treemap');

    // Act
    // The model keeps its view root; the layout enlarges the root so that the small node A comes into view.
    const zoom = await native(page, chart => {
      const series = chart.getModel().getSeriesByIndex(0);
      return { root: series.getViewRoot().name, width: series.getData().tree.root.getLayout().width, view: series.layoutInfo.width };
    });

    // Assert
    expect(zoom.root).toBe('');
    expect(zoom.width / zoom.view).toBeGreaterThan(2);
    expect(issues).toEqual([]);
  });

  test(`SelectDataRangeAction_EmitsTypedDataRangeSelected_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Visual map range action', 'visual map');

    // Assert
    await expect(events(page)).toHaveText('datarangeselected range|20,60');
    await expect(counts(page)).toHaveText(once('datarangeselected'));
    expect(await native(page, chart => chart.getModel().getComponent('visualMap').option.range)).toEqual([20, 60]);
    expect(issues).toEqual([]);
  });

  test(`DataZoomTakeGlobalCursor_EmitsTypedGlobalCursorTaken_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Data zoom cursor action', 'data zoom cursor');

    // Assert
    await expect(events(page)).toHaveText('globalcursortaken dataZoomSelect|True');
    await expect(counts(page)).toHaveText(once('globalcursortaken'));
    expect(issues).toEqual([]);
  });

  test(`BrushAction_EmitsTypedBrushAreas_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Brush action', 'brush');

    // Assert
    await expect(events(page)).toHaveText('brush lineX:1,2');
    await expect(counts(page)).toHaveText(once('brush'));
    expect(await native(page, chart => chart.getModel().getComponent('brush').areas.map((area: any) => [area.brushType, area.coordRange]))).toEqual([
      ['lineX', [1, 2]],
    ]);
    expect(issues).toEqual([]);
  });

  test(`TreeRoam_WheelEmitsTypedTreeRoam_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);
    await run(page, 'Tree roam fixture', 'tree roam');
    const box = (await page.locator('.interaction-chart').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Act
    await page.mouse.wheel(0, -200);

    // Assert
    // The tree's roam payload names its series but carries no componentType.
    await expect(events(page)).toHaveText('treeroam |tree|zoomed=True');
    await expect.poll(() => native(page, chart => chart.getModel().getSeriesByIndex(0).get('zoom'))).toBeGreaterThan(1);
    expect(issues).toEqual([]);
  });
}
