import { test, expect } from '@playwright/test';

async function clickBar(page: any) {
  await page.locator('.events-chart').scrollIntoViewIfNeeded();
  const point = await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
    const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    const chart = ec.getInstanceByDom(element);
    const layout = chart.getModel().getSeriesByIndex(0).getData().getItemLayout(0);
    const box = element.getBoundingClientRect();
    return { x: box.x + layout.x + layout.width / 2, y: box.y + layout.y + layout.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
}

async function clickMouseFixture(page: any, kind: string) {
  await page.locator('.events-chart').scrollIntoViewIfNeeded();
  const point = await page.locator('.events-chart').evaluate(
    async (element: HTMLElement, target: string) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const model = chart.getModel();
      const find = (data: any, name: string) => {
        for (let i = 0; i < data.count(); i++)
          if (data.getName(i) === name)
            return i;

        return -1;
      };
      const sector = (layout: any) => {
        const angle = (layout.startAngle + layout.endAngle) / 2;
        const radius = (layout.r0 + layout.r) / 2;
        return [layout.cx + radius * Math.cos(angle), layout.cy + radius * Math.sin(angle)];
      };
      let local: number[];
      if (target === 'pie')
        local = sector(model.getSeriesByIndex(0).getData().getItemLayout(0));
      else if (target === 'sunburst') {
        const data = model.getSeriesByIndex(1).getData();
        local = sector(data.getItemLayout(find(data, 'Leaf')));
      } else if (target === 'tree') {
        const data = model.getSeriesByIndex(2).getData();
        local = data.getItemGraphicEl(find(data, 'Child')).transformCoordToGlobal(0, 0);
      } else if (target === 'matrix') {
        const rect = chart.convertToLayout({ matrixIndex: 0 }, [1, 1]).rect;
        local = [rect.x + rect.width / 2, rect.y + rect.height / 2];
      } else
        local = [590, 170];

      const box = element.getBoundingClientRect();
      return { x: box.x + local[0], y: box.y + local[1] };
    },
    kind
  );
  await page.mouse.click(point.x, point.y);
}

for (const mode of ['server', 'wasm']) {
  test(`Payload_DeclarationRoundTripsDifferentNativeActionsAndSubscriptions_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    const native = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const data = ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getData();
      return { version: ec.version, states: [0, 1].map(i => data.getItemGraphicEl(i).currentStates.includes('emphasis')) };
    });
    await page.getByRole('button', { name: 'Payload highlight', exact: true }).click();

    // Assert
    await expect(page.getByTestId('payload-declaration')).toHaveText('highlight/False/0/0/True');
    await expect.poll(native).toEqual({ version: '6.1.0', states: [true, false] });

    // Act
    const scalar = JSON.parse(await page.getByTestId('payload-declaration-json').innerText());

    // Assert
    expect(scalar).toMatchObject({
      type: 'highlight',
      escapeConnect: false,
      dataIndex: 0,
      notBlur: false,
      animation: { duration: 0, delay: 0, easing: 'linear' },
      future: { flag: false, zero: 0, empty: [] },
    });

    // Act
    await page.getByRole('button', { name: 'Payload downplay batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('payload-declaration')).toHaveText('downplay/False/2/0/True');
    await expect.poll(native).toEqual({ version: '6.1.0', states: [false, false] });

    // Act
    const batch = JSON.parse(await page.getByTestId('payload-declaration-json').innerText());

    // Assert
    expect(batch.batch.map((item: any) => item.dataIndex)).toEqual([0, 1]);
    expect(batch.batch[0]).toMatchObject({
      excludeSeriesId: [],
      animation: { duration: 0, delay: 0, easing: 'linear' },
      future: { flag: false, zero: 0, empty: [] },
    });
    expect(errors).toEqual([]);
  });

  test(`DownplayPayload_DeclarationRoundTripsThroughNativeActionAndSubscription_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    const native = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const data = ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getData();
      return { version: ec.version, states: [0, 1].map(i => data.getItemGraphicEl(i).currentStates) };
    });
    await page.getByRole('button', { name: 'Prepare downplay', exact: true }).click();

    // Assert
    expect((await native()).version).toBe('6.1.0');
    await expect.poll(async () => (await native()).states.map(s => s.includes('emphasis'))).toEqual([true, true]);

    // Act
    await page.getByRole('button', { name: 'Downplay declaration', exact: true }).click();

    // Assert
    await expect(page.getByTestId('downplay-declaration')).toHaveText('downplay/False/False/0/linear/0/True');
    await expect.poll(async () => (await native()).states.map(s => s.includes('emphasis'))).toEqual([false, true]);

    // Act
    const scalar = JSON.parse(await page.getByTestId('downplay-declaration-json').innerText());

    // Assert
    expect(scalar).toMatchObject({
      type: 'downplay',
      notBlur: false,
      escapeConnect: false,
      dataIndex: 0,
      animation: { duration: 0, delay: 0, easing: 'linear' },
      future: { flag: false, zero: 0, empty: [] },
    });

    // Act
    await page.getByRole('button', { name: 'Prepare downplay', exact: true }).click();

    // Assert
    await expect.poll(async () => (await native()).states.map(s => s.includes('emphasis'))).toEqual([true, true]);

    // Act
    await page.getByRole('button', { name: 'Downplay declaration batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('downplay-declaration')).toHaveText('downplay//False/2/linear/0/True');
    await expect.poll(async () => (await native()).states.map(s => s.includes('emphasis'))).toEqual([false, false]);

    // Act
    const json = JSON.parse(await page.getByTestId('downplay-declaration-json').innerText());

    // Assert
    expect(json.batch).toHaveLength(2);
    expect(json.batch[0].animation).toEqual({ duration: 0, easing: 'linear', delay: 0 });
    expect(json.batch[0].excludeSeriesId).toEqual([]);
    expect(json.batch[0].future).toEqual({ flag: false, zero: 0, empty: [] });
    expect(json.batch.map((item: any) => item.dataIndex)).toEqual([0, 1]);
    expect(errors).toEqual([]);
  });

  test(`HighlightPayload_DeclarationRoundTripsThroughNativeActionAndSubscription_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Highlight declaration', exact: true }).click();

    // Assert
    await expect(page.getByTestId('highlight-declaration')).toHaveText('highlight/False/False/0/linear/0/True');

    // Act
    const native = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      return { version: ec.version, state: chart.getModel().getSeriesByIndex(0).getData().getItemGraphicEl(0).currentStates };
    });

    // Assert
    expect((await native()).version).toBe('6.1.0');
    await expect.poll(async () => (await native()).state).toContain('emphasis');

    // Act
    await page.getByRole('button', { name: 'Highlight declaration batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('highlight-declaration')).toHaveText('highlight//False/2/linear/0/True');

    // Act
    const json = JSON.parse(await page.getByTestId('highlight-declaration-json').innerText());

    // Assert
    expect(json.batch).toHaveLength(2);
    expect(json.batch[0].animation).toEqual({ duration: 0, easing: 'linear', delay: 0 });
    expect(json.batch[0].excludeSeriesId).toEqual([]);
    expect(json.batch[0].future).toEqual({ flag: false, zero: 0, empty: [] });
    expect(json.batch[0].dataIndex).toBe(0);
    expect(json.batch[1].dataIndex).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`RemainingRuntimeActions_ApplyTypedPayloadsAndDeliverCallbacks_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Remaining action fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('remaining ready');

    // Act
    await page.getByRole('button', { name: 'Select brush result', exact: true }).click();

    // Assert
    await expect(page.getByTestId('remaining-brush')).toHaveText('brushselected/0/2');

    // Act
    await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      ec.getInstanceByDom(element).dispatchAction({ type: 'brush', areas: [] });
    });

    // Assert
    await expect(page.getByTestId('remaining-brush')).toHaveText('brushselected/0/0');

    // Act
    await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      ec.getInstanceByDom(element).dispatchAction({
        type: 'brush',
        areas: [
          {
            brushType: 'rect',
            xAxisIndex: 0,
            yAxisIndex: 0,
            range: [[10, 300], [10, 200]],
            coordRange: [[0, 1], [0, 10]],
            brushMode: 'multiple',
            transformable: false,
            removeOnClick: false,
            z: 0,
            brushStyle: {
              fill: 'red',
              stroke: 'blue',
              lineWidth: 0,
              opacity: 0.5,
              shadowBlur: 0,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
              shadowColor: 'black',
            },
          },
        ],
      });
    });

    // Assert
    await expect(page.getByTestId('remaining-area')).toHaveText('rect/multiple/False/False/0/0.5/A/True');

    // Act
    await page.getByRole('button', { name: 'Apply data view', exact: true }).click();

    // Assert
    await expect(page.getByTestId('remaining-data')).toHaveText('dataviewchanged/False');

    // Act
    const series = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const m = chart.getModel().getSeriesByIndex(0);
      return { version: ec.version, type: m.subType, value: m.getData().get('y', 0) };
    });

    // Assert
    expect(await series()).toEqual({ version: '6.1.0', type: 'bar', value: 7 });

    // Act
    await page.getByRole('button', { name: 'Apply magic type', exact: true }).click();

    // Assert
    await expect(page.getByTestId('remaining-magic')).toHaveText('magictypechanged/line');
    expect((await series()).type).toBe('line');

    // Act
    await page.getByRole('button', { name: 'Geo action fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('geo ready');

    // Act
    const geo = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const m = ec.getInstanceByDom(element).getModel().getComponent('geo');
      return { zoom: m.get('zoom'), pixel: m.coordinateSystem.dataToPoint([0.5, 0.5]) };
    });
    const before = await geo();
    await page.getByRole('button', { name: 'Roam geo', exact: true }).click();

    // Assert
    await expect(page.getByTestId('remaining-geo')).toHaveText('georoam/10/0');
    expect((await geo()).pixel[0]).toBeCloseTo(before.pixel[0] + 10, 4);

    // Act
    await page.getByRole('button', { name: 'Roam geo batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('remaining-geo')).toHaveText('georoam/batch/2');
    expect((await geo()).zoom).toBeCloseTo(2, 4);
    expect(errors).toEqual([]);
  });

  test(`TreeActions_DeliverTypedToggleAndTreemapRootWithNativeEffects_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Tree fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('tree ready');

    // Act
    const state = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const model = chart.getModel().getSeriesByIndex(0);
      return { version: ec.version, expand: model.getData().tree.getNodeByDataIndex(1).isExpand };
    });

    // Assert
    expect((await state()).expand).toBe(true);

    // Act
    await page.getByRole('button', { name: 'Toggle tree', exact: true }).click();

    // Assert
    await expect(page.getByTestId('tree-toggle-typed')).toHaveText('treeexpandandcollapse/1/False');
    expect((await state()).expand).toBe(false);
    expect(JSON.parse(await page.getByTestId('tree-toggle').innerText()).unknown).toEqual({ flag: false, zero: 0, empty: [] });

    // Act
    await page.getByRole('button', { name: 'Tree batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('tree-toggle-batch')).toHaveText('2/1/1');
    expect((await state()).expand).toBe(false);

    // Act
    await page.locator('.events-chart').scrollIntoViewIfNeeded();
    const point = await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const el = ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().getItemGraphicEl(1);
      const p = el.transformCoordToGlobal(0, 0);
      const box = element.getBoundingClientRect();
      return { x: box.x + p[0], y: box.y + p[1] };
    });
    await page.mouse.click(point.x, point.y);

    // Assert
    await expect(page.getByTestId('tree-toggle-typed')).toHaveText('treeexpandandcollapse/1/');
    expect((await state()).expand).toBe(true);

    // Act
    await page.getByRole('button', { name: 'Treemap fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('treemap ready');

    // Act
    const root = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getModel().getSeriesByIndex(0).getViewRoot().getId();
    });
    await page.getByRole('button', { name: 'Treemap down', exact: true }).click();

    // Assert
    await expect(page.getByTestId('treemap-root-typed')).toHaveText('treemaproottonode/drillDown/branch');
    expect(await root()).toBe('branch');

    // Act
    await page.getByRole('button', { name: 'Treemap root batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('treemap-root-batch')).toHaveText('2/drillDown/drillDown');
    expect(await root()).toBe('leaf');

    // Act
    // Invoke the pinned view's native producer; its payload contains an actual TreeNode.
    await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const model = chart.getModel().getSeriesByIndex(0);
      chart.getViewOfSeriesModel(model)._rootToNode({ node: model.getData().tree.root.getNodeById('branch') });
    });

    // Assert
    await expect(page.getByTestId('treemap-native')).toHaveText('retained');
    await expect(page.getByTestId('treemap-root-typed')).toHaveText('treemaproottonode/rollUp/');
    expect(await root()).toBe('branch');

    // Act
    const refs = JSON.parse(await page.getByTestId('treemap-native-refs').innerText());

    // Assert
    expect(refs.some((e: any) => JSON.stringify(e.path) === '["targetNode"]')).toBe(true);
    expect((await state()).version).toBe('6.1.0');
    expect(errors).toEqual([]);
  });

  test(`SunburstActions_DeliverTypedEventsForwardingAndNativeRootEffects_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    const deprecations: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (!['warning', 'error'].includes(e.type()))
        return;

      if (/sunburst(Highlight|Unhighlight).*deprecated/.test(e.text()))
        deprecations.push(e.text());
      else
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Sunburst fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('sunburst ready');

    // Act
    const state = () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const model = chart.getModel().getSeriesByIndex(0);
      const node = model.getData().tree.root.getNodeById('leaf');
      return { version: ec.version, root: model.getViewRoot().getId(), hover: node.piece.hoverState, forwarded: (window as any).sunburstForwarded };
    });
    await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      (window as any).sunburstForwarded = [];
      for (const name of ['highlight', 'downplay'])
        chart.on(name, (e: any) => (window as any).sunburstForwarded.push({ type: e.type, dataIndex: e.dataIndex, targetNodeId: e.targetNodeId }));
    });
    await page.getByRole('button', { name: 'Sunburst highlight', exact: true }).click();

    // Assert
    await expect(page.getByTestId('sunburst-highlight-typed')).toHaveText('sunbursthighlight/0/leaf/True');
    expect(JSON.parse(await page.getByTestId('sunburst-highlight').innerText()).unknown).toEqual({ flag: false, zero: 0, empty: [] });
    await expect.poll(async () => (await state()).hover).toBe(2);
    expect((await state()).forwarded[0]).toEqual({ type: 'highlight', dataIndex: 2, targetNodeId: 'leaf' });

    // Act
    await page.getByRole('button', { name: 'Sunburst unhighlight', exact: true }).click();

    // Assert
    await expect(page.getByTestId('sunburst-unhighlight-typed')).toHaveText('sunburstunhighlight/2');
    await expect.poll(async () => (await state()).hover).toBe(0);
    expect((await state()).forwarded[1]).toEqual({ type: 'downplay', dataIndex: 2 });

    // Act
    await page.getByRole('button', { name: 'Sunburst batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('sunburst-root-batch')).toHaveText('2/sunburstroottonode/drillDown/drillDown');
    expect((await state()).root).toBe('leaf');

    // Act
    const batch = JSON.parse(await page.getByTestId('sunburst-root').innerText());

    // Assert
    expect(batch.escapeConnect).toBe(false);
    expect(batch.batch.map((b: any) => b.seriesId)).toEqual(['sun', 'sun']);

    // Act
    await page.getByRole('button', { name: 'Sunburst up', exact: true }).click();

    // Assert
    await expect(page.getByTestId('sunburst-root-typed')).toHaveText('sunburstroottonode/rollUp/');
    expect((await state()).root).toBe('branch');

    // Act
    await page.locator('.events-chart').scrollIntoViewIfNeeded();
    const point = await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const m = ec.getInstanceByDom(element).getModel().getSeriesByIndex(0);
      const node = m.getData().tree.root.getNodeById('leaf');
      const l = node.getLayout();
      const a = (l.startAngle + l.endAngle) / 2;
      const r = (l.r + l.r0) / 2;
      const box = element.getBoundingClientRect();
      return { x: box.x + l.cx + r * Math.cos(a), y: box.y + l.cy + r * Math.sin(a) };
    });
    await page.mouse.click(point.x, point.y);

    // Assert
    await expect(page.getByTestId('sunburst-native')).toHaveText('retained');
    await expect(page.getByTestId('sunburst-root-typed')).toHaveText('sunburstroottonode/drillDown/');
    expect((await state()).root).toBe('leaf');

    // Act
    const native = JSON.parse(await page.getByTestId('sunburst-native-refs').innerText());

    // Assert
    expect(native.some((e: any) => JSON.stringify(e.path) === '["targetNode"]')).toBe(true);

    // Act
    await page.getByRole('button', { name: 'Sunburst up', exact: true }).click();

    // Assert
    await expect(page.getByTestId('sunburst-root-typed')).toHaveText('sunburstroottonode/rollUp/');

    // Act
    await page.getByRole('button', { name: 'Sunburst native target', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('native target dispatched');
    await expect.poll(async () => (await state()).root).toBe('leaf');
    expect((await state()).version).toBe('6.1.0');
    expect(errors).toEqual([]);

    // Both legacy APIs log their source-defined deprecation in development builds.
    expect(deprecations.length).toBeLessThanOrEqual(2);
  });

  test(`AxisActions_DeliverIndependentTypedPayloadsAndNativeEffects_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Axis fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('axes ready');

    // Act
    await page.getByRole('button', { name: 'Change axis order', exact: true }).click();

    // Assert
    await expect(page.getByTestId('axis-order-typed')).toHaveText('changeaxisorder/2/False');

    // Act
    const order = JSON.parse(await page.getByTestId('axis-order').innerText());

    // Assert
    expect(order.unknown).toEqual({ flag: false, zero: 0, empty: [] });

    // Act
    const state = async () => page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const m = ec.getInstanceByDom(element).getModel();
      return { first: m.getComponent('xAxis').axis.scale.getRawOrdinalNumber(0), parallel: m.getComponent('parallel').option.axisExpandWindow };
    });

    // Assert
    expect((await state()).first).toBe(2);

    // Act
    await page.getByRole('button', { name: 'Expand parallel axes', exact: true }).click();

    // Assert
    await expect(page.getByTestId('axis-expand-typed')).toHaveText('parallelaxisexpand/0/1');
    expect((await state()).parallel).toEqual([0, 1]);

    // Act
    await page.getByRole('button', { name: 'Update axis pointer', exact: true }).click();

    // Assert
    await expect(page.getByTestId('axis-pointer-typed')).toHaveText('updateaxispointer/x/0/0/0');

    // Act
    const pointer = JSON.parse(await page.getByTestId('axis-pointer').innerText());

    // Assert
    expect(pointer.axesInfo[0]).toEqual({ axisDim: 'x', axisIndex: 0, value: 0 });
    expect(pointer).not.toHaveProperty('currTrigger');
    expect(pointer).not.toHaveProperty('unknown');
    await expect.poll(() => page.evaluate(() => (window as any).axisDispatched ?? [])).toContain('showTip');

    // Act
    await page.getByRole('button', { name: 'Axis batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('axis-pointer-batch')).toHaveText('1/updateaxispointer/0');
    expect(errors).toEqual([]);
  });

  test(`NodeActions_DeliverTypedNativeCallbacksAndBatch_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Node fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('nodes ready');

    // Act
    await page.getByRole('button', { name: 'Move Sankey node', exact: true }).click();

    // Assert
    await expect(page.getByTestId('node-drag-typed')).toHaveText('dragnode/0/0.1/0.25');
    expect(JSON.parse(await page.getByTestId('node-drag').innerText()).unknown).toEqual({ flag: false, zero: 0, empty: [] });

    // Act
    const node = await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).getOption().series.find((s: any) => s.id === 's').data[0];
    });

    // Assert
    expect(node.localX).toBe(0.1);
    expect(node.localY).toBe(0.25);

    // Act
    await page.getByRole('button', { name: 'Focus graph legacy', exact: true }).click();

    // Assert
    await expect(page.getByTestId('node-focus-typed')).toHaveText('focusnodeadjacency/0');
    expect(JSON.parse(await page.getByTestId('node-focus').innerText()).seriesId).toEqual(['g', 0]);
    expect(await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const view = chart.getViewOfSeriesModel(chart.getModel().getSeriesByIndex(0));
      return [typeof view.focusNodeAdjacency, typeof view.unfocusNodeAdjacency];
    })).toEqual(['undefined', 'undefined']);

    // Act
    await page.getByRole('button', { name: 'Unfocus graph legacy', exact: true }).click();

    // Assert
    await expect(page.getByTestId('node-unfocus-typed')).toHaveText('unfocusnodeadjacency/1');

    // Act
    const unfocus = JSON.parse(await page.getByTestId('node-unfocus').innerText());

    // Assert
    expect(unfocus.batch[0].type).toBe('unfocusnodeadjacency');
    expect(unfocus.batch[0].seriesId).toBe('g');

    // Act
    await page.getByRole('button', { name: 'Move Sankey batch', exact: true }).click();

    // Assert
    await expect(page.getByTestId('node-drag-batch')).toHaveText('1/0/0/0.5');

    // Act
    const batch = JSON.parse(await page.getByTestId('node-drag').innerText()).batch;

    // Assert
    expect(batch[0].type).toBe('dragnode');
    expect(batch[0].unknown).toEqual({ flag: false, zero: 0, empty: [] });
    expect(errors).toEqual([]);
  });

  test(`NodeDrag_DeliversActualSankeyPointerProducer_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (['warning', 'error'].includes(e.type()))
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Node fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('nodes ready');

    // Act
    await page.locator('.events-chart').scrollIntoViewIfNeeded();
    const point = await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const chart = ec.getInstanceByDom(element);
      const model = chart.getModel().getSeriesByIndex(1);
      const rect = model.getData().getItemGraphicEl(0);
      const p = rect.transformCoordToGlobal(rect.shape.x + rect.shape.width / 2, rect.shape.y + rect.shape.height / 2);
      const box = element.getBoundingClientRect();
      return { x: box.x + p[0], y: box.y + p[1] };
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 24, point.y + 15, { steps: 3 });
    await page.mouse.up();

    // Assert
    await expect.poll(async () => JSON.parse(await page.getByTestId('node-drag').innerText()).seriesId).toBe('s');

    // Act
    // The drag raises several events and one render shows both texts, so read them together: separate reads can pair
    // an earlier raw event with a later typed one.
    const shown = await page.evaluate(() => ({
      raw: document.querySelector('[data-testid="node-drag"]')!.textContent!,
      typed: document.querySelector('[data-testid="node-drag-typed"]')!.textContent!,
    }));
    const event = JSON.parse(shown.raw);

    // Assert
    expect(event.type).toBe('dragnode');
    expect(event.dataIndex).toBe(0);
    expect(event.localX).toBeGreaterThan(0);
    expect(event.localY).toBeGreaterThan(0);
    expect(shown.typed).toBe(`dragnode/0/${event.localX}/${event.localY}`);
    expect(errors).toEqual([]);
  });

  test(`TooltipEvents_DeliverNativeTypedCallbacks_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => {
      if (e.type() === 'error' || e.type() === 'warning')
        errors.push(e.text());
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Show tooltip', exact: true }).click();

    // Assert
    await expect.poll(async () => JSON.parse(await page.getByTestId('tooltip-show').innerText()).seriesIndex).toBe(0);

    // Act
    const show = JSON.parse(await page.getByTestId('tooltip-show').innerText());

    // Assert
    expect(show.type).toBe('showtip');
    expect(show.dataIndex).toBe(0);
    expect(show.x).toBe(0);
    expect(show.unknown).toEqual({ flag: false, zero: 0, empty: [] });
    await expect(page.getByTestId('tooltip-show-typed')).toHaveText('0/0/0');

    // Act
    await page.getByRole('button', { name: 'Hide tooltip', exact: true }).click();

    // Assert
    await expect.poll(async () => JSON.parse(await page.getByTestId('tooltip-hide').innerText()).fixture).toBe('hide');
    expect(JSON.parse(await page.getByTestId('tooltip-hide').innerText()).type).toBe('hidetip');
    await expect(page.getByTestId('tooltip-hide-typed')).toHaveText('fixture');
    expect(errors).toEqual([]);
  });

  test(`TooltipEvents_DeliverPointerAndAxisPayloads_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await clickBar(page);

    // Assert
    await expect(page.getByTestId('tooltip-item')).toHaveText('0/0/0');

    // Act
    await page.mouse.move(0, 0);

    // Assert
    await expect(page.getByTestId('tooltip-leave')).toHaveText('hidden');

    // Act
    await page.getByRole('button', { name: 'Axis tooltip', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('axis tooltip ready');

    // Act
    await clickBar(page);

    // Assert
    await expect(page.getByTestId('tooltip-axis')).toHaveText('grid/x/0/0/0/True');
    expect(errors).toEqual([]);
  });

  test(`MouseEvents_DeliverDocumentedTypedFields_${mode}`, async ({ page }) => {
    // Arrange
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Mouse fixtures', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('mouse ready');

    // Act
    const expected = await page.locator('.events-chart').evaluate(async (element: HTMLElement) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const model = ec.getInstanceByDom(element).getModel();
      const find = (data: any, name: string) => {
        for (let i = 0; i < data.count(); i++)
          if (data.getName(i) === name)
            return i;

        return -1;
      };
      const sun = model.getSeriesByIndex(1);
      const tree = model.getSeriesByIndex(2);
      const sunIndex = find(sun.getData(), 'Leaf');
      const treeIndex = find(tree.getData(), 'Child');
      return {
        percent: model.getSeriesByIndex(0).getDataParams(0).percent,
        sunPath: sun.getDataParams(sunIndex).treePathInfo.map((p: any) => p.name).join('>'),
        sunIndex,
        treePath: tree.getDataParams(treeIndex).treeAncestors.map((p: any) => p.name).join('>'),
      };
    });

    // Assert
    expect(expected.sunPath).toBe('Sun>Branch>Leaf');

    // Act
    await clickMouseFixture(page, 'pie');

    // Assert
    await expect(page.getByTestId('mouse-pie')).toHaveText(new RegExp(`^A/${expected.percent}/"#[0-9a-f]{6}"$`));
    await expect(page.getByTestId('mouse-query')).toHaveText('1/0');

    // Act
    await clickMouseFixture(page, 'sunburst');

    // Assert
    await expect(page.getByTestId('mouse-sunburst')).toHaveText(`Leaf/${expected.sunPath}/${expected.sunIndex}/True`);

    // Act
    await clickMouseFixture(page, 'tree');

    // Assert
    await expect(page.getByTestId('mouse-tree')).toHaveText(`Child/${expected.treePath}/True`);

    // Act
    await clickMouseFixture(page, 'graphic');

    // Assert
    await expect(page.getByTestId('mouse-graphic')).toHaveText('{"kind":"marker","zero":0,"empty":[]}');

    // Act
    await clickMouseFixture(page, 'matrix');

    // Assert
    await expect(page.getByTestId('mouse-matrix')).toHaveText('body/1,1');
    await expect(page.getByTestId('mouse-query')).toHaveText('1/0');
    expect(errors).toEqual([]);
  });

  test(`EventPayload_PreservesKnownAndUnknownFields_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Legend', exact: true }).click();

    // Assert
    await expect.poll(async () => JSON.parse(await page.getByTestId('legend').innerText()).selected?.A).toBe(false);

    // Act
    await page.getByRole('button', { name: 'Zoom', exact: true }).click();

    // Assert
    await expect.poll(async () => JSON.parse(await page.getByTestId('zoom').innerText()).batch?.[0]?.start).toBe(5);

    // Act
    await page.getByRole('button', { name: 'Brush', exact: true }).click();

    // Assert
    await expect.poll(async () => JSON.parse(await page.getByTestId('brush').innerText()).areas?.[0]?.brushType).toBe('rect');
    expect(JSON.parse(await page.getByTestId('brush').innerText()).unknown).toEqual({ flag: false, zero: 0, empty: [] });
  });

  test(`Subscriptions_FilterReplaceAndDispose_${mode}`, async ({ page }) => {
    // Arrange
    const rejections: string[] = [];
    page.on('pageerror', e => rejections.push(e.message));
    await page.addInitScript(() => {
      (window as any).eventErrors = [];
      document.addEventListener('blazorecharts:error', (e: any) => (window as any).eventErrors.push(e.detail));
      window.addEventListener('unhandledrejection', e => (window as any).eventErrors.push({ unhandled: String(e.reason) }));
    });
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await clickBar(page);

    // Assert
    await expect(page.getByTestId('clicks')).toHaveText('1/1/0');

    // Act
    const pointer = JSON.parse(await page.getByTestId('pointer').innerText());

    // Assert
    expect(pointer.dataIndex).toBe(0);
    expect(pointer.seriesIndex).toBe(0);
    expect(pointer.data.event).toEqual({ category: 'sale' });
    await expect(page.getByTestId('unmatched')).toHaveText('0');
    await expect.poll(async () => JSON.parse(await page.getByTestId('native-refs').innerText()).length).toBeGreaterThan(0);

    // Act
    await page.getByRole('button', { name: 'Replace', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('replaced');

    // Act
    await clickBar(page);

    // Assert
    await expect(page.getByTestId('clicks')).toHaveText('1/2/1');

    // Act
    await page.getByRole('button', { name: 'Unsubscribe first', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('unsubscribed');

    // Act
    await clickBar(page);

    // Assert
    await expect(page.getByTestId('clicks')).toHaveText('1/3/1');

    // Act
    await page.getByRole('button', { name: 'Handler fault', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('fault armed');

    // Act
    await clickBar(page);

    // Assert
    await expect.poll(() => page.evaluate(() => (window as any).eventErrors.filter((e: any) => e.code === 'EventHandlerFailed').length)).toBe(1);
    expect(rejections).toEqual([]);
    expect(await page.evaluate(() => (window as any).eventErrors.filter((e: any) => e.unhandled))).toEqual([]);
  });

  test(`ParallelSelection_HasTypedIntervals_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Parallel selection', exact: true }).click();

    // Assert
    await expect(page.getByTestId('parallel')).toHaveText('axis-a:1');
  });

  test(`RenderedFinished_AndHandlerCanAwaitQueuedAction_${mode}`, async ({ page }) => {
    // Arrange
    await page.goto(`/harness/events/${mode}`);
    await expect(page.getByTestId('ready')).toHaveText('ready');

    // Act
    await page.getByRole('button', { name: 'Render', exact: true }).click();

    // Assert
    await expect.poll(async () => Number(await page.getByTestId('rendered').innerText())).toBeGreaterThan(0);
    await expect.poll(async () => Number(await page.getByTestId('finished').innerText())).toBeGreaterThan(0);

    // Act
    await page.getByRole('button', { name: 'Handler command', exact: true }).click();

    // Assert
    await expect(page.getByTestId('status')).toHaveText('command armed');

    // Act
    await clickBar(page);

    // Assert
    await expect(page.getByTestId('status')).toHaveText('callback command completed');
  });

  test(`DisposedGeneration_CannotDeliverEvent_${mode}`, async ({ page }) => {
    // Act
    await page.goto(`/harness/events/${mode}`);

    // Assert
    await expect(page.getByTestId('ready')).toHaveText('ready');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(async () => {
        const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
        (window as any).oldEventChart = ec.getInstanceByDom(document.querySelector('.events-chart'));
      });
      await page.getByRole('button', { name: 'Recreate', exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).oldEventChart.isDisposed())).toBe(true);
      await expect(page.locator('.events-chart').locator(i % 2 === 0 ? 'svg' : 'canvas')).toBeVisible();
      await clickBar(page);
      await expect(page.getByTestId('clicks')).toHaveText(`${i + 1}/${i + 1}/0`);
    }

    // Act
    await page.getByRole('button', { name: 'Dispose', exact: true }).click();

    // Assert
    // Disposing the component's handle elsewhere fails the component (ChartDisposed).
    await expect(page.getByTestId('status')).toHaveText('The chart handle was disposed outside its EChart component.');
    await expect(page.locator('.events-chart')).toHaveAttribute('data-chart-state', 'Failed');
    await expect(page.locator('.events-chart').locator('svg,canvas')).toHaveCount(0);
  });
}
