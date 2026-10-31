import { test, expect, type Locator, type Page, type WebSocketRoute } from '@playwright/test';
import { standaloneURL } from '../hosts';
import { echartsModule, watchIssues } from './demo-helpers';

type Mode = 'server' | 'wasm' | 'auto' | 'standalone';
const modes: Mode[] = ['server', 'wasm', 'auto', 'standalone'];

// Auto in a fresh browser context starts on Server; the standalone app is WebAssembly only.
const renderer: Record<Mode, string> = { server: 'Server', wasm: 'WebAssembly', auto: 'Server', standalone: 'WebAssembly' };

function url(mode: Mode, path: string): string {
  if (mode === 'standalone')
    return `${standaloneURL}${path}`;

  return mode === 'server' ? path : `${path}${path.includes('?') ? '&' : '?'}hosting=${mode}`;
}

// Charts of examples; the thumbnails of the catalog are counted by catalogCharts.
const instances = (page: Page) => page.evaluate(
  () => document.querySelectorAll('[_echarts_instance_]:not([_echarts_instance_=""]):not(.example-thumbnail-chart)').length
);

// Waits until the thumbnails of the visible cards are ready and returns their number: once an example is left, the
// page runtime owns exactly these charts and their size observations.
async function catalogCharts(page: Page): Promise<number> {
  const thumbnails = page.locator('.example-thumbnail-chart');
  await expect(thumbnails.first()).toHaveAttribute('data-chart-state', 'Ready');
  await expect(page.locator('.example-thumbnail-chart:not([data-chart-state="Ready"])')).toHaveCount(0);
  return thumbnails.count();
}
const status = (page: Page) => page.getByTestId('example-status');

// What the page runtime still owns: charts, size observations and native event subscriptions.
const owned = (page: Page) => page.evaluate(async () => {
  const { charts, observations, subscriptions } = (await import(
    new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href
  )).resourceStatistics();
  return { charts, observations, subscriptions };
});

// Two animation frames: work queued by a resolved import or a timer of a running layout has had its turn.
const frames = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function trackRejections(page: Page) {
  await page.addInitScript(() => {
    (window as any).__rejections = [];
    addEventListener('unhandledrejection', event => (window as any).__rejections.push(String(event.reason)));
  });
}

async function open(page: Page, mode: Mode, slug: string, expected = renderer[mode]) {
  await page.goto(url(mode, `/examples/${slug}`));
  const view = page.locator(`.example-view[data-example="${slug}"]`);
  await expect(view).toHaveAttribute('data-render-mode', expected);
  await expect(status(page)).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
  return view;
}

let issues: string[] = [];

test.beforeEach(async ({ page }) => {
  issues = watchIssues(page);
  await trackRejections(page);
});

test.afterEach(async ({ page }) => {
  expect(issues).toEqual([]);
  if (!page.isClosed())
    expect(await page.evaluate(() => (window as any).__rejections ?? [])).toEqual([]);
});

for (const mode of modes) {
  test(`RenderMode_ComesFromRendererInfo ${mode}`, async ({ page }) => {
    // Act
    const view = await open(page, mode, 'bar');

    // Assert
    await expect(view).toHaveAttribute('data-interactive', 'true');
    await expect(page.getByTestId('render-mode')).toHaveText(`Interactive ${renderer[mode]}`);
    await expect(page.getByTestId('diagnostics-render-mode')).toHaveText(`Interactive ${renderer[mode]}`);
    await expect(page.getByTestId('diagnostics-host')).toHaveText(mode === 'standalone' ? 'Standalone WebAssembly' : 'Blazor Web App');
    await expect.poll(() => instances(page)).toBe(1);
  });
}

// The policy of docs/security.md for standalone WebAssembly; the sample's index.html has no inline import map.
test('Standalone_StrictCsp_RendersModuleFunctionsAndHtmlTooltip', async ({ page }) => {
  // Arrange
  const policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'self'; object-src 'none'";
  await page.route(url => url.origin === standaloneURL, async route => {
    if (route.request().resourceType() !== 'document')
      return route.continue();

    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  await page.addInitScript(() => {
    (window as any).violations = [];
    document.addEventListener('securitypolicyviolation', e => (window as any).violations.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
  const view = await open(page, 'standalone', 'callback-modules');

  // Act
  const tooltip = await view.locator('.example-chart').first().evaluate(async element => {
    const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
    const chart = ec.getInstanceByDom(element);
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 });
    await new Promise(resolve => setTimeout(resolve, 100));
    return [...element.querySelectorAll('div')].some(div => getComputedStyle(div).position === 'absolute' && div.textContent!.trim().length > 0);
  });

  // Assert
  expect(tooltip).toBe(true);
  expect(await page.evaluate(() => (window as any).violations)).toEqual([]);
});

test('Favicon_IsTheProjectIconInBothHosts', async ({ page, request }) => {
  for (const mode of ['server', 'standalone'] as const) {
    // Act
    await page.goto(url(mode, '/examples'));
    const href = await page.locator('link[rel="icon"]').evaluate(link => (link as HTMLLinkElement).href);
    const response = await request.get(href);

    // Assert
    expect(response.status(), mode).toBe(200);
    expect(response.headers()['content-type'], mode).toContain('image/svg+xml');
    expect(await response.text(), mode).toContain('<svg');
  }
});

// The trimmed standalone app keeps the typed timeline event and action and the dataset transforms of the Components group.
test('Standalone_RendersComponentExamples', async ({ page }) => {
  // Arrange
  const model = (view: Locator, read: string) => view.locator('.example-chart').first().evaluate(
    async (element, read) => {
      const ec = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
      const model = ec.getInstanceByDom(element).getModel();
      return read === 'timeline' ? model.getComponent('timeline').getCurrentIndex() : model.getSeriesByIndex(2).getData().count();
    },
    read
  );
  const timeline = await open(page, 'standalone', 'timeline');

  // Act
  await page.getByRole('button', { name: 'Next quarter' }).click();

  // Assert
  await expect(page.getByTestId('timeline-step')).toHaveText('timelinechanged: showing Q2 (step 2 of 4).');
  expect(await model(timeline, 'timeline')).toBe(1);

  // Act
  const dataset = await open(page, 'standalone', 'dataset');

  // Assert
  expect(await model(dataset, 'dataset')).toBe(6);
});

for (const mode of ['server', 'wasm', 'auto'] as const) {
  test(`Prerender_ShowsPlaceholderBeforeHydration ${mode}`, async ({ page }) => {
    // Arrange
    let release!: () => void;
    const held = new Promise<void>(resolve => release = resolve);
    await page.route(/_framework\/blazor\.web(\.[a-z0-9]+)?\.js/, async route => {
      await held;
      await route.continue();
    });

    // The held classic script blocks DOMContentLoaded, so wait for the prerendered markup itself.
    await page.goto(url(mode, '/examples/pie'), { waitUntil: 'commit' });

    // Act
    const view = page.locator('.example-view[data-example="pie"]');

    // Assert
    await expect(view).toHaveAttribute('data-render-mode', 'Static');
    await expect(status(page)).toHaveAttribute('data-state', 'loading');
    await expect(status(page)).toHaveText('The chart starts after the page becomes interactive.');
    await expect(page.locator('.example-chart')).toHaveAttribute('data-chart-state', 'NotInitialized');
    expect(await page.locator('.example-chart canvas').count()).toBe(0);
    await expect.poll(() => instances(page)).toBe(0);

    // Act
    release();

    // Assert
    await expect(view).toHaveAttribute('data-render-mode', renderer[mode]);
    await expect(status(page)).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    await expect.poll(() => instances(page)).toBe(1);
  });
}

test('Auto_StartsOnServerThenUsesDownloadedWebAssembly', async ({ browser, baseURL }) => {
  // Each browser context starts with an empty HTTP cache and storage; service workers are blocked.

  // Arrange
  const fresh = () => browser.newContext({ baseURL, serviceWorkers: 'block' });
  const context = await fresh();
  try {
    const page = await context.newPage();
    const local = watchIssues(page);
    const runtime = page.waitForResponse(response => /_framework\/dotnet\.native\.[^/]*\.wasm/.test(response.url()) && response.ok(), {
      timeout: 60_000,
    });
    await open(page, 'auto', 'bar', 'Server');

    // Auto downloads the WebAssembly runtime in the background while the Server circuit renders.
    await runtime;
    await page.waitForLoadState('networkidle');

    // Act
    await open(page, 'auto', 'bar', 'WebAssembly');

    // Assert
    await expect.poll(() => instances(page)).toBe(1);
    expect(local).toEqual([]);

    const other = await fresh();
    try {
      const clean = await other.newPage();
      await open(clean, 'auto', 'bar', 'Server');
    } finally {
      await other.close();
    }
  } finally {
    await context.close();
  }
});

for (const mode of modes) {
  test(`Lifecycle_TabsPanelRemovalSubscriptionsRecreateAndFacades ${mode}`, async ({ page }) => {
    // Arrange
    const view = await open(page, mode, 'lifecycle-lab');
    const activity = view.locator('.lab-activity');

    // Act
    const members = view.locator('.lab-members');

    // Assert
    await expect(page.getByTestId('lab-second-state')).toHaveText('Second facade: one chart.');

    // The hidden tab waits for a usable size before allocating a chart.
    await expect(members).toHaveAttribute('data-chart-state', 'Initializing');
    await expect.poll(() => instances(page)).toBe(2);

    for (let i = 0; i < 2; i++) {
      await page.getByRole('tab', { name: 'Members' }).click();
      await expect(members).toHaveAttribute('data-chart-state', 'Ready');
      await page.getByRole('tab', { name: 'Activity' }).click();
    }

    await expect.poll(() => instances(page)).toBe(3);

    // Act
    const width = () => activity.evaluate(
      async (element, module) => ({
        element: element.clientWidth,
        chart: (await import(module)).getInstanceByDom(element).getWidth(),
      }),
      echartsModule
    );
    const before = await width();
    await page.getByRole('button', { name: 'Collapse panel' }).click();

    // Assert
    await expect.poll(async () => (await width()).element).toBeGreaterThan(before.element + 50);
    await expect.poll(async () => {
      const now = await width();
      return now.chart === now.element;
    }).toBe(true);

    // Act
    const clickBar = async () => {
      const point = await activity.evaluate(
        async (element, module) => {
          const layout = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().getItemLayout(3);
          const box = element.getBoundingClientRect();
          return { x: box.left + layout.x + layout.width / 2, y: box.top + layout.y + layout.height / 2 };
        },
        echartsModule
      );
      await page.mouse.click(point.x, point.y);
    };
    const clicks = page.getByTestId('lab-clicks');
    const first = () => activity.evaluate(
      async (element, module) =>
        (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().get('y', 0),
      echartsModule
    );
    await page.getByRole('button', { name: 'Listen to clicks' }).click();

    // With Interactive Server the subscription reaches the browser after a round trip; the button shows it.
    await expect(page.getByRole('button', { name: 'Listen to clicks' })).toHaveAttribute('aria-pressed', 'true');
    await clickBar();

    // Assert
    await expect(clicks).toHaveAttribute('data-count', '1');

    // Act
    // Recreating the native chart keeps the managed handle and rebinds the live subscription.
    await page.getByTestId('lab-renderer').selectOption('svg');

    // Assert
    await expect(activity.locator('svg').first()).toBeVisible();
    await expect(activity).toHaveAttribute('data-chart-state', 'Ready');
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.lab-activity canvas').length)).toBe(0);
    await expect.poll(() => instances(page)).toBe(3);

    // Act & Assert
    // The live subscription is bound again after the replacement chart is ready.
    await expect(async () => {
      await clickBar();
      await expect(clicks).toHaveAttribute('data-count', '2', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    // Act
    const listening = (await owned(page)).subscriptions;
    await page.getByRole('button', { name: 'Listen to clicks' }).click();

    // Assert
    await expect.poll(async () => (await owned(page)).subscriptions).toBe(listening - 1);

    // Act
    await clickBar();

    // A later round trip through .NET: a delivered click would be handled before it.
    const data = await first();
    await page.getByRole('button', { name: 'Update data' }).click();

    // Assert
    await expect.poll(first).not.toBe(data);
    await expect(clicks).toHaveAttribute('data-count', '2');

    // Act
    await page.getByRole('button', { name: 'Remove the activity chart' }).click();

    // Assert
    await expect(activity).toHaveCount(0);
    await expect.poll(() => instances(page)).toBe(2);

    // Act
    await page.getByRole('button', { name: 'Restore the activity chart' }).click();

    // Assert
    await expect(activity).toHaveAttribute('data-chart-state', 'Ready');
    await expect.poll(() => instances(page)).toBe(3);

    // Act
    // Disposing another facade releases only its own chart.
    await page.getByRole('button', { name: 'Dispose the second facade' }).click();

    // Assert
    await expect(page.getByTestId('lab-second-state')).toHaveText('Second facade disposed; its chart was released.');
    await expect.poll(() => instances(page)).toBe(2);

    // Act
    const value = await first();
    await page.getByRole('button', { name: 'Update data' }).click();

    // Assert
    await expect.poll(first).not.toBe(value);
  });
}

for (const mode of ['server', 'wasm', 'standalone'] as const) {
  test(`Navigation_BackAndForwardKeepOneChartPerContainer ${mode}`, async ({ page }) => {
    // Act
    await page.goto(url(mode, '/examples'));

    // Assert
    await expect(page.getByTestId('render-mode')).toHaveText(`Interactive ${renderer[mode]}`);
    const visit = async (slug: string) => {
      await expect(page.locator(`.example-view[data-example="${slug}"]`)).toBeVisible();
      await expect(status(page)).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
      await expect.poll(() => instances(page)).toBe(await page.locator('.example-chart').count());
    };

    // Act
    await page.locator('.example-card[data-slug="bar"] a').click();
    await visit('bar');
    await page.getByRole('link', { name: 'Examples', exact: true }).click();
    await page.locator('.example-card[data-slug="exports"] a').click();
    await visit('exports');

    // Assert
    for (let i = 0; i < 2; i++) {
      await page.goBack();
      await expect(page.getByRole('heading', { level: 1, name: 'Examples' })).toBeVisible();
      await expect.poll(() => instances(page)).toBe(0);
      await page.goBack();
      await visit('bar');
      await page.goForward();
      await page.goForward();
      await visit('exports');
    }
  });

  test(`CatalogLeftWhileThumbnailModuleLoads_KeepsWorking ${mode}`, async ({ page }) => {
    // Arrange
    let release!: () => void;
    const held = new Promise<void>(resolve => release = resolve);
    const thumbnailModule = /_content\/BlazorECharts\.Examples\/catalog\/thumbnails(\.[a-z0-9]+)?\.js/;
    await page.route(thumbnailModule, async route => {
      await held;
      await route.continue();
    });
    const requested = page.waitForRequest(thumbnailModule);

    // Act
    await page.goto(url(mode, '/examples'));
    await requested;

    // Leave before the catalog has started observing its cards.
    await page.locator('.example-card[data-slug="bar"] a').click();

    // Assert
    await expect(page.locator('.example-view[data-example="bar"]')).toBeVisible();

    // Act
    const loaded = page.waitForEvent('requestfinished', request => thumbnailModule.test(request.url()));
    release();

    // Importing the same URL settles once the held module is evaluated; the catalog's continuation follows.
    await page.evaluate(async url => { await import(url); }, (await loaded).url());
    await frames(page);
    await page.getByRole('link', { name: 'Examples', exact: true }).click();

    // Assert
    await expect(page.getByRole('heading', { level: 1, name: 'Examples' })).toBeVisible();
    expect(await catalogCharts(page)).toBeGreaterThan(0);
  });

  test(`RemovalDuringImportAndLayout_LeavesNoLateWork ${mode}`, async ({ page }) => {
    // Arrange
    let release!: () => void;
    const held = new Promise<void>(resolve => release = resolve);
    const engine = /_content\/BlazorECharts\/js\/echarts-6\.1\.0(\.[a-z0-9]+)?\.js/;
    await page.route(engine, async route => {
      await held;
      await route.continue();
    });

    // Act
    await page.goto(url(mode, '/examples'));

    // Assert
    await expect(page.getByTestId('render-mode')).toHaveText(`Interactive ${renderer[mode]}`);

    // Act
    // Leave while the ECharts module is still being imported.
    await page.locator('.example-card[data-slug="wordcloud"] a').click();

    // Assert
    await expect(page.locator('.example-chart')).toHaveAttribute('data-chart-state', 'Initializing');

    // Act
    await page.getByRole('link', { name: 'Examples', exact: true }).click();

    // Assert
    await expect(page.getByRole('heading', { level: 1, name: 'Examples' })).toBeVisible();

    // Act
    const loaded = page.waitForEvent('requestfinished', request => engine.test(request.url()));
    release();

    // Importing the same URL settles once the held engine is evaluated; the loader's continuation follows.
    await page.evaluate(async url => { await import(url); }, (await loaded).url());
    await frames(page);
    let thumbnails = await catalogCharts(page);

    // Assert
    expect(await owned(page)).toEqual({ charts: thumbnails, observations: thumbnails, subscriptions: 0 });
    await expect.poll(() => instances(page)).toBe(0);

    // Act
    // Leave while a new WordCloud layout is running.
    await page.locator('.example-card[data-slug="wordcloud"] a').click();

    // Assert
    await expect(status(page)).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });

    // Act
    await page.getByLabel('Shape').selectOption('star');
    await page.getByRole('link', { name: 'Examples', exact: true }).click();

    // Assert
    await expect(page.getByRole('heading', { level: 1, name: 'Examples' })).toBeVisible();
    thumbnails = await catalogCharts(page);
    await expect.poll(() => owned(page)).toEqual({ charts: thumbnails, observations: thumbnails, subscriptions: 0 });

    // Act
    await frames(page);

    // Assert
    expect(await owned(page)).toEqual({ charts: thumbnails, observations: thumbnails, subscriptions: 0 });
    await expect.poll(() => instances(page)).toBe(0);
  });
}

for (const mode of ['server', 'wasm'] as const) {
  test(`Lifecycle_RecreateInAHiddenTabThenAutoResizeOff_RecreatesWhenShown ${mode}`, async ({ page }) => {
    // Arrange
    const view = await open(page, mode, 'lifecycle-lab');

    // Act
    const activity = view.locator('.lab-activity');

    // Assert
    await expect(activity).toHaveAttribute('data-chart-state', 'Ready');

    // Act
    const sizeChecks = () => page.evaluate(async () => (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href))
      .resourceStatistics().toBrowser.checkChartSize ?? 0);
    const checks = await sizeChecks();
    await page.getByRole('tab', { name: 'Members' }).click();

    // The recreation waits for the hidden tab; AutoResize is turned off while it waits.
    await page.getByTestId('lab-renderer').selectOption('svg');

    // Assert
    await expect.poll(sizeChecks).toBeGreaterThan(checks);

    // Act
    await page.getByLabel('Resize with the container').uncheck();
    await frames(page);
    await page.getByRole('tab', { name: 'Activity' }).click();

    // Assert
    await expect(activity.locator('svg').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('.lab-activity canvas').length)).toBe(0);
    await expect(activity).toHaveAttribute('data-chart-state', 'Ready');
    await expect(status(page)).toHaveAttribute('data-state', 'ready');
  });
}

test('ServerReconnect_KeepsChartsWithoutDuplicates', async ({ page }) => {
  // Arrange
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/_blazor/, socket => {
    socket.connectToServer();
    sockets.push(socket);
  });

  // Act
  const view = await open(page, 'server', 'lifecycle-lab');

  // Assert
  await expect(page.getByTestId('lab-second-state')).toHaveText('Second facade: one chart.');

  // Act
  const before = await instances(page);

  // A page reload would lose this marker; the reconnect keeps the page and its circuit.
  await page.evaluate(() => { (window as any).reconnectMarker = 'same page'; });
  await sockets.at(-1)!.close({ code: 4000, reason: 'Simulated network loss' });

  // Assert
  // Blazor reconnects to the retained circuit; the existing native charts stay and keep working.
  await expect.poll(() => sockets.length, { timeout: 30_000 }).toBeGreaterThan(1);

  // Arrange
  const first = () => view.locator('.lab-activity').evaluate(
    async (element, module) =>
      (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().get('y', 0),
    echartsModule
  );
  const value = await first();

  // Act & Assert
  await expect(async () => {
    await page.getByRole('button', { name: 'Update data' }).click();
    expect(await first()).not.toBe(value);
  }).toPass({ timeout: 30_000 });
  expect(await instances(page)).toBe(before);
  expect(await page.evaluate(() => (window as any).reconnectMarker)).toBe('same page');

  // Blazor reports the simulated loss itself on the console.
  issues = issues.filter(issue => !/status code: 4000|Simulated network loss/.test(issue));
});
