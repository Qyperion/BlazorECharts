import { test, expect, type Page } from '@playwright/test';

// ZrEvents subscriptions listen on chart.getZr(): pointer events reach .NET also while the brush cursor is active,
// when ECharts raises no series click, and follow the chart when InitOptions recreate it.
const events = (page: Page) => page.getByTestId('events');

const native = <T>(page: Page, read: (chart: any) => T) => page.locator('.zrender-chart').evaluate(
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
  await page.goto(`/harness/zrender/${mode}`);
  await expect(page.getByTestId('ready')).toHaveText('ready');
  return issues;
}

async function run(page: Page, button: string, status: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByTestId('status')).toHaveText(status);
}

// The page position of a month at a value of its y axis.
async function at(page: Page, month: string, value: number) {
  const point = await page.locator('.zrender-chart').evaluate(
    async (element: HTMLElement, [name, y]: [string, number]) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      return ec.getInstanceByDom(element).convertToPixel({ gridIndex: 0 }, [name, y]) as number[];
    },
    [month, value] as [string, number]
  );
  const box = (await page.locator('.zrender-chart').boundingBox())!;
  return { x: box.x + point[0], y: box.y + point[1], offsetX: Math.round(point[0]), offsetY: Math.round(point[1]) };
}

// Clicks inside the bar of a month, at the value 1 of its y axis.
async function clickMonth(page: Page, month: string, value = 1) {
  const point = await at(page, month, value);
  await page.mouse.click(point.x, point.y);
  return point;
}

for (const mode of ['server', 'wasm']) {
  test(`ZrClick_ReachesDotNetWhereEChartsRaisesNoSeriesClick_AndMapsToACategory_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);
    await run(page, 'Arm brush', 'armed');
    const from = await at(page, 'Feb', 1);
    const to = await at(page, 'Apr', 1);

    // Act
    // A drag selects Feb to Apr; ZRender drops the click that follows it.
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();

    // Assert
    await expect(events(page)).toHaveText('zr-mousedown button=0');
    await expect.poll(() => native(page, chart => chart.getModel().getComponent('brush').areas.length)).toBe(1);

    // Act
    // The brush cover lies over the bar of Mar, so ECharts raises no series click there.
    await page.keyboard.down('Control');
    const cover = await clickMonth(page, 'Mar');
    await page.keyboard.up('Control');

    // Assert
    await expect(events(page)).toHaveText([
      'zr-mousedown button=0',
      'zr-mousedown button=0',
      `zr-click Mar button=0 ctrl=True target=True x=${cover.offsetX} y=${cover.offsetY}`,
    ].join('\n'));

    // Act
    // Above the bar of Jan is the empty part of its category.
    const empty = await clickMonth(page, 'Jan', 7.5);
    const box = (await page.locator('.zrender-chart').boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + 10);

    // Assert
    await expect(events(page)).toHaveText([
      'zr-mousedown button=0',
      'zr-mousedown button=0',
      `zr-click Mar button=0 ctrl=True target=True x=${cover.offsetX} y=${cover.offsetY}`,
      'zr-mousedown button=0',
      `zr-click Jan button=0 ctrl=False target=False x=${empty.offsetX} y=${empty.offsetY}`,
      'zr-mousedown button=0',
      'zr-click outside button=0 ctrl=False target=False x=10 y=10',
    ].join('\n'));
    expect(issues).toEqual([]);
  });

  test(`ZrSubscriptions_MoveToTheRecreatedChartAndStopWhenDisposed_${mode}`, async ({ page }) => {
    // Arrange
    const issues = await open(page, mode);

    // Act
    await run(page, 'Toggle renderer', 'svg');
    await expect.poll(() => native(page, chart => chart.getZr().painter.getType())).toBe('svg');
    const bar = await clickMonth(page, 'May');

    // Assert
    await expect(events(page)).toHaveText([
      'zr-mousedown button=0',
      'series-click May',
      `zr-click May button=0 ctrl=False target=True x=${bar.offsetX} y=${bar.offsetY}`,
    ].join('\n'));

    // Act
    await run(page, 'Unsubscribe', 'unsubscribed');
    await clickMonth(page, 'May');
    await clickMonth(page, 'Jun');

    // Assert
    await expect(events(page)).toHaveText(['zr-mousedown button=0', 'series-click May', 'zr-mousedown button=0', 'series-click Jun'].join('\n'));
    expect(issues).toEqual([]);
  });
}
