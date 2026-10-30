import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aotPorts } from './ports.ts';

// Started by tools/Release/test-aot.ps1 against the trimmed and AOT outputs of the standalone consumer.
const root = fileURLToPath(new URL('../..', import.meta.url));
const results = process.env.BLAZOR_ECHARTS_AOT_RESULTS;
if (!results) throw new Error('BLAZOR_ECHARTS_AOT_RESULTS must point at the test-aot.ps1 results; run tools/Release/test-aot.ps1.');
const output = process.env.BLAZOR_ECHARTS_AOT_OUTPUT ?? join(results, 'playwright');
const { trimmed, aot } = aotPorts();
const variants = [['trimmed', trimmed], ['aot', aot]] as const;

export default defineConfig({
  testDir: '.',
  testMatch: 'aot.spec.ts',
  outputDir: join(output, 'test-results'),
  // A committed test.only fails the run instead of silently shrinking a gate stage.
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['json', { outputFile: join(output, 'results.json') }]],
  use: { ...devices['Desktop Chrome'], channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: variants.map(([name, port]) => ({ name, use: { baseURL: `http://127.0.0.1:${port}/` } })),
  // A static file host only: the published wwwroot is served as files, with no ASP.NET Core in front.
  webServer: variants.map(([name, port]) => ({
    command: `node "${join(root, 'tests', 'PackageConsumer', 'static-host.mjs')}" "${join(results, name, 'publish', 'wwwroot')}" ${port}`,
    url: `http://127.0.0.1:${port}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  })),
});
