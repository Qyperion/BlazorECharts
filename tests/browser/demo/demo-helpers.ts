import { expect, type Locator, type Page } from '@playwright/test';

/** The pinned ECharts module; tests import it in the page to inspect native chart models. */
export const echartsModule = '/_content/BlazorECharts/js/echarts-6.1.0.js';

export type Hosting = 'server' | 'wasm';
export const hostings: Hosting[] = ['server', 'wasm'];
export const renderModes: Record<Hosting, string> = { server: 'Server', wasm: 'WebAssembly' };

// App.razor preloads both modules. On WebAssembly the first chart imports them only after the .NET runtime starts, and
// on a slow machine that is later than the few seconds after the load event after which WebKit reports an unused preload.
const unusedModulePreload =
  /^The resource \S+\/_content\/BlazorECharts\/js\/(runtime-loader|echarts-6\.1\.0)(\.\w+)?\.js was preloaded using link preload but not used within a few seconds/;

/** Collects page errors, console errors and console warnings. Each test asserts the list is empty. */
export function watchIssues(page: Page): string[] {
  const issues: string[] = [];
  page.on('pageerror', error => issues.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type()) && !(message.type() === 'warning' && unusedModulePreload.test(message.text())))
      issues.push(`${message.type()}: ${message.text()}`);
  });
  return issues;
}

export function exampleUrl(slug: string, hosting: Hosting, renderer: 'canvas' | 'svg' = 'canvas'): string {
  const query = new URLSearchParams();
  if (hosting === 'wasm')
    query.set('hosting', 'wasm');

  if (renderer === 'svg')
    query.set('renderer', 'svg');

  const search = query.toString();
  return `/examples/${slug}${search ? `?${search}` : ''}`;
}

/** Opens an example in the selected render mode and waits until every chart reports a stable layout. */
export async function openExample(page: Page, slug: string, hosting: Hosting, renderer: 'canvas' | 'svg' = 'canvas'): Promise<Locator> {
  await page.goto(exampleUrl(slug, hosting, renderer));
  return waitReady(page, slug, hosting);
}

export async function waitReady(page: Page, slug: string, hosting: Hosting): Promise<Locator> {
  const view = page.locator(`.example-view[data-example="${slug}"]`);
  await expect(view).toHaveAttribute('data-render-mode', renderModes[hosting]);
  await expect(page.getByTestId('example-status')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
  return view;
}
