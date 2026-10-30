// Test-only instrumentation; deliberately independent from the future library runtime.
import * as runtime from '/compatibility/echarts.js';
import { register } from '../../../tools/Assets/probe/wordcloud-adapter';

const ec = runtime as any;
const chartElement = document.querySelector<HTMLDivElement>('#chart')!;
let chart: any;
let shapeCalls = 0;
let colorCalls = 0;
const layouts: Layout[] = [];

type Layout = {
  canvas: HTMLCanvasElement;
  started: boolean;
  stopped: boolean;
  draws: number;
  listeners: Map<string, Set<any>>;
  done: Promise<void>;
};

// Observe the actual offscreen plugin canvas, without changing plugin code or events.
function capture<T>(operation: () => T): { value: T; layout: Layout } {
  const create = document.createElement.bind(document);
  const candidates: Layout[] = [];
  document.createElement = ((tag: string, options?: any) => {
    const element = create(tag, options);
    if (tag === 'canvas') {
      const canvas = element as HTMLCanvasElement;
      let complete!: () => void;
      const record: Layout = {
        canvas,
        started: false,
        stopped: false,
        draws: 0,
        listeners: new Map(),
        done: new Promise(resolve => { complete = resolve; }),
      };
      const add = canvas.addEventListener.bind(canvas);
      const remove = canvas.removeEventListener.bind(canvas);
      add('wordcloudstart', () => { record.started = true; });
      add('wordclouddrawn', () => { record.draws++; });
      add('wordcloudstop', () => {
        record.stopped = true;
        complete();
      });
      canvas.addEventListener = ((type: string, listener: any, opts?: any) => {
        if (type.startsWith('wordcloud')) {
          if (!record.listeners.has(type))
            record.listeners.set(type, new Set());

          record.listeners.get(type)!.add(listener);
        }

        add(type, listener, opts);
      }) as any;
      canvas.removeEventListener = ((type: string, listener: any, opts?: any) => {
        record.listeners.get(type)?.delete(listener);
        remove(type, listener, opts);
      }) as any;
      candidates.push(record);
    }

    return element;
  }) as any;
  try {
    const value = operation();
    const layout = candidates.find(c => c.started);
    if (!layout)
      throw new Error('Plugin did not start a real layout');

    layouts.push(layout);
    return { value, layout };
  } finally {
    document.createElement = create;
  }
}

function option(prefix = 'W', maskImage?: HTMLImageElement) {
  return {
    animation: false,
    backgroundColor: '#ffffff',
    series: [
      {
        type: 'wordCloud',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        gridSize: 4,
        sizeRange: [12, 12],
        rotationRange: [0, 90],
        rotationStep: 90,
        layoutAnimation: true,
        drawOutOfBound: false,
        shrinkToFit: false,
        maskImage,
        shape: () => {
          shapeCalls++;
          return 1;
        },
        textStyle: {
          fontFamily: 'Arial',
          color: (params: any) => {
            colorCalls++;
            return params.dataIndex === 199 ? 'rgb(255,0,255)' : 'rgb(0,80,160)';
          },
        },
        data: Array.from({ length: 200 }, (_, i) => ({ name: `${prefix}${String(i).padStart(3, '0')}`, value: 200 - i })),
      },
    ],
  };
}

async function settled(layout: Layout) {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([
      layout.done,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Actual wordcloudstop timed out')), 15_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout!);
  }

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  chart.getZr().refreshImmediately();
}

function summary() {
  const data = chart.getModel().getSeriesByIndex(0).getData();
  const words: any[] = [];
  for (let i = 0; i < data.count(); i++) {
    const el = data.getItemGraphicEl(i);
    if (el) {
      const bounds = el.getBoundingRect().clone();
      bounds.applyTransform(el.getComputedTransform());
      words.push({
        name: data.getName(i),
        rotation: el.rotation,
        fill: el.style.fill,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      });
    }
  }

  return {
    count: words.length,
    names: words.map(w => w.name),
    words,
    rotations: [...new Set(words.map(w => w.rotation))],
    shapeCalls,
    colorCalls,
    lastFill: words.find(w => w.name === 'W199')?.fill,
    signal: 'wordcloudstop',
  };
}

function mount(renderer: string) {
  if (chart && !chart.isDisposed())
    chart.dispose();

  chartElement.style.width = '1200px';
  chartElement.style.height = '800px';
  shapeCalls = colorCalls = 0;
  chart = ec.init(chartElement, null, { renderer, devicePixelRatio: 1 });
}

async function render(renderer: string) {
  mount(renderer);
  const { layout } = capture(() => chart.setOption(option()));
  await settled(layout);
  return summary();
}

async function decodeMask(url: string) {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error(`Mask image decode failed: ${url}`);
  }

  return image;
}

async function pixels(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let magenta = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (bytes[i] > 200 && bytes[i + 1] < 80 && bytes[i + 2] > 200 && bytes[i + 3] > 128)
      magenta++;
  }

  return magenta;
}

let registrations = 0;

const passedRuntime = new Proxy(ec, {
  get(target, property) {
    if (property === 'extendSeriesModel')
      return (...args: any[]) => {
        registrations++;
        return target.extendSeriesModel(...args);
      };

    return target[property];
  },
});

if (new URL(location.href).searchParams.has('distribution')) {
  // Characterize the exact upstream UMD artifact separately from register(runtime).
  (window as any).echarts = ec;
  await import('/compatibility/echarts-wordcloud.js');
  delete (window as any).echarts;
} else {
  register(passedRuntime);
  register(passedRuntime);
}

const provenance = await fetch('/compatibility/provenance.json').then(r => r.json());

(window as any).probe = {
  versions: () => ({
    ...provenance,
    echarts: ec.version,
    entryPath: new URL(location.href).searchParams.has('distribution') ? 'upstream-distribution' : 'static-adapter',
  }),
  identity: async () => {
    await render('canvas');
    return {
      sameInstance: ec.getInstanceByDom(chartElement) === chart,
      registrations,
      globalAbsent: !(window as any).echarts,
    };
  },
  render,
  mask: async () => {
    mount('canvas');
    const image = await decodeMask('/compatibility/assets/mask.svg');
    const decodedBeforeLayout = image.complete && image.naturalWidth === 1200;
    const { layout } = capture(() => chart.setOption(option('M', image)));
    await settled(layout);
    const result = summary();
    const outside = result.words.filter(({ bounds: b }) => b.x < 234 || b.y < 154 || b.x + b.width > 966 || b.y + b.height > 646);
    return { decodedBeforeLayout, count: result.count, outside };
  },
  badMask: async () => {
    let started = false;
    try {
      const image = await decodeMask('/compatibility/assets/missing.svg');
      started = true;
      chart.setOption(option('M', image));
      return { error: '', started };
    } catch (error) {
      return { error: String(error), started };
    }
  },
  lifecycle: async () => {
    await render('canvas');
    const superseded = capture(() => chart.setOption(option('S'), { notMerge: true }));
    const update = capture(() => chart.setOption(option('U'), { notMerge: true }));
    await settled(update.layout);
    const updated = summary().count;
    const supersededDraws = superseded.layout.draws;
    chartElement.style.width = '1100px';
    const resize = capture(() => chart.resize());
    await settled(resize.layout);
    const resized = summary().count;
    const pending = capture(() => chart.setOption(option('D'), { notMerge: true }));

    // Dispose while the actual asynchronous plugin loop still owns scheduled work.
    chart.dispose();
    const atDispose = pending.layout.draws;
    await new Promise(resolve => setTimeout(resolve, 250));
    const lateDraws = pending.layout.draws - atDispose;
    const pendingListeners = layouts.reduce((total, l) => total + [...l.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
    const remount = (await render('svg')).count;
    return {
      updated,
      resized,
      lateDraws,
      supersededDraws,
      pendingListeners,
      remount,
      listenerDetails: layouts.map(l => ({
        draws: l.draws,
        stopped: l.stopped,
        listeners: [...l.listeners].map(([name, set]) => [name, set.size]),
      })),
    };
  },
  exportProof: async (renderer: string) => {
    mount(renderer);
    const { layout } = capture(() => chart.setOption(option()));
    const beforeCount = summary().count;
    const before = chart.getDataURL({ type: renderer === 'svg' ? 'svg' : 'png', pixelRatio: 1 });
    await settled(layout);
    const result = summary();
    const final = chart.getDataURL({ type: renderer === 'svg' ? 'svg' : 'png', pixelRatio: 1 });
    return {
      count: result.count,
      beforeCount,
      lastWord: result.names.find(n => n === 'W199'),
      image: final,
      beforePixels: await pixels(before),
      finalPixels: await pixels(final),
      svg: renderer === 'svg' ? decodeURIComponent(final.substring(final.indexOf(',') + 1)) : undefined,
    };
  },
};

document.querySelector('[data-testid="status"]')!.textContent = 'ready';
