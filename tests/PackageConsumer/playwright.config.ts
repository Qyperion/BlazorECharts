import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumerPorts } from './ports.ts';

// Started by tools/Release/test-packages.ps1 against published consumers restored from the local feed.
const root = fileURLToPath(new URL('../..', import.meta.url));
const publish = process.env.BLAZOR_ECHARTS_CONSUMERS_PUBLISH;
if (!publish) throw new Error('BLAZOR_ECHARTS_CONSUMERS_PUBLISH must point at the published consumers; run tools/Release/test-packages.ps1.');
const output = process.env.BLAZOR_ECHARTS_CONSUMERS_OUTPUT ?? join(root, 'artifacts', 'package-consumers', 'playwright');
export const cdnRuntime = 'https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.esm.min.mjs';
const ports = consumerPorts();

const app = (folder: string, assembly: string, port: number, environment: Record<string, string> = {}) => ({
  command: `dotnet "${join(publish, folder, `${assembly}.dll`)}" --urls http://127.0.0.1:${port}`,
  cwd: join(publish, folder),
  url: `http://127.0.0.1:${port}${environment.PathBase ?? ''}/health`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { ASPNETCORE_ENVIRONMENT: 'Production', ...environment },
});

export default defineConfig({
  testDir: '.',
  testMatch: 'packages.spec.ts',
  outputDir: join(output, 'test-results'),
  // A committed test.only fails the run instead of silently shrinking a gate stage.
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['json', { outputFile: join(output, 'results.json') }]],
  use: { ...devices['Desktop Chrome'], channel: 'chrome', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    app('server', 'PackageConsumer.Server', ports.server),
    app('server', 'PackageConsumer.Server', ports.serverSubpath, { PathBase: '/charts-test' }),
    app('server', 'PackageConsumer.Server', ports.cdn, { ECharts__Provider: 'module', ECharts__ModuleUrl: cdnRuntime }),
    app('server', 'PackageConsumer.Server', ports.custom, { ECharts__Provider: 'custom', ECharts__ModuleUrl: 'custom-provider.js' }),
    app('wasm', 'PackageConsumer.Wasm', ports.wasm),
    app('wasm', 'PackageConsumer.Wasm', ports.wasmSubpath, { PathBase: '/charts-test' }),
    app('core-only', 'PackageConsumer.CoreOnly', ports.coreOnly),
    app('library', 'PackageConsumer.Library', ports.library),
  ],
});
