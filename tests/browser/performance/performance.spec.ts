import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic workloads; tools/Performance/run.mjs aggregates the per-configuration files into the baseline report.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = process.env.BLAZOR_ECHARTS_PERFORMANCE_OUTPUT ?? join(root, 'artifacts', 'performance', 'samples');
const samples = Number(process.env.BLAZOR_ECHARTS_PERFORMANCE_SAMPLES ?? '5');
const only = process.env.BLAZOR_ECHARTS_PERFORMANCE_FILTER;
const warmup = 1;

type Workload = { name: string; kind: 'line' | 'wordcloud' | 'stream' | 'hover'; size: number; charts: number; renderers: string[] };
type Counts = Record<string, number>;
type Statistics = { deliveries: number; toBrowser: Counts; toDotNet: Counts };

const config = JSON.parse(readFileSync(join(root, 'tools', 'Performance', 'workloads.json'), 'utf8')) as {
  seed: number;
  hoverMoves: number;
  workloads: Workload[];
};

// The phases of one iteration; the hover sweep runs between mount and report.
const iterations: Record<Workload['kind'], string[]> = {
  line: ['serialize', 'mount', 'update', 'export', 'unmount'],
  wordcloud: ['serialize', 'mount', 'update', 'export', 'unmount'],
  stream: ['mount', 'stream', 'unmount'],
  hover: ['mount', 'sweep', 'report', 'unmount'],
};

const statistics = (page: Page) => page.evaluate(async () =>
  (await import(new URL('_content/BlazorECharts/js/runtime-loader.js', document.baseURI).href)).resourceStatistics()) as Promise<Statistics>;

// The single-threaded .NET runtime runs thread-pool work from setTimeout(0), which Chrome clamps to 4 ms when nested:
// a chain of awaited calls with a thread-pool hop each waits that long per hop.
function countRuntimeTimers() {
  const original = window.setTimeout;
  const counter = window as unknown as { runtimeTimers: number };
  counter.runtimeTimers = 0;
  window.setTimeout = function (this: unknown, handler: TimerHandler, delay?: number, ...rest: unknown[]) {
    if (!(Number(delay) > 0) && new Error().stack?.includes('dotnet.native'))
      counter.runtimeTimers++;

    return original.call(this, handler, delay, ...rest);
  } as typeof window.setTimeout;
}

const runtimeTimers = (page: Page) => page.evaluate(() => (window as unknown as { runtimeTimers?: number }).runtimeTimers ?? null);

function delta(before: Counts, after: Counts): Counts {
  const result: Counts = {};
  for (const [name, value] of Object.entries(after))
    if (value !== (before[name] ?? 0))
      result[name] = value - (before[name] ?? 0);

  return result;
}

// Browser main-thread CPU, WebSocket traffic and bridge calls of one measured window.
// Frame sizes are message payloads after permessage-deflate decompression, not bytes on the wire.
class Probe {
  sent = 0;
  received = 0;
  socketExtensions: string | null = null;

  constructor(readonly page: Page, readonly cdp: CDPSession, readonly native: boolean) {
    const bytes = (frame: { opcode: number; payloadData: string }) =>
      frame.opcode === 2 ? Buffer.from(frame.payloadData, 'base64').length : Buffer.byteLength(frame.payloadData);

    cdp.on('Network.webSocketFrameSent', event => this.sent += bytes(event.response));
    cdp.on('Network.webSocketFrameReceived', event => this.received += bytes(event.response));
    cdp.on('Network.webSocketHandshakeResponseReceived', event => {
      const headers = Object.entries(event.response.headers);
      this.socketExtensions = headers.find(([name]) => name.toLowerCase() === 'sec-websocket-extensions')?.[1] ?? '';
    });
  }

  static async open(page: Page, native: boolean) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
    await cdp.send('Network.enable');
    await cdp.send('HeapProfiler.enable');
    return new Probe(page, cdp, native);
  }

  // JavaScript heap after two full collections.
  async heap() {
    await this.cdp.send('HeapProfiler.collectGarbage');
    await this.cdp.send('HeapProfiler.collectGarbage');
    return (await this.cdp.send('Runtime.getHeapUsage')).usedSize;
  }

  async window<T>(action: () => Promise<T>) {
    const statisticsBefore = this.native ? null : await statistics(this.page);
    const timersBefore = await runtimeTimers(this.page);
    const cpuBefore = await this.cpu();
    const sent = this.sent;
    const received = this.received;
    const result = await action();
    const cpuAfter = await this.cpu();
    const timersAfter = await runtimeTimers(this.page);
    const statisticsAfter = this.native ? null : await statistics(this.page);
    return {
      ...result,
      browserTaskMs: cpuAfter.task - cpuBefore.task,
      browserScriptMs: cpuAfter.script - cpuBefore.script,
      runtimeTimers: timersAfter == null || timersBefore == null ? null : timersAfter - timersBefore,
      socketSentBytes: this.sent - sent,
      socketReceivedBytes: this.received - received,
      toBrowser: statisticsBefore && statisticsAfter ? delta(statisticsBefore.toBrowser, statisticsAfter.toBrowser) : {},
      toDotNet: statisticsBefore && statisticsAfter ? delta(statisticsBefore.toDotNet, statisticsAfter.toDotNet) : {},
    };
  }

  async cpu() {
    const { metrics } = await this.cdp.send('Performance.getMetrics');
    const value = (name: string) => (metrics.find(metric => metric.name === name)?.value ?? 0) * 1000;
    return { task: value('TaskDuration'), script: value('ScriptDuration') };
  }
}

async function phase(probe: Probe, name: string, timeout = 120_000) {
  return probe.window(async () => {
    await probe.page.getByRole('button', { name: name[0].toUpperCase() + name.slice(1), exact: true }).click();
    await expect(probe.page.getByTestId('phase')).toHaveText(new RegExp(`^${name}: (done|failed)`), { timeout });
    const status = await probe.page.getByTestId('phase').innerText();
    if (!status.endsWith('done'))
      throw new Error(status);

    return JSON.parse(await probe.page.getByTestId('metrics').innerText());
  });
}

// Moves across the lower half of the first chart, which is always over a bar, then waits until .NET handled every delivery.
async function sweep(probe: Probe) {
  const box = (await probe.page.locator('.perf-chart').first().boundingBox())!;
  const y = box.y + box.height * 0.75;
  await probe.page.mouse.move(box.x + box.width * 0.1, y);
  const result = await probe.window(async () => {
    const started = performance.now();
    await probe.page.mouse.move(box.x + box.width * 0.9, y, { steps: config.hoverMoves });
    if (!probe.native)
      await expect.poll(async () => (await statistics(probe.page)).deliveries, { timeout: 30_000, intervals: [20] }).toBe(0);

    return { moves: config.hoverMoves, sweepMs: performance.now() - started };
  });
  await probe.page.mouse.move(0, 0);
  return result;
}

// WordCloud drops words that do not fit; count the ones its layout actually drew.
const placedWords = (page: Page, native: boolean) => page.evaluate(async native => {
  const module = native ? 'harness/performance-native.js' : '_content/BlazorECharts/js/runtime-loader.js';
  const loaded = await import(new URL(module, document.baseURI).href);
  const echarts = native ? loaded.echarts : loaded.getECharts();
  let placed = 0;
  for (const element of document.querySelectorAll('.perf-chart')) {
    const series = echarts.getInstanceByDom(element)?.getModel().getSeriesByType('wordCloud')[0];
    const data = series?.getData();
    for (let i = 0; i < (data?.count() ?? 0); i++)
      if (data.getItemGraphicEl(i))
        placed++;
  }

  return placed;
}, native);

// The hosts of one workload run back to back: the shared browser slows down over a long run, and blocks per host would
// charge that drift to the later hosts (WordCloud 2,000 once measured +50 % for the wrapper this way, +3 % in isolation).
for (const workload of config.workloads)
  for (const renderer of workload.renderers)
    for (const host of ['native', 'server', 'wasm']) {
      const id = `${host}-${workload.name}-${renderer}`;

      test(id, async ({ page, browser }) => {
        // Arrange
        test.skip(!!only && !only.split(',').some(filter => id.includes(filter)), `Filtered by ${only}`);

        test.setTimeout(30 * 60_000);

        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 1280, height: 1000 });
        const defined = await (await page.request.get(`/harness/performance/workload?name=${workload.name}`)).json();
        expect({ kind: defined.kind, size: defined.size, charts: defined.charts })
          .toEqual({ kind: workload.kind, size: workload.size, charts: workload.charts });

        const native = host === 'native';
        const probe = await Probe.open(page, native);
        if (host === 'wasm')
          await page.addInitScript(countRuntimeTimers);

        await page.goto(`/harness/performance/${host}?workload=${workload.name}&renderer=${renderer}&seed=${config.seed}`);
        await expect(page.getByTestId('phase')).toHaveText('ready', { timeout: 120_000 });

        // Act
        const runs = [];
        for (let index = 0; index < warmup + samples; index++) {
          const run: Record<string, unknown> = { warmup: index < warmup };
          const heap: Record<string, number> = {};
          for (const name of iterations[workload.kind]) {
            if (name === 'mount')
              heap.beforeMount = await probe.heap();

            run[name] = name === 'sweep' ? await sweep(probe) : await phase(probe, name);
            if (name === 'mount' || name === 'update')
              (run[name] as Record<string, unknown>).placed = workload.kind === 'wordcloud' ? await placedWords(page, native) : null;

            if (name === 'mount')
              heap.mounted = await probe.heap();

            if (name === 'stream')
              heap.streamed = await probe.heap();

            if (name === 'unmount')
              heap.released = await probe.heap();
          }

          runs.push({ ...run, heap });
        }

        // Assert
        expect(errors).toEqual([]);
        const environment = await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          hardwareConcurrency: navigator.hardwareConcurrency,
          devicePixelRatio,
          viewport: { width: innerWidth, height: innerHeight },
        }));
        await mkdir(output, { recursive: true });
        await writeFile(join(output, `${id}.json`), JSON.stringify(
          {
            id,
            host,
            workload: workload.name,
            kind: workload.kind,
            size: workload.size,
            charts: workload.charts,
            renderer,
            seed: config.seed,
            warmup,
            samples,
            renderMode: await page.getByTestId('renderer-info').innerText(),
            socketExtensions: probe.socketExtensions,
            browser: browser.version(),
            environment,
            runs,
          },
          null,
          2
        ) + '\n');
      });
    }
