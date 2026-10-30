import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { echartsModule, hostings, openExample, watchIssues } from './demo-helpers';

// Application scenarios on synthetic chat data, asserted against the real ECharts runtime.
mkdirSync('artifacts/demo', { recursive: true });

for (const hosting of hostings) {
  test.describe(hosting, () => {
    let issues: string[] = [];

    test.beforeEach(({ page }) => { issues = watchIssues(page); });

    test.afterEach(() => expect(issues).toEqual([]));

    test(`BrushSelectsCategoryRange ${hosting}`, async ({ page }) => {
      // Arrange
      const view = await openExample(page, 'brush-period-picker', hosting);
      const chart = view.locator('.example-chart');
      const points = await chart.evaluate(
        async (element, module) => {
          const native = (await import(module)).getInstanceByDom(element);
          const box = element.getBoundingClientRect();
          const grid = native.getModel().getComponent('grid').coordinateSystem.getRect();
          const from = native.convertToPixel({ gridIndex: 0 }, [3, 0]);
          const to = native.convertToPixel({ gridIndex: 0 }, [6, 0]);
          return { x1: box.left + from[0], x2: box.left + to[0], y: box.top + grid.y + grid.height / 2 };
        },
        echartsModule
      );
      await page.mouse.move(points.x1, points.y);
      await page.mouse.down();
      await page.mouse.move(points.x2, points.y, { steps: 10 });
      await page.mouse.up();

      // Act
      const selection = page.getByTestId('brush-selection');

      // Assert
      await expect(selection).toHaveAttribute('data-first', '3');
      await expect(selection).toHaveAttribute('data-last', '6');
      await expect(selection).toContainText('Selected Apr 2024 – Jul 2024');

      // Act
      const native = await chart.evaluate(
        async (element, module) => {
          const model = (await import(module)).getInstanceByDom(element).getModel();
          const brush = model.getComponent('brush');
          return { areas: brush.areas.map((area: any) => ({ type: area.brushType, range: area.coordRange })) };
        },
        echartsModule
      );

      // Assert
      expect(native.areas).toEqual([{ type: 'lineX', range: [3, 6] }]);

      // Act
      await page.getByRole('button', { name: 'Clear selection' }).click();

      // Assert
      await expect(selection).toHaveText('Drag across the bars to pick a period.');
    });

    test(`SunburstDrillsIntoLevels ${hosting}`, async ({ page }) => {
      // Arrange
      const view = await openExample(page, 'sunburst-drilldown', hosting);
      const chart = view.locator('.example-chart');
      const sector = (name: string) => chart.evaluate(
        async (element, { module, name }) => {
          const native = (await import(module)).getInstanceByDom(element);
          const series = native.getModel().getSeriesByIndex(0);
          const data = series.getData();
          const index = data.mapArray((i: number) => data.getName(i)).indexOf(name);
          const layout = data.getItemLayout(index);
          const angle = (layout.startAngle + layout.endAngle) / 2;
          const radius = (layout.r0 + layout.r) / 2;
          const box = element.getBoundingClientRect();
          return {
            x: box.left + layout.cx + radius * Math.cos(angle),
            y: box.top + layout.cy + radius * Math.sin(angle),
            center: { x: box.left + layout.cx, y: box.top + layout.cy },
            root: series.getViewRoot().name,
          };
        },
        { module: echartsModule, name }
      );
      const state = () => chart.evaluate(
        async (element, module) => {
          const native = (await import(module)).getInstanceByDom(element);
          const root = native.getModel().getSeriesByIndex(0).getViewRoot();
          return {
            root: root.name,
            depth: root.depth,
            children: root.children.map((child: any) => child.name),
            settled: native.getZr().animation.isFinished(),
          };
        },
        echartsModule
      );

      // Act
      const photos = await sector('Photos');

      // Assert
      expect(photos.root).toBe('All media');

      // Act
      await page.mouse.click(photos.x, photos.y);

      // Assert
      await expect(page.getByTestId('sunburst-state')).toHaveText('Drilled into Photos.');
      await expect.poll(state).toEqual({ root: 'Photos', depth: 1, children: ['Camera', 'Screenshots', 'Edited'], settled: true });

      // Act
      // The center piece rolls up one level.
      await page.mouse.click(photos.center.x, photos.center.y);

      // Assert
      await expect(page.getByTestId('sunburst-state')).toHaveText('Rolled up one level.');
      await expect.poll(state).toMatchObject({ root: 'All media', depth: 0, settled: true });

      // Act
      // Drill again, then the typed SunburstRootToNodeAction returns to the root node.
      const audio = await sector('Audio');
      await page.mouse.click(audio.x, audio.y);

      // Assert
      await expect.poll(state).toMatchObject({ root: 'Audio', settled: true });

      // Act
      await page.getByRole('button', { name: 'Back to all media' }).click();

      // Assert
      // Sunburst sorts siblings by descending value by default.
      await expect.poll(state).toMatchObject({ root: 'All media', children: ['Photos', 'Stickers', 'Audio', 'Videos', 'Files'] });
    });

    test(`ForceGraphSupportsRoam ${hosting}`, async ({ page }) => {
      // Arrange
      const view = await openExample(page, 'force-graph', hosting);
      const chart = view.locator('.example-chart');
      const roam = () => chart.evaluate(
        async (element, module) => {
          const series = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0);

          // Roaming syncs zoom and center back to the series model.
          return { zoom: series.get('zoom') ?? 1, center: series.get('center') ?? null, nodes: series.getData().count() };
        },
        echartsModule
      );

      // Act
      const before = await roam();

      // Assert
      expect(before.nodes).toBe(12);

      // Act
      const box = (await chart.boundingBox())!;

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300);
      const state = page.getByTestId('roam-state');

      // Assert
      await expect(state).not.toHaveAttribute('data-roam-events', '0');
      await expect.poll(async () => (await roam()).zoom).toBeGreaterThan(before.zoom);

      // Act
      const zoomed = await roam();

      // Assert
      await expect(state).toHaveAttribute('data-zoom', /\d/);
      expect(Number(await state.getAttribute('data-zoom'))).toBeCloseTo(zoomed.zoom, 3);

      // Act
      // Drag the empty top-left corner to pan the view.
      const events = Number(await state.getAttribute('data-roam-events'));
      await page.mouse.move(box.x + 24, box.y + 70);
      await page.mouse.down();
      await page.mouse.move(box.x + 124, box.y + 130, { steps: 8 });
      await page.mouse.up();

      // Assert
      await expect.poll(async () => Number(await state.getAttribute('data-roam-events'))).toBeGreaterThan(events);

      // Act
      const panned = await roam();

      // Assert
      expect(panned.center).not.toEqual(zoomed.center);
      expect(panned.zoom).toBeCloseTo(zoomed.zoom, 6);
    });

    test(`CalendarHasOneCoordinatePerYear ${hosting}`, async ({ page }) => {
      // Arrange
      const view = await openExample(page, 'calendar-heatmap', hosting);

      // Act
      const model = await view.locator('.example-chart').evaluate(
        async (element, module) => {
          const ecModel = (await import(module)).getInstanceByDom(element).getModel();
          const calendars = ecModel.queryComponents({ mainType: 'calendar' });
          return {
            calendars: calendars.map((calendar: any) => ({
              range: calendar.coordinateSystem.getRangeInfo().range,
              top: calendar.coordinateSystem.getRect().y,
              height: calendar.coordinateSystem.getRect().height,
            })),
            titles: ecModel.queryComponents({ mainType: 'title' }).map((title: any) => title.option.text),
            series: ecModel.getSeries().map((series: any) => {
              const data = series.getData();
              const years = new Set(data.mapArray((i: number) => String(data.getRawDataItem(i)[0]).slice(0, 4)));
              const calendar = series.get('calendarIndex');
              return {
                type: series.subType,
                calendar,
                sameCoordinateSystem: series.coordinateSystem === calendars[calendar].coordinateSystem,
                years: [...years],
                count: data.count(),
              };
            }),
            inRange: ecModel.getComponent('visualMap').option.inRange.color,
          };
        },
        echartsModule
      );

      // Assert
      expect(model.titles).toEqual(['2024', '2025', '2026']);
      expect(model.calendars.map((c: any) => c.range)).toEqual([
        ['2024-01-01', '2024-12-31'],
        ['2025-01-01', '2025-12-31'],
        ['2026-01-01', '2026-10-15'],
      ]);
      for (let i = 1; i < model.calendars.length; i++)
        expect(model.calendars[i].top).toBeGreaterThanOrEqual(model.calendars[i - 1].top + model.calendars[i - 1].height);

      expect(model.series.map((s: any) => ({ type: s.type, calendar: s.calendar, same: s.sameCoordinateSystem, years: s.years })))
        .toEqual([0, 1, 2].map(i => ({ type: 'heatmap', calendar: i, same: true, years: [String(2024 + i)] })));
      for (const series of model.series)
        expect(series.count).toBeGreaterThan(100);

      expect(model.inRange).toEqual(['#dfe7fb', '#8aa6e8', '#2f5fd0']);
    });

    for (const renderer of ['svg', 'canvas'] as const) {
      test(`WordCloudExportIncludesCompletedLayout ${hosting} ${renderer}`, async ({ page }) => {
        // Arrange
        const view = await openExample(page, 'wordcloud', hosting, renderer);
        const chart = view.locator('.example-chart');

        // A new layout starts; the export must wait for it rather than capture the previous or a partial word set.
        await page.getByLabel('Shape').selectOption('star');
        await page.getByRole('button', { name: renderer === 'svg' ? 'Export SVG' : 'Export PNG' }).click();

        // Act
        const result = page.getByTestId('export-result');

        // Assert
        await expect(result).toHaveAttribute('data-format', renderer === 'svg' ? 'svg' : 'png');

        // Act
        const drawn = await chart.evaluate(
          async (element, module) => {
            const series = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0);
            const data = series.getData();
            return {
              shape: series.option.shape,
              words: Array.from({ length: data.count() }, (_, i) => i).filter(i => data.getItemGraphicEl(i)).map(i => data.getName(i)),
              total: data.count(),
            };
          },
          echartsModule
        );

        // Assert
        expect(drawn.shape).toBe('star');
        expect(drawn.total).toBe(50);
        expect(drawn.words.length).toBeGreaterThan(30);

        // Act
        const source = await result.locator('img').getAttribute('src');

        // Assert
        if (renderer === 'svg') {
          const svg = decodeURIComponent(source!.slice('data:image/svg+xml;charset=utf-8,'.length));
          const labels = await page.evaluate(
            markup => [...new DOMParser().parseFromString(markup, 'image/svg+xml').querySelectorAll('text')].map(e => e.textContent),
            svg
          );
          expect(labels.sort()).toEqual([...drawn.words].sort());
          writeFileSync(`artifacts/demo/wordcloud-${hosting}.svg`, svg);
        } else {
          expect(source).toMatch(/^data:image\/png;base64,/);
          const pixels = await page.evaluate(
            async url => {
              const image = new Image();
              image.src = url;
              await image.decode();
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext('2d')!;
              context.drawImage(image, 0, 0);
              const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
              let ink = 0;
              for (let i = 0; i < bytes.length; i += 4)
                if (bytes[i] < 200 || bytes[i + 1] < 200 || bytes[i + 2] < 200)
                  ink++;

              return { width: image.width, height: image.height, ink };
            },
            source!
          );
          const box = (await chart.boundingBox())!;
          expect(pixels.width).toBe(Math.round(box.width));
          expect(pixels.ink).toBeGreaterThan(5000);
          writeFileSync(`artifacts/demo/wordcloud-${hosting}.png`, Buffer.from(source!.split(',')[1], 'base64'));
        }
      });
    }

    test(`MirroredTimeArea_KeepsSecondPersonBelowZero ${hosting}`, async ({ page }) => {
      // Arrange
      const view = await openExample(page, 'mirrored-time-area', hosting);
      const chart = view.locator('.example-chart');
      const read = () => chart.evaluate(
        async (element, module) => {
          const model = (await import(module)).getInstanceByDom(element).getModel();
          return {
            series: model.getSeries().map((series: any) => {
              const data = series.getData();
              const values = data.mapArray(data.mapDimension('y'), (value: number) => value);
              return { name: series.name, stack: series.get('stack') ?? null, min: Math.min(...values), max: Math.max(...values) };
            }),
            labels: model.getComponent('yAxis').axis.getViewLabels().map((label: any) => label.formattedLabel),
          };
        },
        echartsModule
      );

      // Act
      const mirrored = await read();

      // Assert
      expect(mirrored.series.map((s: any) => s.name)).toEqual(['Avery', 'Blake']);
      expect(mirrored.series[0].min).toBeGreaterThan(0);
      expect(mirrored.series[1].max).toBeLessThan(0);
      expect(mirrored.labels.some((label: string) => label.startsWith('-'))).toBe(false);

      // Act
      await page.getByRole('button', { name: 'Four people, stacked' }).click();

      // Assert
      await expect.poll(async () => (await read()).series.map((s: any) => [s.name, s.stack]))
        .toEqual([['Avery', 'total'], ['Blake', 'total'], ['Casey', 'total'], ['Devon', 'total']]);
    });

    test(`SankeyFlow_LinksClosersToRevivers ${hosting}`, async ({ page }) => {
      // Arrange
      const view = await openExample(page, 'sankey-flow', hosting);

      // Act
      const graph = await view.locator('.example-chart').evaluate(
        async (element, module) => {
          const series = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0);
          const nodes = series.getGraph().nodes.map((node: any) => ({ name: node.id, depth: node.getLayout().depth }));
          return { nodes, edges: series.getGraph().edges.length };
        },
        echartsModule
      );

      // Assert
      expect(graph.edges).toBe(8);
      for (const node of graph.nodes)
        expect(node.depth).toBe(node.name.startsWith('Closed: ') ? 0 : 1);
    });
  });
}
