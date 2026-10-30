import { afterEach, expect, it, vi } from 'vitest';
import { ChartInstance } from '../../../src/BlazorECharts/JavaScript/chart-instance.ts';
import { stableCapture } from '../../../src/BlazorECharts/JavaScript/exports.ts';
import { GroupCoordinator } from '../../../src/BlazorECharts/JavaScript/group-coordinator.ts';
import { wordCloudStability, wordCloudResources } from '../../../src/BlazorECharts.WordCloud/JavaScript/wordcloud-stability.ts';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};

function fixture() {
  const zr = { animation: { isFinished: () => true }, storage: { getDisplayList: () => [] }, painter: { getType: () => 'canvas' } };
  const native: any = {
    setOption() {},
    getOption: () => ({}),
    dispose() {},
    isDisposed: () => false,
    getZr: () => zr,
    _scheduler: { unfinished: false },
    _pendingActions: [],
    getDataURL: () => 'complete image',
  };
  const chart = new ChartInstance(native);
  chart.setOption({}, {});
  const canvas = new EventTarget();
  const resource = deferred();
  const adapter = wordCloudStability(chart.stability.begin('WordCloud', 'revision'), canvas, () => resource.promise);
  return { chart, canvas, adapter, resource };
}

afterEach(() => vi.unstubAllGlobals());

it('WordCloudFinished_IsNotAssumedLayoutComplete', async () => {
  // Arrange
  const { chart, canvas, adapter, resource } = fixture();
  let started = false;
  adapter.run(() => { started = true; });

  // Act
  const image = stableCapture(chart, new GroupCoordinator(), 'getDataURL', [], 1000);

  // Assert
  expect(chart.stability.ready()).toBe(false);

  // Act
  resource.resolve();

  // Assert
  await vi.waitFor(() => expect(started).toBe(true));
  expect(chart.stability.ready()).toBe(false);

  // Act
  canvas.dispatchEvent(new Event('wordcloudstop'));

  // Assert
  expect(await image).toBe('complete image');
  chart.dispose();
});

it('WordCloudOldCompletion_CannotReleaseLatestRevision', async () => {
  // Arrange
  const { chart, canvas, adapter } = fixture();
  chart.setOption({}, {});
  const currentCanvas = new EventTarget();
  const current = wordCloudStability(chart.stability.begin('new', 'revision'), currentCanvas, async () => {});
  adapter.cancel();

  // Act
  canvas.dispatchEvent(new Event('wordcloudstop'));

  // Assert
  expect(chart.stability.ready()).toBe(false);

  // Act
  currentCanvas.dispatchEvent(new Event('wordcloudstop'));

  // Assert
  expect(chart.stability.ready()).toBe(true);
  current.cancel();
  chart.dispose();
});

it('WordCloudLayoutScope_SurvivesNonLayoutRevisionsAndReportsCurrentFailure', () => {
  // Arrange
  const { chart, adapter } = fixture();
  adapter.cancel();
  chart.setOption({}, {});
  const ticket = chart.stability.begin('WordCloud', 'layout');

  // Act
  chart.commands.renderRevision++;

  // Assert
  expect(chart.stability.ready()).toBe(false);

  // Arrange
  ticket.fail('active font failed');

  // Act & Assert
  expect(() => chart.stability.ready()).toThrow(/active font failed/);

  // Arrange
  chart.commands.renderRevision++;

  // Act & Assert
  expect(() => chart.stability.ready()).toThrow(/active font failed/);

  // Act
  ticket.retire();

  // Assert
  expect(chart.stability.ready()).toBe(true);
  chart.dispose();
});

it('WordCloudLayoutScope_RetiresOnlyItsOwnDependency', () => {
  // Arrange
  const { chart, adapter } = fixture();
  adapter.cancel();
  chart.setOption({}, {});
  const old = chart.stability.begin('old', 'layout');
  old.fail('old failure');
  chart.commands.renderRevision++;
  const current = chart.stability.begin('current', 'layout');
  old.retire();

  // Act
  old.complete();

  // Assert
  expect(chart.stability.ready()).toBe(false);

  // Act
  current.complete();

  // Assert
  expect(chart.stability.ready()).toBe(true);
  chart.dispose();
});

it('WordCloudLayoutScope_OldGenerationCannotReleaseNewLayout', () => {
  // Arrange
  const { chart, adapter } = fixture();
  adapter.cancel();
  chart.setOption({}, {});
  const old = chart.stability.begin('old', 'layout');
  chart.commands.generation++;
  const current = chart.stability.begin('new', 'layout');
  old.complete();
  old.fail('late');

  // Act
  old.retire();

  // Assert
  expect(chart.stability.ready()).toBe(false);

  // Act
  current.complete();

  // Assert
  expect(chart.stability.ready()).toBe(true);
  chart.dispose();
});

it('WordCloudEmptyAndCancelledLayout_Terminate', async () => {
  // Arrange
  const { chart, canvas, adapter, resource } = fixture();
  let started = false;
  adapter.run(() => { started = true; });
  adapter.cancel();
  resource.resolve();

  // Act
  await new Promise(a => setTimeout(a, 0));

  // Assert
  expect(started).toBe(false);

  // Arrange
  canvas.dispatchEvent(new Event('wordcloudstop'));

  // Act & Assert
  expect(() => chart.stability.ready()).toThrow(/cancelled/);

  // Act
  chart.setOption({}, {});

  // Assert
  expect(chart.stability.ready()).toBe(true);
  chart.dispose();
});

it('WordCloudFailure_RemovesListenersAndCannotBecomeSuccess', async () => {
  // Arrange
  const { chart, canvas } = fixture();
  canvas.dispatchEvent(new CustomEvent('wordcloudabort', { detail: { error: 'shape failed' } }));
  canvas.dispatchEvent(new Event('wordcloudstop'));

  // Act & Assert
  expect(() => chart.stability.ready()).toThrow(/shape failed/);
  chart.dispose();
});

it('WordCloudReadiness_CoversFontsMasksAndDisposal', async () => {
  // Arrange
  const fonts = deferred();
  const mask = deferred();

  class Image {
    naturalWidth = 10;
    naturalHeight = 10;
    decode = () => mask.promise;
  }

  const image = new Image();
  vi.stubGlobal('HTMLImageElement', Image);
  vi.stubGlobal('document', { fonts: { load: () => fonts.promise, ready: Promise.resolve() } });
  const series = {
    getData: () => ({ count: () => 1, getName: () => 'Україна', getItemModel: () => ({ getModel: () => ({}) }) }),
    ecModel: { get: () => undefined },
    get: (key: string) => key === 'maskImage' ? image : undefined,
  };
  let done = false;
  const ready = wordCloudResources(series, () => ({}), () => '12px Arial').then(() => { done = true; });
  fonts.resolve();

  // Act
  await new Promise(a => setTimeout(a, 0));

  // Assert
  expect(done).toBe(false);

  // Act
  mask.resolve();
  await ready;

  // Assert
  expect(done).toBe(true);

  // Arrange
  const f = fixture();
  f.adapter.run(() => { throw Error('late start'); });
  f.chart.dispose();
  f.adapter.cancel();
  f.resource.resolve();
  await new Promise(a => setTimeout(a, 0));

  // Act & Assert
  expect(() => f.chart.stability.ready()).toThrow(/disposed/);
});

it('WordCloudResourceFailure_RejectsStableWait', async () => {
  // Arrange
  const { chart, adapter, resource } = fixture();
  adapter.run(() => {});
  const result = stableCapture(chart, new GroupCoordinator(), 'getDataURL', [], 1000);
  resource.reject(Error('font failed'));

  // Act & Assert
  await expect(result).rejects.toThrow(/font failed/);
  chart.dispose();
});

it('WordCloudFontFailure_FailsTicketButLaysOutWithFallbackFont', async () => {
  // Arrange
  const f = fixture();
  f.adapter.cancel();
  const { chart } = f;
  chart.setOption({}, {});
  const canvas = new EventTarget();
  const adapter = wordCloudStability(chart.stability.begin('WordCloud', 'layout'), canvas, async () => Error('font failed'));
  let started = false;
  adapter.run(() => { started = true; });

  // Act & Assert
  const result = expect(stableCapture(chart, new GroupCoordinator(), 'getDataURL', [], 1000)).rejects.toThrow(/LayoutFailed.*font failed/);
  await vi.waitFor(() => expect(started).toBe(true));

  // Arrange
  await result;
  canvas.dispatchEvent(new Event('wordcloudstop'));

  // Act & Assert
  expect(() => chart.stability.ready()).toThrow(/font failed/);
  chart.dispose();
});

it('WordCloudResources_ReportFontFailureAfterAllFontsAndMask', async () => {
  // Arrange
  const failing = deferred();
  const other = deferred();
  const mask = deferred();

  class Image {
    naturalWidth = 10;
    naturalHeight = 10;
    decode = () => mask.promise;
  }

  const image = new Image();
  vi.stubGlobal('HTMLImageElement', Image);
  vi.stubGlobal('document', {
    fonts: { load: (font: string) => font.includes('Broken') ? failing.promise : other.promise, ready: Promise.resolve() },
  });
  const series = {
    getData: () => ({ count: () => 1, getName: () => 'Україна', getItemModel: () => ({ getModel: () => ({}) }) }),
    ecModel: { get: () => undefined },
    get: (key: string) => key === 'maskImage' ? image : undefined,
  };
  const makeFont = (style: Record<string, any>) => style.fontFamily === 'sans-serif' ? '16px Broken' : '16px Other';
  let result: unknown = 'pending';
  const ready = wordCloudResources(series, () => ({ fontFamily: 'Other' }), makeFont).then(value => { result = value; });
  failing.reject(Error('font failed'));

  // Act
  await new Promise(a => setTimeout(a, 0));

  // Assert
  expect(result).toBe('pending');

  // Act
  other.resolve();
  await new Promise(a => setTimeout(a, 0));

  // Assert
  expect(result).toBe('pending');

  // Act
  mask.resolve();
  await ready;

  // Assert
  expect(String(result)).toContain('font failed');

  // Arrange
  image.decode = () => Promise.reject(Error('mask decode failed'));

  // Act & Assert
  await expect(wordCloudResources(series, () => ({ fontFamily: 'Other' }), makeFont)).rejects.toThrow(/mask decode failed/);
});

it('WordCloudResources_HangingFontTimesOutAsFontFailure', async () => {
  // Arrange
  vi.useFakeTimers();
  try {
    let readyRead = false;
    const loads = new Map<string, ReturnType<typeof deferred>>();
    vi.stubGlobal('HTMLImageElement', class {});
    vi.stubGlobal('document', {
      fonts: {
        load: (font: string) => {
          const load = deferred();
          loads.set(font, load);
          return load.promise;
        },
        get ready() {
          readyRead = true;
          return new Promise(() => {});
        },
      },
    });
    const series = {
      getData: () => ({ count: () => 1, getName: () => 'Україна', getItemModel: () => ({ getModel: () => ({}) }) }),
      ecModel: { get: () => undefined },
      get: () => undefined,
    };
    const makeFont = (style: Record<string, any>) => style.fontFamily === 'sans-serif' ? '16px Hanging' : '16px Loaded';
    let result: unknown = 'pending';
    const ready = wordCloudResources(series, () => ({ fontFamily: 'Loaded' }), makeFont).then(value => { result = value; });
    loads.get('16px Loaded')!.resolve();

    // Act
    await vi.advanceTimersByTimeAsync(2999);

    // Assert
    expect(result).toBe('pending');

    // Act
    await vi.advanceTimersByTimeAsync(1);
    await ready;

    // Assert
    expect(String(result)).toBe('Error: WordCloud fonts did not load within 3000 ms: 16px Hanging.');
    expect(readyRead).toBe(false);

    // Act
    const prompt = wordCloudResources(series, () => ({ fontFamily: 'Loaded' }), makeFont);
    for (const load of loads.values())
      load.resolve();

    // Assert
    expect(await prompt).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
