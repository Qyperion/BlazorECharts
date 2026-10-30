import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { matrixBrowsers } from '../hosts.ts';

type Status = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_VERIFIED';

const matrixScenarios = ['CanvasAndSvgRender', 'WordCloudCallbacks', 'BrushSelectsRange', 'PngAndSvgExport', 'ViewportAndDevicePixelRatio'];

// The same rendering and export on the WebAssembly demo.
const wasmScenarios = ['CanvasAndSvgRenderWasm', 'PngAndSvgExportWasm'];
const allScenarios = [...matrixScenarios, ...wasmScenarios];

/** Writes docs/compatibility/browser-matrix.json whenever browser-matrix.spec.ts ran. */
export default class MatrixReporter implements Reporter {
  private readonly output: string;
  private readonly results = new Map<string, Map<string, { status: Status; error?: string }>>();
  private readonly versions = new Map<string, string>();
  private ran = false;

  constructor(options: { output: string }) {
    this.output = options.output;
  }

  onBegin(_config: FullConfig, suite: Suite) {
    this.ran = suite.allTests().some(test => test.parent.project()?.name.startsWith('matrix-'));
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name ?? '';
    if (!project.startsWith('matrix-'))
      return;

    const browser = project.slice('matrix-'.length);
    const annotations = [...test.annotations, ...result.annotations];

    // The spec skips the scenarios of an installed browser that cannot start and names the launch error.
    const blocked = annotations.find(annotation => annotation.type === 'blocked')?.description;
    const message = blocked ?? result.errors.map(error => error.message ?? '').join('\n');
    const status: Status = result.status === 'passed' ? 'PASS'
      : blocked !== undefined || /Executable doesn't exist|browserType\.launch|Failed to launch/.test(message) ? 'BLOCKED'
        : result.status === 'skipped' ? 'NOT_VERIFIED' : 'FAIL';
    const scenarios = this.results.get(browser) ?? new Map();
    scenarios.set(test.title, status === 'PASS' ? { status } : { status, error: message.split('\n')[0]?.slice(0, 300) });
    this.results.set(browser, scenarios);
    const version = annotations.find(annotation => annotation.type === 'browserVersion')?.description;
    if (version)
      this.versions.set(browser, version);
  }

  onEnd() {
    if (!this.ran)
      return;

    const browsers = matrixBrowsers.map(target => {
      if (target.missing)
        return { id: target.id, engine: target.engine, status: 'NOT_VERIFIED' as Status, reason: target.missing };

      const ran = this.results.get(target.id) ?? new Map();
      const scenarios = Object.fromEntries(allScenarios.map(name => [name, ran.get(name) ?? { status: 'NOT_VERIFIED' as Status }]));
      const statuses = Object.values(scenarios).map(scenario => scenario.status);
      const status: Status = statuses.includes('FAIL') ? 'FAIL' : statuses.includes('BLOCKED') ? 'BLOCKED'
        : statuses.every(value => value === 'PASS') ? 'PASS' : 'NOT_VERIFIED';
      const reason = status === 'BLOCKED' ? Object.values(scenarios).find(scenario => scenario.status === 'BLOCKED')?.error : undefined;
      return {
        id: target.id,
        engine: target.engine,
        channel: target.channel ?? null,
        version: this.versions.get(target.id) ?? null,
        status,
        ...(reason ? { reason } : {}),
        scenarios,
      };
    });
    const report = {
      formatVersion: 1,
      generatedBy: 'npm run test:browser -- browser-matrix.spec.ts',
      verifiedOn: new Date().toISOString().slice(0, 10),
      platform: `${process.platform} ${process.arch}`,
      upstream: { echarts: '6.1.0', wordcloud: '3.0.0' },
      host: 'samples/BlazorECharts.Demo, Interactive Server; WebAssembly for the *Wasm scenarios',
      statuses: ['PASS', 'FAIL', 'BLOCKED', 'NOT_VERIFIED'],
      scenarios: allScenarios,
      browsers,
    };
    mkdirSync(dirname(this.output), { recursive: true });
    writeFileSync(this.output, JSON.stringify(report, null, 2) + '\n');
  }
}
