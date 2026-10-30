import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { echartsModule, exampleUrl, hostings, openExample, renderModes, waitReady, watchIssues, type Hosting } from './demo-helpers';

const standardSeries = [
  'bar', 'boxplot', 'candlestick', 'effect-scatter', 'funnel', 'gauge', 'heatmap', 'line', 'lines', 'map',
  'parallel', 'pictorial-bar', 'pie', 'radar', 'scatter', 'theme-river', 'tree', 'treemap', 'chord',
];

const scenarios = ['wordcloud', 'calendar-heatmap', 'sunburst-drilldown', 'force-graph', 'mirrored-time-area', 'sankey-flow', 'brush-period-picker'];

const components = [
  'polar', 'geo', 'dataset', 'markers', 'piecewise-visual-map', 'timeline', 'media', 'matrix', 'thumbnail', 'linked-grids',
  'axis-variants', 'legend-toolbox',
];

// The tests are independent pages, so the stage's workers share them instead of running the file in order on one worker.
test.describe.configure({ mode: 'parallel' });

let issues: string[] = [];

test.beforeEach(({ page }) => { issues = watchIssues(page); });

test.afterEach(() => expect(issues).toEqual([]));

async function catalog(page: Page, hosting: Hosting = 'server') {
  await page.goto(hosting === 'wasm' ? '/examples?hosting=wasm' : '/examples');
  await expect(page.getByTestId('render-mode')).toHaveText(`Interactive ${renderModes[hosting]}`);
  return page.locator('.example-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-slug')!));
}

test('Catalog_ListsEveryExampleWithUniqueSlugs', async ({ page }) => {
  // Arrange
  const slugs = await catalog(page);

  // Act
  const total = Number(await page.getByTestId('result-count').getAttribute('data-total'));

  // Assert
  expect(slugs).toHaveLength(total);
  expect(new Set(slugs).size).toBe(total);
  for (const slug of [
    ...standardSeries,
    ...components,
    ...scenarios,
    'callback-modules',
    'inline-functions',
    'updates',
    'events-actions',
    'theme-locale',
    'custom-render-item',
    'registered-custom-series',
    'consumer-extension',
    'graphic-references',
    'exports',
  ])
    expect(slugs).toContain(slug);
});

test('Catalog_SearchesByTitleAndTag', async ({ page }) => {
  // Arrange
  const total = (await catalog(page)).length;
  const search = page.getByLabel('Search by title or tag');
  const count = page.getByTestId('result-count');
  // The list follows the search after a render round trip; read it until it matches.
  const visible = () => page.locator('.example-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-slug')).sort());

  // Act
  await search.fill('sunburst');

  // Assert
  await expect(count).toHaveText(`1 of ${total} examples`);
  await expect.poll(visible).toEqual(['sunburst-drilldown']);

  // Act
  await search.fill('export connect');

  // Assert
  await expect.poll(visible).toEqual(['exports']);

  // Act
  await search.fill('no such example');

  // Assert
  await expect(count).toHaveText(`0 of ${total} examples`);

  // Act
  await search.fill('');
  await page.getByRole('button', { name: 'scenario', exact: true }).click();

  // Assert
  await expect(page.getByRole('button', { name: 'scenario', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(visible).toEqual([...scenarios].sort());
  await expect(search).toHaveValue('scenario');

  // Act
  await page.getByRole('button', { name: 'component', exact: true }).click();

  // Assert
  await expect(count).toHaveText(`${components.length} of ${total} examples`);
  await expect.poll(visible).toEqual([...components].sort());
});

// Every card shows the example's chart in a small, static form, created only once the card comes near the viewport.
for (const hosting of hostings)
  test(`Catalog_ShowsALiveThumbnailOfEveryExample_${hosting}`, async ({ page }) => {
    // Arrange
    test.setTimeout(3 * 60_000);
    const slugs = await catalog(page, hosting);
    const thumbnail = (slug: string) => page.locator(`.example-card[data-slug="${slug}"] .example-thumbnail`);

    // Assert
    await expect(thumbnail(slugs[0]).locator('.example-thumbnail-chart')).toHaveAttribute('data-chart-state', 'Ready');
    await expect(thumbnail(slugs.at(-1)!).locator('.example-thumbnail-chart')).toHaveCount(0);

    // Act & Assert
    for (const slug of slugs) {
      await thumbnail(slug).scrollIntoViewIfNeeded();
      const chart = thumbnail(slug).locator('.example-thumbnail-chart');
      await expect(chart, slug).toHaveAttribute('data-chart-state', 'Ready');
      await expect(chart.locator('canvas').first(), slug).toBeVisible();
      await expect(thumbnail(slug), slug).toHaveAttribute('aria-hidden', 'true');
    }

    // A thumbnail neither animates nor takes the pointer: the whole card is the link, and the page scrolls over a roam chart.
    const settings = await thumbnail('thumbnail').evaluate(async (element, module) => ({
      pointer: getComputedStyle(element).pointerEvents,
      animation: (await import(module)).getInstanceByDom(element.querySelector('.example-thumbnail-chart')).getOption().animation,
    }), echartsModule);
    expect(settings).toEqual({ pointer: 'none', animation: false });
  });

test('Header_LinksToTheRepositoryAndThePackage', async ({ page }) => {
  // Act
  await page.goto('/examples');

  // Assert
  const project = page.getByRole('navigation', { name: 'Project' });
  await expect(project.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/Qyperion/BlazorECharts');
  await expect(project.getByRole('link', { name: 'NuGet' })).toHaveAttribute('href', 'https://www.nuget.org/packages/Qyperion.BlazorECharts');
});

// The tour is split into shards that take every third example; together they visit the whole catalog.
const tourShards = 3;

for (const hosting of hostings)
  for (let shard = 0; shard < tourShards; shard++) {
    test(`EveryExample_ReachesReadyOnCanvasAndSvg ${hosting} ${shard + 1}/${tourShards}`, async ({ page }) => {
      // Arrange
      test.setTimeout(4 * 60_000);

      // Act
      const slugs = (await catalog(page, hosting)).filter((_, index) => index % tourShards === shard);

      // Assert
      expect(slugs.length).toBeGreaterThan(0);
      for (const slug of slugs) {
        // Client-side navigation keeps the selected render mode for the whole tour.
        await page.locator(`.example-card[data-slug="${slug}"] a`).click();
        await waitReady(page, slug, hosting);
        if (['effect-scatter', 'lines'].includes(slug))
          await expect(page.getByTestId('example-status')).toContainText('runs continuously');

        const chart = page.locator('.example-chart').first();
        await expect(chart).toHaveAttribute('data-chart-state', 'Ready');
        expect(await chart.locator('canvas').count(), slug).toBeGreaterThan(0);

        await page.getByRole('button', { name: 'SVG', exact: true }).click();
        await expect(page.locator('.example-view')).toHaveAttribute('data-renderer', 'svg');
        await waitReady(page, slug, hosting);
        await expect(page.locator('.example-chart svg').first(), slug).toBeVisible();
        expect(await page.locator('.example-chart canvas').count(), slug).toBe(0);
        await page.getByRole('link', { name: 'Examples', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Examples' })).toBeVisible();
      }
    });
  }

for (const hosting of hostings)
  test(`VariantModels_WriteTheirOwnType_${hosting}`, async ({ page }) => {
    // new XAxisTimeOption() and new InsideDataZoomOption() must not fall back to ECharts' value axis and slider.

    // Arrange
    await openExample(page, 'mirrored-time-area', hosting);

    // Act
    const types = await page.locator('.example-chart').first().evaluate(
      async (element, module) => {
        const option = (await import(module)).getInstanceByDom(element).getOption();
        return { xAxis: option.xAxis[0].type, yAxis: option.yAxis[0].type, dataZoom: option.dataZoom.map((z: { type: string }) => z.type) };
      },
      echartsModule
    );

    // Assert
    expect(types).toEqual({ xAxis: 'time', yAxis: 'value', dataZoom: ['inside', 'slider'] });
  });

// App.razor preloads both modules; a preload URL that differs from the import would download the module twice.
for (const hosting of hostings)
  test(`ModulePreload_MatchesTheImportedUrls_${hosting}`, async ({ page }) => {
    // Arrange
    const requests: string[] = [];
    page.on('request', request => {
      if (/\/_content\/BlazorECharts\/js\/(runtime-loader|echarts-6\.1\.0)\b/.test(request.url()))
        requests.push(new URL(request.url()).pathname);
    });
    await openExample(page, 'bar', hosting);

    // Act
    const preloads = await page.locator('link[rel="modulepreload"]').evaluateAll(
      links => links.map(link => new URL((link as HTMLLinkElement).href).pathname)
    );

    // Assert
    expect(preloads).toHaveLength(2);
    expect(requests.sort()).toEqual([...preloads].sort());
  });

test('ExamplePage_ShowsVersionedSourceAndRuntimeDiagnostics', async ({ page }) => {
  // Act & Assert
  for (const [slug, path] of [['bar', 'Examples/Series/BarExample.cs'], ['events-actions', 'Examples/Capabilities/EventsActionsExample.razor']]) {
    await openExample(page, slug, 'server');
    await expect(page.getByTestId('source-path')).toHaveText(path);
    const shown = await page.getByTestId('example-source').textContent();
    const file = readFileSync(`samples/BlazorECharts.Examples/${path}`, 'utf8').replace(/\r\n/g, '\n');
    expect(shown!.replace(/\r\n/g, '\n')).toBe(file);
  }

  // Act
  const toggle = page.getByRole('button', { name: 'Hide source' });
  await toggle.click();

  // Assert
  await expect(page.getByTestId('example-source')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show source' })).toHaveAttribute('aria-expanded', 'false');

  // Act
  await openExample(page, 'callback-modules', 'server');

  // Assert
  await expect(page.getByTestId('diagnostics-render-mode')).toHaveText('Interactive Server');
  await expect(page.getByTestId('diagnostics-version')).toHaveText('6.1.0 (verified by the page runtime)');
  await expect(page.getByTestId('diagnostics-assets')).toHaveText('Local package assets: _content/BlazorECharts/js/echarts-6.1.0.js');
  await expect(page.getByTestId('diagnostics-extensions')).toHaveText('echarts-wordcloud 3.0.0, examples-progress-series 1.0.0');
  await expect(page.getByTestId('diagnostics-modules')).toHaveText('_content/BlazorECharts.Examples/examples/functions.js');

  // Act
  const version = await page.locator('.example-chart').evaluate(async (element, module) => (await import(module)).version, echartsModule);

  // Assert
  expect(version).toBe('6.1.0');
});

test('ExamplePage_SwitchesAnOptionsExampleToTheDarkTheme', async ({ page }) => {
  // Arrange
  const background = () => page.locator('.example-chart').first().evaluate(
    async (element, module) => (await import(module)).getInstanceByDom(element).getOption().backgroundColor,
    echartsModule
  );
  const view = await openExample(page, 'bar', 'server');
  const light = await background();

  // Act
  await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark', exact: true }).click();

  // Assert
  await expect(view).toHaveAttribute('data-theme', 'dark');
  await expect(page).toHaveURL(/[?&]theme=dark\b/);
  await waitReady(page, 'bar', 'server');
  expect(await background()).not.toEqual(light);

  // Act
  // An interactive example chooses its own theme.
  await openExample(page, 'events-actions', 'server');

  // Assert
  await expect(page.getByRole('group', { name: 'Theme' })).toHaveCount(0);
});

test('SourceView_CopiesTheSource', async ({ page, context }) => {
  // Arrange
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openExample(page, 'bar', 'server');
  const copy = page.getByTestId('copy-source');
  await expect(copy).toHaveText('Copy source');

  // Act
  await copy.click();

  // Assert
  await expect(copy).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const file = readFileSync('samples/BlazorECharts.Examples/Examples/Series/BarExample.cs', 'utf8');
  expect(copied.replace(/\r\n/g, '\n')).toBe(file.replace(/\r\n/g, '\n'));
});

test('States_PrerenderLoadingErrorAndNotFoundAreExplicit', async ({ page, request }) => {
  // Act
  const prerendered = await (await request.get('/examples/bar')).text();

  // Assert
  expect(prerendered).toContain('data-state="loading"');
  expect(prerendered).toContain('The chart starts after the page becomes interactive.');

  // Act
  // A missing callback module is an explicit error state rather than a blank chart.
  await page.route(/\/examples\/functions(\.[a-z0-9]+)?\.js/, route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto(exampleUrl('callback-modules', 'server'));
  const status = page.getByTestId('example-status');

  // Assert
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toContainText('functions.js');
  expect(issues.every(issue => /functions\.js|404/.test(issue))).toBe(true);

  // Act
  issues.length = 0;

  await page.goto('/examples/no-such-example');

  // Assert
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example not found');
});

// Headless Chromium never hides a background tab, so the page reports itself hidden and holds back its animation frames,
// as a browser does for a background or covered window, until __show() is called.
function startHidden() {
  const native = requestAnimationFrame.bind(window);
  const frames: FrameRequestCallback[] = [];
  let hidden = true;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  window.requestAnimationFrame = callback => hidden ? frames.push(callback) : native(callback);
  (window as any).__show = () => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    frames.splice(0).forEach(callback => native(callback));
  };
}

for (const hosting of hostings)
  test(`HiddenPage_WaitsUntilShownInsteadOfReportingAStabilityTimeout ${hosting}`, async ({ page }) => {
    // Arrange
    test.setTimeout(2 * 60_000);
    await page.addInitScript(startHidden);
    await page.goto(exampleUrl('media', hosting));
    const status = page.getByTestId('example-status');
    await expect(page.locator('.example-chart canvas')).toHaveCount(1);

    // Act
    // The 30-second stability wait of the examples elapses while the page is hidden.
    await page.waitForTimeout(35_000);
    const whileHidden = await status.getAttribute('data-state');
    await page.evaluate(() => (window as any).__show());

    // Assert
    expect(whileHidden).toBe('loading');
    await expect(status).toHaveAttribute('data-state', 'ready');
  });

for (const hosting of hostings) {
  test(`Capabilities_UpdatesEventsExportsAndRegistrations ${hosting}`, async ({ page }) => {
    // Arrange
    test.setTimeout(3 * 60_000);

    const native = (slug: string) => page.locator(`.example-view[data-example="${slug}"] .example-chart`).first();

    await openExample(page, 'updates', hosting);
    const series = () => native('updates').evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        return { series: model.getSeries().map((s: any) => s.id), months: model.getComponent('xAxis').option.data.length };
      },
      echartsModule
    );

    // Act
    await page.getByRole('button', { name: 'Append a month (mutate + UpdateAsync)' }).click();

    // Assert
    await expect(page.getByTestId('update-log')).toContainText('7 months');
    await expect.poll(series).toEqual({ series: ['members'], months: 7 });

    // Act
    await page.getByRole('button', { name: 'Add forecast (partial SetOptionAsync)' }).click();

    // Assert
    await expect.poll(series).toEqual({ series: ['members', 'forecast'], months: 7 });

    // Act
    await page.getByRole('button', { name: 'Remove forecast (replaceMerge)' }).click();

    // Assert
    await expect.poll(series).toEqual({ series: ['members'], months: 7 });

    // Act
    await page.getByRole('button', { name: 'Replace options' }).click();

    // Assert
    await expect.poll(series).toEqual({ series: ['members'], months: 6 });

    // Act
    await openExample(page, 'events-actions', hosting);
    const log = page.getByTestId('event-log');
    const bar = await native('events-actions').evaluate(
      async (element, module) => {
        const layout = (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().getItemLayout(2);
        const box = element.getBoundingClientRect();
        return { x: box.left + layout.x + layout.width / 2, y: box.top + layout.y + layout.height / 2 };
      },
      echartsModule
    );
    await page.mouse.click(bar.x, bar.y);

    // Assert
    await expect(log).toContainText('click: Sent / Wed = 15');

    // Act
    await page.getByRole('button', { name: 'Toggle “Received”' }).click();

    // Assert
    await expect(log).toContainText('legendselectchanged: Received → hidden');

    // Act
    await page.getByRole('button', { name: 'Highlight Saturday' }).click();

    // Assert
    await expect(log).toContainText('highlight');

    // Act
    await page.getByRole('button', { name: 'Show tooltip for Friday' }).click();

    // Assert
    await expect(log).toContainText('showtip: data index 4');

    // Act
    await openExample(page, 'exports', hosting);
    await page.getByRole('button', { name: 'PNG of the first chart' }).click();

    // Assert
    await expect(page.getByTestId('export-result')).toHaveAttribute('data-format', 'PNG');

    // Act
    await page.getByRole('button', { name: 'Connected PNG of both charts' }).click();
    const result = page.getByTestId('export-result');

    // Assert
    await expect(result).toHaveAttribute('data-format', 'connected PNG');

    // Act
    const width = await result.locator('img').evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      return image.naturalWidth;
    });
    const single = (await native('exports').boundingBox())!.width;

    // Assert
    expect(width).toBeGreaterThan(single * 1.5);

    // Act
    await page.getByRole('button', { name: 'SVG', exact: true }).click();
    await waitReady(page, 'exports', hosting);
    await page.getByRole('button', { name: 'SVG of the first chart' }).click();

    // Assert
    await expect(page.getByTestId('export-result')).toHaveAttribute('data-format', 'SVG');

    // Act
    await openExample(page, 'theme-locale', hosting);
    await page.getByRole('button', { name: 'Dusk (registered)' }).click();

    // Assert
    await expect.poll(() => native('theme-locale').evaluate(
      async (element, module) => {
        const model = (await import(module)).getInstanceByDom(element).getModel();
        return { background: model.get('backgroundColor'), all: model.getLocaleModel().get(['legend', 'selector', 'all']) };
      },
      echartsModule
    )).toEqual({ background: '#1f2433', all: 'Show all' });

    // Act
    await openExample(page, 'map', hosting);

    // Assert
    await expect(page.getByTestId('map-regions')).toHaveText('Registered map with special areas: Rooftop.');

    // Act
    const regions = await native('map').evaluate(
      async (element, module) =>
        (await import(module)).getInstanceByDom(element).getModel().getSeriesByIndex(0).getData().count(),
      echartsModule
    );

    // Assert
    expect(regions).toBe(5);

    for (const slug of ['consumer-extension', 'registered-custom-series', 'custom-render-item', 'graphic-references']) {
      await openExample(page, slug, hosting);
      const drawn = await native(slug).evaluate(
        async (element, module) => {
          const chart = (await import(module)).getInstanceByDom(element);
          const model = chart.getModel();
          const graphic = model.getComponent('graphic');
          const image = graphic ? chart.getViewOfComponentModel(graphic).group.childAt(0)?.childAt(1)?.style?.image : null;
          const series = model.getSeriesByIndex(0);
          return {
            type: series.subType,
            items: series.getData().count(),
            elements: chart.getViewOfSeriesModel(series).group.childCount(),
            image: image ? { complete: image.complete, width: image.naturalWidth } : null,
          };
        },
        echartsModule
      );
      if (slug === 'consumer-extension')
        expect(drawn).toMatchObject({ type: 'progress', items: 4 });

      if (slug === 'registered-custom-series')
        expect(drawn).toMatchObject({ type: 'custom', items: 3, elements: 3 });

      if (slug === 'custom-render-item')
        expect(drawn).toMatchObject({ type: 'custom', items: 4, elements: 4 });

      if (slug === 'graphic-references')
        expect(drawn.image).toEqual({ complete: true, width: 96 });

      expect(drawn.elements, slug).toBeGreaterThan(0);
    }
  });
}

test('CallbackModule_TooltipEncodesSeriesNames', async ({ page }) => {
  // Arrange
  await openExample(page, 'mirrored-time-area', 'server');

  // Act
  const html = await page.evaluate(async () => {
    const callbacks = await import('/_content/BlazorECharts.Examples/examples/functions.js');
    return callbacks.mirroredTooltip([
      { marker: '', seriesName: '<img src=x onerror=alert(1)>', value: [0, -3], axisValue: Date.UTC(2026, 0, 1) },
    ]) as string;
  });

  // Assert
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;: 3');
  expect(html).not.toContain('<img');
});
