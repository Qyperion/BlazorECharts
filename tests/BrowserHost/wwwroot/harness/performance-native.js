// Native ECharts baseline of PerformanceProbe: the same engine, layout, prepared JSON and phases, without Blazor or the bridge.
const query = new URLSearchParams(location.search);
const name = query.get('workload') ?? 'line-10k';
const renderer = query.get('renderer') ?? 'canvas';
const seed = Number(query.get('seed') ?? '20261023');

export const echarts = await import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);

const phaseElement = document.querySelector('[data-testid=phase]');
const metricsElement = document.querySelector('[data-testid=metrics]');
const grid = document.querySelector('.perf-grid');
const layouts = new Map();
let charts = [];
let events = 0;
let sample = 0;

const workload = await (await fetch(`harness/performance/workload?name=${encodeURIComponent(name)}`)).json();
const payload = async (chart, stage) => {
  const response = await fetch(`harness/performance/payload?workload=${encodeURIComponent(name)}&seed=${seed}&chart=${chart}&stage=${stage}`);
  if (!response.ok)
    throw new Error(`Payload ${stage}-${chart} failed with ${response.status}.`);

  return response.text();
};

const indexes = Array.from({ length: workload.charts }, (_, i) => i);
const texts = {
  mount: await Promise.all(indexes.map(i => payload(i, 'mount'))),
  update: workload.kind === 'line' || workload.kind === 'wordcloud' ? await Promise.all(indexes.map(i => payload(i, 'update'))) : [],
  stream: workload.kind === 'stream' ? await payload(0, 'stream') : null,
};

// Signals the end of a WordCloud layout. The deferred is taken when the layout begins, so an aborted older layout cannot settle a newer one.
if (workload.kind === 'wordcloud') {
  const install = (await import(new URL('_content/BlazorECharts.WordCloud/js/wordcloud-installer.js', document.baseURI).href)).default;
  install(echarts).setLayoutLifecycle((series, api, canvas) => {
    const pending = layouts.get(api.getDom());
    return {
      run(start) {
        canvas.addEventListener('wordcloudstop', () => pending?.resolve(), { once: true });
        canvas.addEventListener('wordcloudabort', () => pending?.reject(new Error('WordCloud layout aborted.')), { once: true });
        start();
      },
      cancel() {},
      retire() {},
      fail(error) {
        pending?.reject(error);
      },
    };
  });
}

const columns = workload.charts === 1 ? 1 : workload.charts <= 4 ? 2 : 5;
const width = workload.charts === 1 ? 960 : workload.charts <= 4 ? 480 : 240;
const height = workload.charts === 1 ? 480 : workload.charts <= 4 ? 300 : 160;
grid.style.cssText = `display:grid;grid-template-columns:repeat(${columns}, ${width}px);gap:8px`;
const elements = indexes.map(() => {
  const element = document.createElement('div');
  element.className = 'perf-chart';
  element.style.cssText = `width:${width}px;height:${height}px`;
  grid.append(element);
  return element;
});

// Rendering is finished, as for AwaitStableAsync: the native finished event, and for WordCloud the end of its layout.
function settle(chart) {
  const finished = new Promise(resolve => {
    const listener = () => {
      chart.off('finished', listener);
      resolve();
    };
    chart.on('finished', listener);
  });
  if (workload.kind !== 'wordcloud')
    return () => finished;

  let resolve;
  let reject;
  const layout = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  layouts.set(chart.getDom(), { resolve, reject });
  return () => Promise.all([finished, layout]);
}

async function measure(phase, action) {
  phaseElement.textContent = `${phase}: running`;
  try {
    metricsElement.textContent = JSON.stringify(await action());
    phaseElement.textContent = `${phase}: done`;
  } catch (error) {
    metricsElement.textContent = '{}';
    phaseElement.textContent = `${phase}: failed ${error.name}: ${error.message}`;
  }
}

// A JavaScript application has its options as objects already: parsing happens before the clock starts.
const phases = {
  serialize: async () => ({ serializeMs: null, bytes: new TextEncoder().encode(texts.mount[0]).length, charts: workload.charts }),
  mount: async () => {
    sample++;
    events = 0;
    const options = texts.mount.map(text => JSON.parse(text));
    const started = performance.now();
    charts = elements.map(element => echarts.init(element, null, { renderer }));
    const created = performance.now() - started;
    const stable = charts.map(settle);
    charts.forEach((chart, i) => chart.setOption(options[i]));
    const applied = performance.now() - started;
    await Promise.all(stable.map(wait => wait()));
    if (workload.kind === 'hover')
      charts[0].on('mousemove', () => events++);

    return { createMs: created, applyMs: applied, stableMs: performance.now() - started, sample };
  },
  update: async () => {
    const options = texts.update.map(text => JSON.parse(text));
    const started = performance.now();
    const stable = charts.map(settle);
    charts.forEach((chart, i) => chart.setOption(options[i]));
    const applied = performance.now() - started;
    await Promise.all(stable.map(wait => wait()));
    return { applyMs: applied, stableMs: performance.now() - started };
  },
  export: async () => {
    const started = performance.now();
    const image = charts[0].getDataURL();
    return { exportMs: performance.now() - started, exportLength: image.length };
  },
  stream: async () => {
    const updates = JSON.parse(texts.stream);
    const chart = charts[0];
    const started = performance.now();
    let stable;
    for (const [index, options] of updates.entries()) {
      if (index === updates.length - 1)
        stable = settle(chart);

      chart.setOption(options);
    }

    const applied = performance.now() - started;
    await stable();
    return { updates: updates.length, applyMs: applied, stableMs: performance.now() - started };
  },
  report: async () => ({ events }),
  unmount: async () => {
    const started = performance.now();
    for (const chart of charts)
      chart.dispose();

    charts = [];
    return { disposeMs: performance.now() - started };
  },
};

const buttons = document.querySelector('.perf-buttons');
for (const [phase, action] of Object.entries(phases)) {
  const button = document.createElement('button');
  button.textContent = phase[0].toUpperCase() + phase.slice(1);
  button.addEventListener('click', () => measure(phase, action));
  buttons.append(button);
}

phaseElement.textContent = 'ready';
