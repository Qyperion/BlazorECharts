import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { demoURL, matrixBrowsers, standaloneURL } from './hosts.ts';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));

// The release gate keeps the results of every stage and the matrix report in its own output.
const artifactDir = process.env.BLAZOR_ECHARTS_PLAYWRIGHT_OUTPUT
  ? resolve(process.env.BLAZOR_ECHARTS_PLAYWRIGHT_OUTPUT)
  : join(rootDir, 'artifacts', 'playwright');

const matrixReport = process.env.BLAZOR_ECHARTS_MATRIX_REPORT
  ? resolve(process.env.BLAZOR_ECHARTS_MATRIX_REPORT)
  : join(rootDir, 'docs', 'compatibility', 'browser-matrix.json');

const configuration = process.env.BLAZOR_ECHARTS_TEST_CONFIGURATION ?? 'Release';

if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(configuration))
  throw new Error('BLAZOR_ECHARTS_TEST_CONFIGURATION must be a build configuration name.');

const port = Number(process.env.BLAZOR_ECHARTS_TEST_PORT ?? '5187');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('BLAZOR_ECHARTS_TEST_PORT must be a valid TCP port.');
}

const workers = Number(process.env.BLAZOR_ECHARTS_PLAYWRIGHT_WORKERS ?? '2');

if (!Number.isInteger(workers) || workers < 1)
  throw new Error('BLAZOR_ECHARTS_PLAYWRIGHT_WORKERS must be a positive integer.');

const hostUrl = new URL(process.env.BLAZOR_ECHARTS_TEST_BASE_URL ?? `http://127.0.0.1:${port}`);

if (hostUrl.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(hostUrl.hostname)
  || hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash || hostUrl.username || hostUrl.password) {
  throw new Error('BLAZOR_ECHARTS_TEST_BASE_URL must be a localhost HTTP origin.');
}

const baseURL = hostUrl.origin;

// Performance workloads are long-running; tools/Performance/run.mjs enables them.
const performance = process.env.BLAZOR_ECHARTS_PERFORMANCE === '1';

if (new Set([baseURL, demoURL, standaloneURL].map(url => new URL(url).port)).size !== 3) {
  throw new Error('The test host, demo and standalone demo need different ports.');
}

const browser = { ...devices['Desktop Chrome'], channel: 'chrome' };
const desktop = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] };

const demoServer = (project: string, url: string) => ({
  command: `dotnet run --project ${project} -c ${configuration} --no-build --no-restore --no-launch-profile -- --urls ${url}`,
  cwd: rootDir,
  url,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { ASPNETCORE_ENVIRONMENT: 'Development' },
});

export default defineConfig({
  testDir: '.',
  // The release gate assigns every *.spec.ts to a stage; another suffix would run outside it.
  testMatch: '**/*.spec.ts',
  outputDir: join(artifactDir, 'test-results'),
  // A committed test.only fails the run instead of silently shrinking a gate stage.
  forbidOnly: true,
  // Spec files share the workers; the tests of one file stay in order. Resource and performance runs pass --workers=1.
  fullyParallel: false,
  workers,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: join(artifactDir, 'report'), open: 'never' }],
    ['json', { outputFile: join(artifactDir, 'results.json') }],
    ['./matrix/matrix-reporter.ts', { output: matrixReport }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chrome', testIgnore: ['**/demo/**', '**/matrix/**', '**/performance/**'], use: browser },
    // The demo specs run against the samples/BlazorECharts.Demo host.
    { name: 'demo', testDir: join(rootDir, 'tests', 'browser', 'demo'), use: { ...browser, baseURL: demoURL } },
    ...(performance ? [{ name: 'performance', testDir: join(rootDir, 'tests', 'browser', 'performance'), use: browser }] : []),
    // One project per installed matrix browser; missing ones are NOT_VERIFIED in the matrix report.
    ...matrixBrowsers.filter(target => !target.missing).map(target => ({
      name: `matrix-${target.id}`,
      testDir: join(rootDir, 'tests', 'browser', 'matrix'),
      metadata: { matrixBrowser: target.id },
      use: { ...desktop[target.engine], ...(target.channel ? { channel: target.channel } : {}), baseURL: demoURL },
    })),
  ],
  webServer: [
    {
      command: `dotnet run --project tests/BrowserHost/BrowserHost.csproj -c ${configuration} --no-build --no-restore --no-launch-profile --urls ${baseURL}`,
      cwd: rootDir,
      url: `${baseURL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ASPNETCORE_ENVIRONMENT: 'Development' },
    },
    { ...demoServer('samples/BlazorECharts.Demo/BlazorECharts.Demo.csproj', demoURL), url: `${demoURL}/health` },
    demoServer('samples/BlazorECharts.Standalone/BlazorECharts.Standalone.csproj', standaloneURL),
  ],
});
