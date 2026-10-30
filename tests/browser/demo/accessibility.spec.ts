import { test, expect, type Page } from '@playwright/test';
import { exampleUrl, openExample, waitReady, watchIssues } from './demo-helpers';

let issues: string[] = [];

test.beforeEach(({ page }) => { issues = watchIssues(page); });

test.afterEach(() => expect(issues).toEqual([]));

/** Presses Tab until the focused element matches, failing after a bounded number of steps. */
async function tabTo(page: Page, describe: string, matches: (element: Element) => boolean, limit = 40) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(`(${matches.toString()})(document.activeElement)`);
    if (found) {
      const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
      expect(outline, `${describe} has a visible focus indicator`).not.toBe('none');
      return;
    }
  }

  throw new Error(`Keyboard focus never reached ${describe}.`);
}

test('Keyboard_ReachesCatalogSearchTagsLinksAndExampleControls', async ({ page }) => {
  // Act
  await page.goto('/examples');

  // Assert
  await expect(page.getByTestId('render-mode')).toHaveText('Interactive Server');

  // Navigation focuses the page heading; the skip link is the first stop before it.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

  // Act
  await page.keyboard.press('Shift+Tab');

  // Assert
  await expect(page.locator('.hosting-switch a').last()).toBeFocused();

  // Act
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();

  // Assert
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);

  // Act
  await page.keyboard.press('Enter');

  // Assert
  await expect(page.locator('main')).toBeFocused();

  // Act
  await tabTo(page, 'the search box', element => element.id === 'example-search');
  await page.keyboard.type('radar');

  // Assert
  await expect(page.getByTestId('result-count')).toContainText('1 of');

  // Act
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await tabTo(page, 'the scenario tag', element => element.textContent?.trim() === 'scenario');
  await page.keyboard.press('Enter');

  // Assert
  await expect(page.getByRole('button', { name: 'scenario', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Act
  await tabTo(page, 'the brush example link', element => element.getAttribute('href') === 'examples/brush-period-picker');
  await page.keyboard.press('Enter');
  await waitReady(page, 'brush-period-picker', 'server');

  await page.goto(exampleUrl('events-actions', 'server'));
  await waitReady(page, 'events-actions', 'server');
  await tabTo(page, 'the SVG renderer button', element => element.textContent?.trim() === 'SVG');
  await page.keyboard.press('Space');

  // Assert
  await expect(page.locator('.example-view')).toHaveAttribute('data-renderer', 'svg');

  // Act
  await waitReady(page, 'events-actions', 'server');
  await tabTo(page, 'an action button', element => element.textContent?.trim() === 'Highlight Saturday');
  await page.keyboard.press('Enter');

  // Assert
  await expect(page.getByTestId('event-log')).toContainText('highlight');
});

test('Charts_HaveTextSummaryAndEChartsAriaDescription', async ({ page }) => {
  // The timeline example declares a base option, which is where ECharts reads its aria component.

  // Act & Assert
  for (const slug of ['bar', 'calendar-heatmap', 'exports', 'sankey-flow', 'timeline']) {
    const view = await openExample(page, slug, 'server');
    const figure = view.locator('.example-figure');
    const summaryId = await figure.getAttribute('aria-describedby');
    await expect(page.locator(`#${summaryId}`)).not.toBeEmpty();
    await expect(figure).toHaveAttribute('aria-label', /chart$/);
    for (const chart of await view.locator('.example-chart').all())
      await expect(chart, slug).toHaveAttribute('aria-label', /^This is a chart/);
  }
});

test('NarrowViewport_KeepsControlsInsideTheScreen', async ({ page }) => {
  // Arrange
  await page.setViewportSize({ width: 375, height: 812 });

  // Act
  const pages = [
    '/examples',
    exampleUrl('exports', 'server'),
    exampleUrl('events-actions', 'server'),
    exampleUrl('updates', 'server'),
    exampleUrl('wordcloud', 'server'),
    exampleUrl('brush-period-picker', 'server'),
    exampleUrl('theme-locale', 'server'),
    exampleUrl('media', 'server'),
  ];

  // Assert
  for (const url of pages) {
    await page.goto(url);
    await expect(page.getByTestId('render-mode')).toHaveText('Interactive Server');
    if (url !== '/examples')
      await expect(page.getByTestId('example-status')).toHaveAttribute('data-state', 'ready');

    const layout = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const controls = [...document.querySelectorAll('header a, header button, main button, main input, main select, main a, .example-chart')]
        .filter(element => (element as HTMLElement).offsetParent !== null)
        .map(element => {
          const box = element.getBoundingClientRect();
          return {
            name: element.textContent?.trim().slice(0, 30) || element.className,
            left: box.left,
            right: box.right,
            clipped: element.scrollWidth > element.clientWidth + 1 && !element.classList.contains('example-chart'),
          };
        });
      return {
        width,
        overflow: document.documentElement.scrollWidth - width,
        outside: controls.filter(c => c.left < 0 || c.right > width + 0.5),
        clipped: controls.filter(c => c.clipped),
      };
    });
    expect(layout.overflow, url).toBeLessThanOrEqual(0);
    expect(layout.outside, url).toEqual([]);
    expect(layout.clipped, url).toEqual([]);
  }
});
