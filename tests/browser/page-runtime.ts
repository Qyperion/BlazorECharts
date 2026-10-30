import { build } from 'esbuild';
import type { Page } from '@playwright/test';

let bundle: Promise<string> | undefined;

/** The page coordinator class as a test-only module: the production runtime-loader.js does not export it. */
export const pageRuntimeBundle = () => bundle ??= build({
  entryPoints: ['src/BlazorECharts/JavaScript/page-runtime.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
}).then(result => result.outputFiles[0].text);

/** Serves the test bundle at __test/page-runtime.js under the page's base URI. */
export async function routePageRuntime(page: Page): Promise<void> {
  const body = await pageRuntimeBundle();
  await page.route('**/__test/page-runtime.js', route => route.fulfill({ contentType: 'text/javascript', body }));
}
