// Runs the deterministic performance workloads against native ECharts and the wrapper, then writes
// docs/compatibility/performance-baseline.md. Requires a Release build: the Playwright web servers start with --no-build.
// Exit code 1 means a workload or a resource check failed; the report is written in both cases.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat as fileStat, writeFile } from 'node:fs/promises';
import { arch, cpus, release, totalmem, type } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const samples = Number(option('--samples', '5'));
if (!Number.isInteger(samples) || samples < 3)
  throw new Error('--samples must be an integer of at least 3.');

// Comma-separated substrings of configuration ids, for example `wasm-line,hover`.
const filter = option('--filter', '');

// The report names a version, not a commit: the public repository has none of the working commits.
const version = option('--version', 'unreleased');

// A filtered run never replaces the committed baseline unless a report path is given explicitly.
const report = join(root, option('--report', filter ? 'artifacts/performance/performance-filtered.md' : 'docs/compatibility/performance-baseline.md'));
const output = join(root, 'artifacts', 'performance', 'samples');
const config = JSON.parse(await readFile(join(root, 'tools', 'Performance', 'workloads.json'), 'utf8'));
const budgets = JSON.parse(await readFile(join(root, 'tools', 'Performance', 'budgets.json'), 'utf8'));
const hosts = ['native', 'server', 'wasm'];
const hostNames = { native: 'Native', server: 'Server', wasm: 'WebAssembly' };
const renderers = ['canvas', 'svg'];
const workloads = config.workloads;

// --report-only rebuilds the report from the samples of the previous run, for example after a budget change.
const reportOnly = args.includes('--report-only');
if (!reportOnly) {
  await rm(output, { recursive: true, force: true });
  const run = spawnSync(process.execPath, [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test',
    '--config', 'tests/browser/playwright.config.ts', '--project', 'performance', '--workers=1', '--reporter=list'], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, BLAZOR_ECHARTS_PERFORMANCE: '1', BLAZOR_ECHARTS_PERFORMANCE_SAMPLES: String(samples),
      BLAZOR_ECHARTS_PERFORMANCE_OUTPUT: output, ...(filter ? { BLAZOR_ECHARTS_PERFORMANCE_FILTER: filter } : {}) },
  });
  if (run.status !== 0) {
    console.error(`Performance workloads failed (exit ${run.status ?? run.signal}).`);
    process.exit(run.status || 1);
  }
}

const files = (await readdir(output)).filter(file => file.endsWith('.json'));
const results = await Promise.all(files.map(async file => JSON.parse(await readFile(join(output, file), 'utf8'))));
const started = new Date(Math.min(...(await Promise.all(files.map(async file => (await fileStat(join(output, file))).mtimeMs)))));
const expected = hosts.length * workloads.reduce((sum, workload) => sum + workload.renderers.length, 0);
if (!filter && results.length !== expected)
  throw new Error(`Expected ${expected} configurations, found ${results.length}.`);

if (!results.length)
  throw new Error('No performance configuration ran.');

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const ms = value => value == null ? '—' : Math.abs(value) < 10 ? value.toFixed(2) : Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value).toLocaleString('en-US');
const cell = values => values?.length ? `${ms(median(values))} (${ms(Math.min(...values))}–${ms(Math.max(...values))})` : '—';
const count = value => value.toLocaleString('en-US');
const total = counts => Object.values(counts ?? {}).reduce((sum, value) => sum + value, 0);
const size = value => {
  if (value == null)
    return '—';

  const magnitude = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  return magnitude >= 2 ** 20 ? `${sign}${(magnitude / 2 ** 20).toFixed(1)} MiB`
    : magnitude >= 2 ** 10 ? `${sign}${Math.round(magnitude / 2 ** 10)} KiB` : `${sign}${Math.round(magnitude)} B`;
};
const signed = (value, format) => value == null ? '—' : value >= 0 ? `+${format(value)}` : format(value);

// Checks are grouped by kind: one report row per kind names its closest configuration.
const checks = new Map();
function check(kind, title, reason, id, pass, measured, limit, ratio = null) {
  if (!checks.has(kind))
    checks.set(kind, { title, reason, entries: [] });

  checks.get(kind).entries.push({ id, pass, measured, limit, ratio });
}

function constant(values, label, id) {
  const unique = [...new Set(values.map(value => JSON.stringify(value)))];
  check('deterministic', 'Bridge calls are the same in every sample', 'A change between samples is a behavioural change, not noise.',
    `${id} ${label}`, unique.length === 1, unique.join(' | '), 'one value');
  return JSON.parse(unique[0]);
}

function summarize(result) {
  const measured = result.runs.filter(entry => !entry.warmup);
  const phases = {};
  for (const name of Object.keys(measured[0]).filter(key => key !== 'warmup' && key !== 'heap')) {
    const entries = measured.map(entry => entry[name]);
    const phase = {};
    for (const key of Object.keys(entries[0]))
      if (typeof entries[0][key] === 'number')
        phase[key] = entries.map(entry => entry[key]);

    phase.socket = entries.map(entry => entry.socketSentBytes + entry.socketReceivedBytes);
    phase.calls = constant(entries.map(entry => [total(entry.toBrowser), total(entry.toDotNet)]), `${name} call counts`, result.id);
    phase.names = constant(entries.map(entry => [entry.toBrowser, entry.toDotNet]), `${name} call names`, result.id);
    phases[name] = phase;
  }

  // The .NET heap before a mount: after the serialize phase, or after the previous unmount.
  const before = result.runs.map((entry, index) => entry.serialize?.managedHeapBytes ?? result.runs[index - 1]?.unmount?.managedHeapBytes);
  const cycle = phase => result.runs.flatMap((entry, index) => entry.warmup || before[index] == null ? [] : [entry[phase].managedHeapBytes - before[index]]);
  const managed = result.host === 'native' ? null : {
    retained: cycle('mount'),
    residue: cycle('unmount'),
    streamed: measured.filter(entry => entry.stream).map(entry => entry.stream.managedHeapBytes - entry.mount.managedHeapBytes),
  };
  const placed = result.kind === 'wordcloud' ? [...new Set(measured.flatMap(entry => [entry.mount.placed, entry.update.placed]))] : null;
  return {
    ...result,
    samples: measured.length,
    bytes: phases.serialize ? constant(phases.serialize.bytes, 'payload bytes', result.id) : null,
    phases,
    heap: {
      retained: measured.map(entry => entry.heap.mounted - entry.heap.beforeMount),
      residue: measured.map(entry => entry.heap.released - entry.heap.beforeMount),
      released: measured.map(entry => entry.heap.released),
      streamed: measured.filter(entry => entry.heap.streamed != null).map(entry => entry.heap.streamed - entry.heap.mounted),
    },
    managed,
    placed,
    events: phases.report ? median(phases.report.events) : null,
  };
}

const summaries = results.map(summarize).sort((a, b) =>
  workloads.findIndex(w => w.name === a.workload) - workloads.findIndex(w => w.name === b.workload)
  || hosts.indexOf(a.host) - hosts.indexOf(b.host) || renderers.indexOf(a.renderer) - renderers.indexOf(b.renderer));
for (const summary of summaries)
  if (summary.renderMode !== hostNames[summary.host])
    throw new Error(`${summary.id} ran as ${summary.renderMode}, expected ${hostNames[summary.host]}.`);

const find = (host, workload, renderer) => summaries.find(s => s.host === host && s.workload === workload && s.renderer === renderer);
const stat = (summary, phase, field) => summary?.phases[phase]?.[field];
const at = (summary, phase, field) => {
  const values = stat(summary, phase, field);
  return values?.length ? median(values) : null;
};

// Least squares y = a + b·x.
function fit(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  const b = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return { a: my - b * mx, b };
}

// Checks against native ECharts and the budgets.
for (const summary of summaries.filter(s => s.host !== 'native')) {
  const native = find('native', summary.workload, summary.renderer);
  const other = find(summary.host === 'server' ? 'wasm' : 'server', summary.workload, summary.renderer);
  const payload = (summary.bytes ?? 0) * summary.charts;
  if (other && summary.host === 'server') {
    const names = s => Object.fromEntries(Object.entries(s.phases).map(([name, phase]) => [name, phase.names]));
    check('hosts', 'Server and WebAssembly make the same bridge calls', 'One command transport serves both render modes.',
      summary.id.replace('server-', ''), JSON.stringify(names(summary)) === JSON.stringify(names(other)), 'compared', 'equal');
  }

  if (!native)
    continue;

  if (summary.bytes != null)
    check('input', 'Every host gets the same prepared JSON', 'The native page loads the transport bytes of OptionSerializer.',
      summary.id, summary.bytes === native.bytes, size(summary.bytes), size(native.bytes));

  const retained = median(summary.heap.retained) - median(native.heap.retained);
  const retainedLimit = budgets.retainedJsHeap.payloadFactor * payload + budgets.retainedJsHeap.constantBytes;
  check('retained', 'JavaScript heap while mounted, over native', budgets.retainedJsHeap.reason,
    summary.id, retained <= retainedLimit, size(retained), size(retainedLimit), retained / retainedLimit);

  const residue = median(summary.heap.residue) - median(native.heap.residue);
  check('residue', 'JavaScript heap after unmount, over native', budgets.jsHeapResidue.reason,
    summary.id, residue <= budgets.jsHeapResidue.constantBytes, size(residue), size(budgets.jsHeapResidue.constantBytes),
    residue / budgets.jsHeapResidue.constantBytes);

  // The server heap belongs to the whole process, so only WebAssembly attributes it to the page.
  if (summary.host === 'wasm') {
    const managedResidue = median(summary.managed.residue);
    const managedLimit = budgets.managedHeapResidue.constantBytes + budgets.managedHeapResidue.payloadFactor * payload;
    check('managed-residue', 'WebAssembly .NET heap after unmount, per cycle', budgets.managedHeapResidue.reason,
      summary.id, managedResidue <= managedLimit, size(managedResidue), size(managedLimit), managedResidue / managedLimit);
  }

  if (summary.kind === 'stream') {
    const updates = median(summary.phases.stream.updates);
    check('stream-calls', 'One bridge call per stream update', 'An update is one setOption; the final stability wait adds one.',
      summary.id, summary.phases.stream.calls[0] === updates + 1, `${summary.phases.stream.calls[0]} →`, `${updates + 1} →`);

    const streamGrowth = median(summary.heap.streamed) - median(native.heap.streamed);
    check('stream-js', 'JavaScript heap after 1,000 updates, over native', budgets.streamJsHeapGrowth.reason,
      summary.id, streamGrowth <= budgets.streamJsHeapGrowth.constantBytes, size(streamGrowth),
      size(budgets.streamJsHeapGrowth.constantBytes), streamGrowth / budgets.streamJsHeapGrowth.constantBytes);

    const timers = stat(summary, 'stream', 'runtimeTimers');
    if (timers) {
      const perUpdate = median(timers) / updates;
      const limit = budgets.wasmRuntimeTimersPerUpdate.limit;
      check('stream-timers', 'WebAssembly runtime timers per stream update', budgets.wasmRuntimeTimersPerUpdate.reason,
        summary.id, perUpdate <= limit, perUpdate.toFixed(3), String(limit), perUpdate / limit);
    }

    const managedStream = median(summary.managed.streamed);
    if (summary.host === 'wasm')
      check('stream-managed', 'WebAssembly .NET heap after 1,000 updates', budgets.streamManagedHeapGrowth.reason,
        summary.id, managedStream <= budgets.streamManagedHeapGrowth.constantBytes, size(managedStream),
        size(budgets.streamManagedHeapGrowth.constantBytes), managedStream / budgets.streamManagedHeapGrowth.constantBytes);
  }

  if (summary.kind === 'hover')
    check('events', 'Every native mousemove reaches the .NET handler', 'The subscription has no throttle: nothing may be dropped or duplicated.',
      summary.id, summary.events === native.events, count(summary.events), count(native.events));

  // Bridge calls scale with the number of charts and nothing else.
  const single = find(summary.host, 'line-1k', 'canvas');
  if (single && (summary.kind === 'line' || summary.kind === 'wordcloud'))
    for (const phase of ['mount', 'update', 'unmount']) {
      const expectedCalls = single.phases[phase].calls.map(value => value * summary.charts);
      check('per-chart', 'Bridge calls grow only with the number of charts', 'A mount, update or unmount of N charts costs N times one chart.',
        `${summary.id} ${phase}`, JSON.stringify(summary.phases[phase].calls) === JSON.stringify(expectedCalls),
        summary.phases[phase].calls.join(' → / ') + ' ←', expectedCalls.join(' → / ') + ' ←');
    }
}

// Per-point browser CPU over the line ladder.
const ladder = config.scaling.map(name => workloads.find(w => w.name === name));
const slopes = {};
for (const host of hosts) {
  const rows = ladder.map(w => find(host, w.name, 'canvas'));
  if (rows.some(row => !row))
    continue;

  const xs = ladder.map(w => w.size / 100_000);
  slopes[host] = {
    stable: fit(xs, rows.map(row => at(row, 'mount', 'stableMs'))),
    cpu: fit(xs, rows.map(row => at(row, 'mount', 'browserTaskMs'))),
  };
}

if (slopes.native)
  for (const host of ['server', 'wasm'].filter(h => slopes[h])) {
    const ratio = slopes[host].cpu.b / slopes.native.cpu.b;
    check('cpu-slope', 'Browser CPU per data point, relative to native', budgets.browserCpuSlope.reason,
      `${host} line ladder`, ratio <= budgets.browserCpuSlope[host], `×${ratio.toFixed(2)}`, `×${budgets.browserCpuSlope[host]}`,
      ratio / budgets.browserCpuSlope[host]);
  }

const command = (file, parameters) => {
  try {
    return execFileSync(file, parameters, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const dirty = command('git', ['status', '--porcelain', '--untracked-files=no']) !== '';
const first = summaries[0];

// The dev host serves the WebAssembly build output: its interpreter must run as optimized as a published app.
const bootSource = await readFile(join(root, 'tests/BrowserHost.Client/bin/Release/net10.0/wwwroot/_framework/dotnet.js'), 'utf8');
const debugLevel = Number(/"debugLevel":\s*(-?\d+)/.exec(bootSource)?.[1]);
if (debugLevel !== 0)
  throw new Error(`The WebAssembly build has debugLevel ${debugLevel}; build tests/BrowserHost.Client in Release with WasmDebugLevel=0.`);

const cpu = cpus();
const socket = summaries.find(s => s.host === 'server')?.socketExtensions;
const environment = [
  ['Date', started.toISOString().slice(0, 10)],
  ['Version', `${version}${dirty ? ' with uncommitted changes' : ''}`],
  ['OS', `${type()} ${release()} ${arch()}`],
  ['CPU', `${cpu[0]?.model.trim() ?? 'unknown'}, ${cpu.length} logical cores`],
  ['Memory', `${Math.round(totalmem() / 2 ** 30)} GiB`],
  ['Node.js', process.version],
  ['.NET SDK', command('dotnet', ['--version'])],
  ['Browser', `Google Chrome ${first.browser} (Playwright channel \`chrome\`), headless`],
  ['Viewport', `${first.environment.viewport.width}×${first.environment.viewport.height}, devicePixelRatio ${first.environment.devicePixelRatio}`],
  ['ECharts', 'The shipped minified `echarts-6.1.0.js` on every host, including the native baseline'],
  ['Build', 'Release, `dotnet run --no-build` hosts; WebAssembly is interpreted with debugLevel 0, without trimming or AOT. '
    + 'Published trimmed and AOT numbers: [WebAssembly trimming and AOT](wasm-aot.md)'],
  ...(socket == null ? [] : [['Server WebSocket', socket ? `\`${socket}\`: socket sizes below are uncompressed payloads` : 'no extensions']]),
];

const lines = [
  '# Performance baseline',
  '',
  'A measured synthetic baseline for regression comparison: the same workloads on native ECharts, Interactive Server',
  'and WebAssembly. Time is reported, not enforced: no FPS, latency or throughput limits were agreed. Resource',
  'checks are enforced: bridge calls, delivered events and memory against native ECharts, with the budgets of',
  '`tools/Performance/budgets.json` (see [Checks](#checks)).',
  '',
  `Generated by \`npm run test:performance\`${filter ? ` (filter \`${filter}\`)` : ''}. Rerun it on the same machine to compare.`,
  '',
  '## Environment',
  '',
  '| | |',
  '|---|---|',
  ...environment.map(([name, value]) => `| ${name} | ${value} |`),
  '',
  '## Method',
  '',
  `- Seed \`${first.seed}\`. Every sample of a configuration gets byte-identical input; the update uses seed + 50.`,
  `- Each configuration opens a fresh page, runs ${first.warmup} discarded warm-up iteration and then ${first.samples} measured samples.`,
  '  A line or WordCloud iteration is: serialize, mount, update, export, unmount.',
  '- **Native** is `/harness/performance/native`: the same engine file, layout and transport bytes of `OptionSerializer`,',
  '  parsed before the clock starts, as a JavaScript application holds its options; no Blazor and no bridge.',
  '- **Server** and **WebAssembly** drive a page-owned `EChartsRuntime` and `EChartInstance`, the same command transport',
  '  the `EChart` component uses. Their times are measured with `Stopwatch` in .NET: on the server for Server, in the browser',
  '  for WebAssembly. Native times use `performance.now()`.',
  '- Overhead is the host median minus the native median. The harness costs (the click, polling the phase text) are the',
  '  same on every host and cancel out in it.',
  '',
  '| Metric | Definition |',
  '|---|---|',
  '| Payload | UTF-8 bytes of the prepared option JSON of one chart, the same on every host |',
  '| Serialize | `OptionSerializer.Serialize` of one chart only; the native page has nothing to serialize |',
  '| Apply | Create and `setOption` (mount) or `setOption` (update) until the call returns |',
  '| Stable | Same start, until rendering finished: `AwaitStableAsync` for the wrapper, the `finished` event natively; for WordCloud also the end of its layout |',
  '| Export | `getDataURL` of the first chart; the wrapper also waits for stability (export readiness) |',
  '| Browser CPU | Main-thread task time in thread CPU time (CDP `Performance.getMetrics` `TaskDuration`, `threadTicks`) during the phase. It includes about 5 ms of harness work per phase on every host |',
  '| Server CPU | CPU time of the server process during the phase, mean of the samples (Windows counts it in 15.6 ms steps) |',
  '| .NET alloc | `GC.GetTotalAllocatedBytes(true)` during the phase: every thread of the server process, or the WebAssembly runtime |',
  '| Socket | Server WebSocket message payloads in both directions during the phase (CDP frame events) |',
  '| Runtime timers | WebAssembly: `setTimeout(0)` calls of the .NET runtime during the phase, its thread-pool hops |',
  '| JS heap retained | JavaScript heap after two full collections with the charts mounted, minus before the mount |',
  '| JS heap residue | The same after unmount, minus before the mount |',
  '| .NET heap retained | `GC.GetTotalMemory(true)` after the mount minus before it. On the server it is the whole process: earlier pages\' circuits and `ArrayPool` buckets come and go, so only WebAssembly values are checked |',
  '| .NET heap residue | The same after unmount |',
  '| Bridge | Library interop per phase: .NET → JS calls (→) and JS → .NET callbacks (←), from `resourceStatistics()` |',
  '',
  'Cells show the median, with (min–max) where useful. Times are in milliseconds.',
  '',
];

const failed = [...checks.values()].filter(group => group.entries.some(entry => !entry.pass));
lines.push('## Checks', '');
lines.push(failed.length ? `**${failed.length} of ${checks.size} checks failed.**` : `All ${checks.size} checks passed.`, '');
lines.push('| Check | Result | Closest to its limit | Measured | Limit |', '|---|---|---|---:|---:|');
for (const group of checks.values()) {
  const failures = group.entries.filter(entry => !entry.pass);
  const shown = failures[0] ?? [...group.entries].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
  const result = failures.length ? `FAIL ×${failures.length} of ${group.entries.length}` : `pass (${group.entries.length})`;

  // An exact check that passed has no closest case.
  const exact = !failures.length && shown.ratio == null;
  lines.push(`| ${group.title} | ${result} | ${exact ? '—' : shown.id} | ${exact ? '—' : shown.measured} | ${exact ? 'exact' : shown.limit} |`);
}

lines.push('');
for (const group of checks.values())
  lines.push(`- **${group.title}.** ${group.reason}`);

lines.push('');
const failures = [...checks.values()].flatMap(group => group.entries.filter(entry => !entry.pass).map(entry => `- ${group.title}: ${entry.id}: ${entry.measured}, limit ${entry.limit}`));
if (failures.length)
  lines.push('Failures:', '', ...failures, '');

const overhead = (host, native) => host == null || native == null ? ms(host) : `${ms(host)} (${signed(host - native, ms)}, ×${(host / native).toFixed(1)})`;
const charted = workloads.filter(w => (w.kind === 'line' || w.kind === 'wordcloud') && w.renderers.includes('canvas'));
if (charted.some(w => find('native', w.name, 'canvas'))) {
  lines.push('## Overhead against native ECharts', '');
  lines.push('Stable time of the canvas renderer: host median (overhead, ratio to native).', '');
  lines.push('| Workload | Payload | Native mount | Server mount | WebAssembly mount | Native update | Server update | WebAssembly update |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const w of charted) {
    const [native, server, wasm] = hosts.map(host => find(host, w.name, 'canvas'));
    if (!native)
      continue;

    const value = (summary, phase) => at(summary, phase, 'stableMs');
    lines.push(`| ${w.name} | ${size(native.bytes * w.charts)} | ${ms(value(native, 'mount'))} | ${overhead(value(server, 'mount'), value(native, 'mount'))} | `
      + `${overhead(value(wasm, 'mount'), value(native, 'mount'))} | ${ms(value(native, 'update'))} | ${overhead(value(server, 'update'), value(native, 'update'))} | `
      + `${overhead(value(wasm, 'update'), value(native, 'update'))} |`);
  }

  lines.push('');
}

if (slopes.native) {
  lines.push('## Scaling with data size', '');
  lines.push('One line chart, canvas renderer, mount. A constant ratio to native as the data grows means the wrapper adds no work', 'that grows faster than ECharts\' own.', '');
  lines.push('| Points | Payload | Native stable | Server stable | WebAssembly stable | Native browser CPU | Server browser CPU | WebAssembly browser CPU | Server CPU | Server .NET alloc | WebAssembly .NET alloc |');
  lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const w of ladder) {
    const [native, server, wasm] = hosts.map(host => find(host, w.name, 'canvas'));
    const ratio = (summary, field) => summary && native ? `${ms(at(summary, 'mount', field))} (×${(at(summary, 'mount', field) / at(native, 'mount', field)).toFixed(1)})` : '—';
    lines.push(`| ${count(w.size)} | ${size(native?.bytes)} | ${ms(at(native, 'mount', 'stableMs'))} | ${ratio(server, 'stableMs')} | ${ratio(wasm, 'stableMs')} | `
      + `${ms(at(native, 'mount', 'browserTaskMs'))} | ${ratio(server, 'browserTaskMs')} | ${ratio(wasm, 'browserTaskMs')} | `
      + `${server?.phases.mount.serverCpuMs ? ms(mean(server.phases.mount.serverCpuMs)) : '—'} | ${size(at(server, 'mount', 'allocatedBytes'))} | ${size(at(wasm, 'mount', 'allocatedBytes'))} |`);
  }

  lines.push('', 'Least-squares fit of the medians over the ladder, per 100,000 points:', '');
  lines.push('| Host | Stable time: fixed + per 100k points | Browser CPU per 100k points | Browser CPU per point, relative to native |');
  lines.push('|---|---:|---:|---:|');
  for (const host of hosts.filter(h => slopes[h])) {
    const s = slopes[host];
    lines.push(`| ${hostNames[host]} | ${ms(s.stable.a)} + ${ms(s.stable.b)} | ${ms(s.cpu.b)} | ×${(s.cpu.b / slopes.native.cpu.b).toFixed(2)} |`);
  }

  lines.push('');
}

lines.push('## Results', '');
for (const w of workloads.filter(w => w.kind === 'line' || w.kind === 'wordcloud')) {
  const rows = summaries.filter(summary => summary.workload === w.name);
  if (!rows.length)
    continue;

  const wordcloud = w.kind === 'wordcloud';
  lines.push(`### ${w.title}`, '');
  lines.push(`Payload ${count(rows[0].bytes)} bytes per chart; ${rows[0].samples} samples per configuration.`, '');
  lines.push('| Host | Renderer | Serialize | Mount apply | Mount stable | Update apply | Update stable | Export | Dispose |' + (wordcloud ? ' Words placed |' : ''));
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|' + (wordcloud ? '---:|' : ''));
  for (const row of rows)
    lines.push(`| ${hostNames[row.host]} | ${row.renderer} | ${cell(stat(row, 'serialize', 'serializeMs'))} | ${cell(stat(row, 'mount', 'applyMs'))} | `
      + `${cell(stat(row, 'mount', 'stableMs'))} | ${cell(stat(row, 'update', 'applyMs'))} | ${cell(stat(row, 'update', 'stableMs'))} | `
      + `${cell(stat(row, 'export', 'exportMs'))} | ${cell(stat(row, 'unmount', 'disposeMs'))} |` + (wordcloud ? ` ${row.placed.join(', ')} |` : ''));

  lines.push('');
  lines.push('| Host | Renderer | Browser CPU mount | Browser CPU update | Server CPU mount | .NET alloc mount | Socket mount | JS heap retained | JS heap residue | .NET heap retained | .NET heap residue |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    const wrapper = row.host !== 'native';
    lines.push(`| ${hostNames[row.host]} | ${row.renderer} | ${ms(at(row, 'mount', 'browserTaskMs'))} | ${ms(at(row, 'update', 'browserTaskMs'))} | `
      + `${row.phases.mount.serverCpuMs ? ms(mean(row.phases.mount.serverCpuMs)) : '—'} | ${wrapper ? size(at(row, 'mount', 'allocatedBytes')) : '—'} | `
      + `${row.host === 'server' ? size(at(row, 'mount', 'socket')) : '—'} | ${size(median(row.heap.retained))} | ${signed(median(row.heap.residue), size)} | `
      + `${wrapper ? signed(median(row.managed.retained), size) : '—'} | ${wrapper ? signed(median(row.managed.residue), size) : '—'} |`);
  }

  lines.push('');
}

const stream = workloads.find(w => w.kind === 'stream');
const streamRows = summaries.filter(summary => summary.workload === stream?.name);
if (streamRows.length) {
  lines.push('## Streaming updates', '');
  lines.push(`${stream.title}: each update replaces the whole option, as a component does for a new \`Options\` reference, and is`,
    'awaited before the next one starts. Per-update values divide the phase by its updates.', '');
  lines.push('| Host | Per update | Updates/s | Browser CPU per update | Server CPU per update | .NET alloc per update | Socket per update | Runtime timers per update | Calls | JS heap growth | .NET heap growth |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|');
  for (const row of streamRows) {
    const updates = median(row.phases.stream.updates);
    const per = at(row, 'stream', 'applyMs') / updates;
    const wrapper = row.host !== 'native';
    lines.push(`| ${hostNames[row.host]} | ${ms(per)} | ${count(Math.round(1000 / per))} | ${ms(at(row, 'stream', 'browserTaskMs') / updates)} | `
      + `${row.phases.stream.serverCpuMs ? ms(mean(row.phases.stream.serverCpuMs) / updates) : '—'} | ${wrapper ? size(at(row, 'stream', 'allocatedBytes') / updates) : '—'} | `
      + `${row.host === 'server' ? size(at(row, 'stream', 'socket') / updates) : '—'} | `
      + `${stat(row, 'stream', 'runtimeTimers') ? (at(row, 'stream', 'runtimeTimers') / updates).toFixed(3) : '—'} | `
      + `${wrapper ? `${row.phases.stream.calls[0]} → / ${row.phases.stream.calls[1]} ←` : '—'} | `
      + `${signed(median(row.heap.streamed), size)} | ${wrapper ? signed(median(row.managed.streamed), size) : '—'} |`);
  }

  lines.push('');
}

const hover = workloads.find(w => w.kind === 'hover');
const hoverRows = summaries.filter(summary => summary.workload === hover?.name);
if (hoverRows.length) {
  lines.push('## Event delivery', '');
  lines.push(`${hover.title}. The sweep ends when .NET has handled every delivery.`, '');
  lines.push('| Host | Events handled | Callbacks during the sweep | Sweep | Browser CPU per 100 events | Socket per event |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const row of hoverRows) {
    const events = row.events;
    lines.push(`| ${hostNames[row.host]} | ${count(events)} | ${row.host === 'native' ? '—' : count(row.phases.sweep.calls[1])} | `
      + `${cell(stat(row, 'sweep', 'sweepMs'))} | ${ms(at(row, 'sweep', 'browserTaskMs') / events * 100)} | `
      + `${row.host === 'server' ? size(at(row, 'sweep', 'socket') / events) : '—'} |`);
  }

  lines.push('');
}

lines.push('## Bridge calls per phase', '',
  'Counts are identical in every sample and on both hosts, so a change is a behavioural regression rather than noise.', '',
  '| Workload | Mount | Update | Export | Stream | Sweep | Unmount |', '|---|---|---|---|---|---|---|');
for (const w of workloads) {
  const row = summaries.find(summary => summary.workload === w.name && summary.host !== 'native');
  if (!row)
    continue;

  const calls = phase => row.phases[phase] ? `${row.phases[phase].calls[0]} → / ${row.phases[phase].calls[1]} ←` : '—';
  lines.push(`| ${w.name} | ${calls('mount')} | ${calls('update')} | ${calls('export')} | ${calls('stream')} | ${calls('sweep')} | ${calls('unmount')} |`);
}

const single = summaries.find(summary => summary.workload === 'line-1k' && summary.host !== 'native');
if (single) {
  const [toBrowser, toDotNet] = single.phases.mount.names;
  lines.push('', `One-chart mount: ${Object.entries(toBrowser).map(([name, value]) => `\`${name}\` ×${value}`).join(', ')} →; `
    + `${Object.entries(toDotNet).map(([name, value]) => `\`${name}\` ×${value}`).join(', ')} ← (the stability wait).`);
}

lines.push('', '## Resource and cost gates', '',
  'These run as ordinary tests with exact expectations:', '',
  '- `UpdateCostTests` (bUnit): a parent rerender with the same `Options` or `RawOptions` reference serializes nothing',
  '  and makes no browser call; a new reference serializes once and calls `setOption` once.',
  '- `resource-lifetime.spec.ts` (Playwright, Server and WebAssembly): resize without subscriptions makes no bridge call;',
  '  100 mount/update/resize/unmount cycles and 100 navigations return the page registry to its baseline;',
  '  races under load (reference bursts with imperative patches, update during a stable wait or export, dispose during',
  '  export, WordCloud layout or ECharts import) keep the latest accepted revision and leave no owned resources.', '');

await mkdir(dirname(report), { recursive: true });
await writeFile(report, lines.join('\n'));
await writeFile(join(root, 'artifacts', 'performance', 'summary.json'), JSON.stringify({ summaries, slopes, checks: [...checks.values()] }, null, 2) + '\n');
console.log(`Wrote ${report} from ${summaries.length} configurations.`);
if (failed.length) {
  console.error(`${failed.length} of ${checks.size} performance checks failed:\n${failures.join('\n')}`);
  process.exit(1);
}
