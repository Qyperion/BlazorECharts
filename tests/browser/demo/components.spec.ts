import { test, expect, type Locator } from '@playwright/test';
import { echartsModule, hostings, openExample, watchIssues } from './demo-helpers';

// One test per example of the Components group: each asserts the state of the real ECharts model.
test.describe.configure({ mode: 'parallel' });

let issues: string[] = [];

test.beforeEach(({ page }) => { issues = watchIssues(page); });

test.afterEach(() => expect(issues).toEqual([]));

const chart = (view: Locator) => view.locator('.example-chart').first();

// The page coordinates of the center of a canvas control: the next page button of the scroll legend or the bar icon of magicType.
async function center(view: Locator, control: 'legend-next' | 'magic-type-bar'): Promise<{ x: number; y: number }> {
  return chart(view).evaluate(
    async (element, { module, control }) => {
      const instance = (await import(module)).getInstanceByDom(element);
      const view = (type: string) => instance.getViewOfComponentModel(instance.getModel().getComponent(type));
      const target = control === 'legend-next'
        ? view('legend')._controllerGroup.childOfName('pageNext')
        : view('toolbox')._features.get('magicType').model.iconPaths.bar;
      const rect = target.getBoundingRect().clone();
      rect.applyTransform(target.getComputedTransform());
      const box = element.getBoundingClientRect();
      return { x: box.left + rect.x + rect.width / 2, y: box.top + rect.y + rect.height / 2 };
    },
    { module: echartsModule, control }
  );
}

for (const hosting of hostings) {
  test(`Polar_SeriesUseThePolarCoordinateSystem ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'polar', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        return {
          series: model.getSeries().map((series: any) => `${series.subType}:${series.coordinateSystem.type}`),
          axes: [model.getComponent('angleAxis').axis.type, model.getComponent('radiusAxis').axis.type],
        };
      },
      echartsModule
    );

    // Assert
    expect(state).toEqual({ series: ['bar:polar', 'bar:polar', 'line:polar'], axes: ['category', 'value'] });
  });

  test(`Geo_PlacesScatterPointsInsideTheGeoComponent ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'geo', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        const geo = model.getComponent('geo');
        const bounds = geo.coordinateSystem.getBoundingRect();
        const area = geo.coordinateSystem.getViewRect();
        const desks = model.getSeriesByIndex(0).getData();
        const indices = Array.from({ length: desks.count() }, (_, i) => i);
        return {
          map: geo.get('map'),
          series: model.getSeries().map((series: any) => `${series.subType}:${series.coordinateSystem.type}:${series.getData().count()}`),
          inMapUnits: indices.every(i => bounds.contain(desks.get('lng', i), desks.get('lat', i))),
          onScreen: indices.every(i => area.contain(...(desks.getItemLayout(i) as [number, number]))),
        };
      },
      echartsModule
    );

    // Assert
    expect(state).toEqual({
      map: 'examples-office',
      series: ['scatter:geo:10', 'effectScatter:geo:2', 'lines:geo:3'],
      inMapUnits: true,
      onScreen: true,
    });
  });

  test(`Dataset_SecondDatasetHoldsTheFilteredSortedRows ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'dataset', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();

        // Rows after the header row, which the source keeps at the start of its data.
        const rows = (index: number) => {
          const source = model.getComponent('dataset', index).getSourceManager().getSource();
          return source.data.slice(source.startIndex) as unknown[][];
        };
        const pie = model.getSeriesByIndex(2).getData();
        return {
          source: rows(0).length,
          transformed: rows(1).map(row => row.slice(0, 2)),
          pie: Array.from({ length: pie.count() }, (_, i) => `${pie.getName(i)}=${pie.get(pie.mapDimension('value'), i)}`),
          bars: model.getSeriesByIndex(0).getData().count(),
        };
      },
      echartsModule
    );

    // Assert
    expect(state).toEqual({
      source: 12,
      transformed: [['Oct', 560], ['May', 510], ['Nov', 480], ['Jun', 470], ['Mar', 450], ['Sep', 430]],
      pie: ['Oct=560', 'May=510', 'Nov=480', 'Jun=470', 'Mar=450', 'Sep=430'],
      bars: 12,
    });
  });

  test(`Markers_PointLineAndAreaHaveTheirData ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'markers', hosting);

    // Act
    const markers = await chart(view).evaluate(
      async (element, module) => {
        const ec = await import(module);
        const instance = ec.getInstanceByDom(element);
        const model = instance.getModel();

        // Rendered marker elements point to the per-series marker model that holds the computed data.
        return Object.fromEntries(['markPoint', 'markLine', 'markArea'].map(type => {
          const markers = new Set<any>();
          instance.getViewOfComponentModel(model.getComponent(type)).group.traverse((child: any) => {
            const marker = ec.helper.getECData(child).dataModel;
            if (marker)
              markers.add(marker);
          });
          return [
            type,
            [...markers].flatMap(marker => {
              const data = marker.getData();
              return Array.from(
                { length: data.count() },
                (_, i) => type === 'markArea' ? data.getName(i) : `${data.getName(i)}=${marker.getRawValue(i)}`
              );
            }),
          ];
        }));
      },
      echartsModule
    );

    // Assert
    expect(markers).toEqual({ markPoint: ['Busiest=560', 'Quietest=240'], markLine: ['Average=427.5', 'Goal=500'], markArea: ['Summer break'] });
  });

  test(`PiecewiseVisualMap_ColorsSegmentsByPiece ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'piecewise-visual-map', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const instance = (await import(module)).getInstanceByDom(element);
        const model = instance.getModel();
        const visualMap = model.getComponent('visualMap');
        const series = model.getSeriesByIndex(0);
        const data = series.getData();

        // Days with 12, 44, 58, 112 and 135 messages: one in each piece, then one out of range.
        const points = [0, 4, 7, 18, 19].map(i => `${data.get('y', i)}:${data.getItemVisual(i, 'style').fill}`);
        const stroke = instance.getViewOfSeriesModel(series)._polyline.style.stroke;
        return {
          type: visualMap.type,
          pieces: visualMap.getPieceList().length,
          points,
          segments: [...new Set(stroke.colorStops.map((stop: { color: string }) => stop.color))],
        };
      },
      echartsModule
    );

    // Assert
    expect(state).toEqual({
      type: 'visualMap.piecewise',
      pieces: 4,
      points: ['12:#4caf50', '44:#fbc02d', '58:#fb8c00', '112:#e53935', '135:rgba(158,158,158,1)'],
      segments: ['rgba(158,158,158,1)', '#e53935', '#fb8c00', '#fbc02d', '#4caf50'],
    });
  });

  test(`Timeline_NextChangesTheStepAndThePageShowsTheEvent ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'timeline', hosting);

    // Act
    const state = () => chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        const data = model.getSeriesByIndex(0).getData();
        return {
          index: model.getComponent('timeline').getCurrentIndex(),
          values: Array.from({ length: data.count() }, (_, i) => data.get(data.mapDimension('y'), i)),
        };
      },
      echartsModule
    );

    // Assert
    await expect.poll(state).toEqual({ index: 0, values: [120, 96, 140, 80, 64] });

    // Act
    await page.getByRole('button', { name: 'Next quarter' }).click();

    // Assert
    await expect(page.getByTestId('timeline-step')).toHaveText('timelinechanged: showing Q2 (step 2 of 4).');
    await expect.poll(state).toEqual({ index: 1, values: [180, 130, 150, 110, 90] });

    // Act
    await page.getByRole('button', { name: 'Next quarter' }).click();

    // Assert
    await expect(page.getByTestId('timeline-step')).toHaveAttribute('data-index', '2');
    await expect.poll(state).toEqual({ index: 2, values: [90, 70, 85, 60, 120] });
  });

  test(`Media_NarrowContainerSwitchesTheLegendOrientation ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'media', hosting);

    // Act
    const layout = () => chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        return { width: element.clientWidth, orient: model.getComponent('legend').get('orient'), center: model.getSeriesByIndex(0).get('center') };
      },
      echartsModule
    );

    // Assert
    expect(await layout()).toMatchObject({ orient: 'vertical', center: ['40%', '55%'] });

    // Act
    await page.getByRole('button', { name: 'Narrow container (360 px)' }).click();

    // Assert
    await expect.poll(layout).toEqual({ width: 360, orient: 'horizontal', center: ['50%', '48%'] });

    // Act
    await page.getByRole('button', { name: 'Wide container' }).click();

    // Assert
    await expect.poll(layout).toMatchObject({ orient: 'vertical', center: ['40%', '55%'] });
  });

  test(`Matrix_HeatmapIsLaidOutOnTheMatrix ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'matrix', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const instance = (await import(module)).getInstanceByDom(element);
        const model = instance.getModel();
        const matrix = model.getComponent('matrix').coordinateSystem;
        const series = model.getSeriesByIndex(0);
        const cells: any[] = [];
        instance.getViewOfSeriesModel(series).group.traverse((child: any) => {
          if (child.type === 'rect')
            cells.push(child.shape);
        });

        // The first body cell, Avery on Monday, and the last, Devon on Sunday.
        const first = matrix.dataToLayout([0, 0]).rect;
        const last = matrix.dataToLayout([6, 3]).rect;
        const headers: string[] = [];
        instance.getViewOfComponentModel(model.getComponent('matrix')).group.traverse((child: any) => {
          const text = child.type === 'text' ? child.style.text : child.getTextContent?.()?.style.text;
          if (text)
            headers.push(text);
        });
        return {
          series: `${series.subType}:${series.coordinateSystem.type}`,
          cells: cells.length,
          corners: [cells[0], cells[cells.length - 1]].map(cell => [cell.x, cell.y]),
          expected: [[first.x, first.y], [last.x, last.y]],
          headers: headers.sort(),
        };
      },
      echartsModule
    );

    // Assert
    expect(state).toMatchObject({ series: 'heatmap:matrix', cells: 28, corners: state.expected });
    expect(state.headers).toEqual([
      'Avery', 'Blake', 'Casey', 'Design', 'Devon', 'Fri', 'Mon', 'Sat', 'Sun', 'Support', 'Thu', 'Tue', 'Wed', 'Weekdays', 'Weekend',
    ]);
  });

  test(`Thumbnail_DrawsTheGraphInItsWindow ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'thumbnail', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const instance = (await import(module)).getInstanceByDom(element);
        const model = instance.getModel();
        const thumbnail = instance.getViewOfComponentModel(model.getComponent('thumbnail'));
        const box = thumbnail.group.getBoundingRect();
        let copies = 0;
        thumbnail._targetGroup.traverse((child: any) => {
          if (!child.isGroup)
            copies++;
        });
        return { drawn: box.width > 0 && box.height > 0, nodes: model.getSeriesByIndex(0).getData().count(), copies };
      },
      echartsModule
    );

    // Assert
    expect(state).toMatchObject({ drawn: true, nodes: 12 });
    expect(state.copies).toBeGreaterThanOrEqual(state.nodes);
  });

  test(`LinkedGrids_HoverInTheFirstGridShowsThePointerInTheSecond ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'linked-grids', hosting);
    const point = await chart(view).evaluate(
      async (element, module) => {
        const instance = (await import(module)).getInstanceByDom(element);
        const [x, y] = instance.convertToPixel({ seriesIndex: 0 }, [10, instance.getModel().getSeriesByIndex(0).getData().get('y', 10)]);
        const box = element.getBoundingClientRect();
        return { x: box.left + x, y: box.top + y };
      },
      echartsModule
    );
    await page.mouse.move(point.x, point.y);

    // Act
    const pointers = () => chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        const axes = Object.values(model.getComponent('axisPointer').coordSysAxesInfo.axesInfo) as any[];
        return axes.filter(info => info.axis.dim === 'x')
          .sort((a, b) => a.axis.model.componentIndex - b.axis.model.componentIndex)
          .map(info => ({ status: info.axisPointerModel.option.status, value: info.axisPointerModel.option.value }));
      },
      echartsModule
    );

    // Assert
    await expect.poll(pointers).toEqual([{ status: 'show', value: 10 }, { status: 'show', value: 10 }]);
  });

  test(`AxisVariants_LogAxisSecondYAxisBreaksAndJitter ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'axis-variants', hosting);

    // Act
    const state = await chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        const y = (index: number) => model.getComponent('yAxis', index);
        const coord = (value: number) => y(2).axis.dataToCoord(value);
        return {
          types: [0, 1, 2].map(index => y(index).axis.type),
          grids: [0, 1, 2].map(index => y(index).get('gridIndex')),
          breaks: y(2).get('breaks').map((range: { start: number; end: number }) => [range.start, range.end]),
          // The collapsed range from 80 to 600 takes less height than the range from 0 to 80.
          collapsed: Math.abs(coord(600) - coord(80)) < Math.abs(coord(80) - coord(0)),
          jitter: model.getComponent('xAxis', 1).get('jitter'),
        };
      },
      echartsModule
    );

    // Assert
    expect(state).toEqual({ types: ['log', 'value', 'value'], grids: [0, 0, 1], breaks: [[80, 600]], collapsed: true, jitter: 30 });
  });

  test(`LegendToolbox_LegendScrollsAndMagicTypeSwitchesToBar ${hosting}`, async ({ page }) => {
    // Arrange
    const view = await openExample(page, 'legend-toolbox', hosting);

    // Act
    const state = () => chart(view).evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        const legend = model.getComponent('legend');
        return {
          legend: legend.type,
          selector: legend.get('selector').map((button: { type: string }) => button.type),
          scroll: legend.get('scrollDataIndex'),
          series: [...new Set(model.getSeries().map((series: any) => series.subType))],
        };
      },
      echartsModule
    );

    // Assert
    expect(await state()).toEqual({ legend: 'legend.scroll', selector: ['all', 'inverse'], scroll: 0, series: ['line'] });

    // Act
    const next = await center(view, 'legend-next');
    await page.mouse.click(next.x, next.y);

    // Assert
    await expect.poll(async () => (await state()).scroll).toBeGreaterThan(0);

    // Act
    const bar = await center(view, 'magic-type-bar');
    await page.mouse.click(bar.x, bar.y);

    // Assert
    await expect.poll(async () => (await state()).series).toEqual(['bar']);
  });
}
