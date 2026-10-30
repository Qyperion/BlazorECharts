import { test as base, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { echartsModule, openExample, waitReady, watchIssues } from '../demo/demo-helpers';
import { countColorPixels, countFilledShapes } from '../image-pixels';

type Launch = { browser?: Browser; error?: string };
type TestFixtures = { page: Page; contextOptions: BrowserContextOptions };
type WorkerFixtures = { launched: Launch };

// An installed browser that cannot start is BLOCKED: its scenarios are skipped with the launch error instead of failing.
const test = base.extend<TestFixtures, WorkerFixtures>({
  launched: [
    async ({ playwright, browserName }, use, workerInfo) => {
      let browser: Browser | undefined;
      try {
        browser = await playwright[browserName].launch({ channel: workerInfo.project.use.channel, headless: true });
      } catch (error) {
        await use({ error: String((error as Error).message).split(/\r?\n/)[0] });
        return;
      }

      await use({ browser });
      await browser.close();
    },
    { scope: 'worker' },
  ],
  contextOptions: async ({}, use, testInfo) => {
    const { baseURL, viewport, deviceScaleFactor, userAgent, isMobile, hasTouch } = testInfo.project.use;
    await use({ baseURL, viewport, deviceScaleFactor, userAgent, isMobile, hasTouch });
  },
  page: async ({ launched, contextOptions }, use, testInfo) => {
    if (!launched.browser) {
      testInfo.annotations.push({ type: 'blocked', description: launched.error });
      testInfo.skip(true, `BLOCKED: ${launched.error}`);
      return;
    }

    testInfo.annotations.push({ type: 'browserVersion', description: `${launched.browser.browserType().name()} ${launched.browser.version()}` });
    const context = await launched.browser.newContext(contextOptions);
    await use(await context.newPage());
    await context.close();
  },
});

// The same scenarios in every installed matrix browser; titles are the scenario names of browser-matrix.json.
let issues: string[] = [];

test.beforeEach(({ page }) => { issues = watchIssues(page); });

test.afterEach(() => expect(issues).toEqual([]));

// Rendering and export also run on WebAssembly: the *Wasm scenarios.
for (const [suffix, hosting] of [['', 'server'], ['Wasm', 'wasm']] as const) {
  test(`CanvasAndSvgRender${suffix}`, async ({ page }) => {
    // Act
    const canvas = await openExample(page, 'bar', hosting);

    // Assert
    await expect(canvas.locator('.example-chart canvas')).toHaveCount(1);

    // Act
    const svg = await openExample(page, 'bar', hosting, 'svg');

    // Assert
    await expect(svg.locator('.example-chart svg').first()).toBeVisible();

    // Act
    const series = await svg.locator('.example-chart').evaluate(
      async (element, module) => {
        const data = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData();
        return { bars: data.count(), fill: data.getVisual('style').fill as string };
      },
      echartsModule
    );

    // Assert
    expect(series.bars).toBe(7);

    // Act
    // Every bar is an SVG shape in the series color; a chart without its series elements does not pass.
    const markup = await svg.locator('.example-chart svg').first().evaluate(element => element.outerHTML);

    // Assert
    expect(await countFilledShapes(page, markup, series.fill)).toBeGreaterThanOrEqual(series.bars);
  });

  test(`PngAndSvgExport${suffix}`, async ({ page }) => {
    // Arrange
    await openExample(page, 'exports', hosting);
    await page.getByRole('button', { name: 'PNG of the first chart' }).click();

    // Act
    const result = page.getByTestId('export-result');

    // Assert
    await expect(result).toHaveAttribute('data-format', 'PNG');

    // Act
    const png = await result.locator('img').evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      return image.naturalWidth;
    });

    // Assert
    expect(png).toBeGreaterThan(300);

    // Act
    // The bars are drawn in the series color: an empty image of the right size does not pass.
    const fill = await page.locator('.example-chart').first().evaluate(
      async (element, module) =>
        (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().getVisual('style').fill as string,
      echartsModule
    );

    // Assert
    expect(await countColorPixels(page, (await result.locator('img').getAttribute('src'))!, fill)).toBeGreaterThan(5_000);

    // Act
    await page.getByRole('button', { name: 'SVG', exact: true }).click();
    await waitReady(page, 'exports', hosting);
    await page.getByRole('button', { name: 'SVG of the first chart' }).click();

    // Assert
    await expect(page.getByTestId('export-result')).toHaveAttribute('data-format', 'SVG');

    // Act
    const svg = decodeURIComponent((await page.getByTestId('export-result').locator('img').getAttribute('src'))!);

    // Assert
    expect(svg).toContain('<svg');

    // Act
    const exported = await page.locator('.example-chart').first().evaluate(
      async (element, module) => {
        const data = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData();
        return { items: data.count(), fill: data.getVisual('style').fill as string };
      },
      echartsModule
    );

    // Assert
    expect(await countFilledShapes(page, svg.slice(svg.indexOf('<svg')), exported.fill)).toBeGreaterThanOrEqual(exported.items);
  });
}

test('WordCloudCallbacks', async ({ page }) => {
  // Arrange
  const view = await openExample(page, 'wordcloud', 'server', 'svg');
  const words = await view.locator('.example-chart').evaluate(
    async (element, module) => {
      const data = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData();
      return Array.from({ length: data.count() }, (_, i) => i)
        .filter(i => data.getItemGraphicEl(i))
        .map(i => ({ index: i, fill: data.getItemGraphicEl(i).style.fill }));
    },
    echartsModule
  );

  // Act
  const palette = ['#2f5fd0', '#2f9e44', '#e8590c', '#ae3ec9', '#1098ad', '#f08c00'];

  // Assert
  expect(words.length).toBeGreaterThan(30);
  for (const word of words)
    expect(word.fill).toBe(palette[word.index % palette.length]);
});

test('BrushSelectsRange', async ({ page }) => {
  // Arrange
  const view = await openExample(page, 'brush-period-picker', 'server');
  const chart = view.locator('.example-chart');
  const points = await chart.evaluate(
    async (element, module) => {
      const native = (await import(module)).getInstanceByDom(element);
      const box = element.getBoundingClientRect();
      const grid = native.getModel().getComponent('grid').coordinateSystem.getRect();
      const from = native.convertToPixel({ gridIndex: 0 }, [10, 0]);
      const to = native.convertToPixel({ gridIndex: 0 }, [14, 0]);
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
  await expect(selection).toHaveAttribute('data-first', '10');
  await expect(selection).toHaveAttribute('data-last', '14');
});

test('ViewportAndDevicePixelRatio', async ({ page: desktop, contextOptions }) => {
  // Arrange
  const context = await desktop.context().browser()!.newContext({ ...contextOptions, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const local = watchIssues(page);
  try {
    const view = await openExample(page, 'line', 'server');

    // Act
    const sizes = await view.locator('.example-chart').evaluate(element => {
      const canvas = element.querySelector('canvas')!;
      return {
        css: element.clientWidth,
        pixels: canvas.width,
        ratio: window.devicePixelRatio,
        page: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });

    // Assert
    expect(sizes.ratio).toBe(2);
    expect(sizes.pixels).toBe(sizes.css * 2);
    expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
    expect(local).toEqual([]);
  } finally {
    await context.close();
  }
});
