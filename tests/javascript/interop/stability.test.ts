import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartInstance } from '../../../src/BlazorECharts/JavaScript/chart-instance.ts';
import { GroupCoordinator } from '../../../src/BlazorECharts/JavaScript/group-coordinator.ts';
import { PageRuntime } from '../../../src/BlazorECharts/JavaScript/page-runtime.ts';

function fixture(renderer = 'canvas') {
  const state = { animation: false, disposed: false, captures: 0, image: undefined as any };
  const zr = {
    animation: { isFinished: () => !state.animation },
    _needsRefresh: false,
    _needsRefreshHover: false,
    painter: { getType: () => renderer },
    storage: { getDisplayList: () => state.image ? [{ style: { image: state.image } }] : [] },
  };
  const native: any = {
    __pendingUpdate: null,
    _scheduler: { unfinished: false },
    _pendingActions: [],
    setOption() {},
    getOption: () => ({}),
    resize() {},
    dispose: () => state.disposed = true,
    isDisposed: () => state.disposed,
    getZr: () => zr,
    getDataURL: () => {
      state.captures++;
      return 'data:image/png;base64,fixture';
    },
    getConnectedDataURL: () => {
      state.captures++;
      return 'connected';
    },
    renderToSVGString: () => '<svg/>',
    getSvgDataURL: () => 'data:image/svg+xml,fixture',
  };
  const chart = new ChartInstance(native);
  chart.setOption({}, {});
  return { chart, native, state, zr };
}

// The missing capture/coordinator behaviors, rather than ECharts mocks, must keep these tests red.
async function capture(chart: ChartInstance, groups = new GroupCoordinator(), method = 'getDataURL', timeout = 1000, signal?: AbortSignal) {
  const { stableCapture } = await import('../../../src/BlazorECharts/JavaScript/exports.ts');
  return stableCapture(chart, groups, method, [], timeout, signal);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('revision-aware stable exports', () => {
  it('Stable_OldRevisionCannotCompleteNewWait', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart, state } = fixture();
    const old = chart.stability.begin('layout', 'revision');
    const result = capture(chart);
    await vi.advanceTimersByTimeAsync(20);
    chart.setOption({}, {});
    const current = chart.stability.begin('layout', 'revision');
    old.complete();

    // Act
    await vi.advanceTimersByTimeAsync(40);

    // Assert
    expect(state.captures).toBe(0);

    // Act
    current.complete();
    await vi.advanceTimersByTimeAsync(40);

    // Assert
    expect(await result).toContain('data:image');
  });

  it('Stable_RevisionsDoNotResetDeadline', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart, state } = fixture();
    state.animation = true;
    const result = capture(chart, undefined, undefined, 100);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/timeout/i);

    // Act
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(20);
      chart.setOption({}, {});
    }

    await rejected;

    // Assert
    expect(state.captures).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ConnectedExport_WaitsAllAndRechecksMembership', async () => {
    // Arrange
    vi.useFakeTimers();
    const a = fixture();
    const b = fixture();
    const c = fixture();
    const groups = new GroupCoordinator();
    a.native.group = b.native.group = 'g';
    groups.track('a', a.chart);
    groups.track('b', b.chart);
    groups.track('c', c.chart);
    groups.connect('g');
    const delayed = b.chart.stability.begin('layout', 'revision');
    const joined = c.chart.stability.begin('layout', 'revision');
    const result = capture(a.chart, groups, 'getConnectedDataURL');
    await vi.advanceTimersByTimeAsync(32);
    c.native.group = 'g';
    delayed.complete();

    // Act
    await vi.advanceTimersByTimeAsync(32);

    // Assert
    expect(a.state.captures).toBe(0);

    // Act
    c.native.group = '';
    await vi.advanceTimersByTimeAsync(32);

    // Assert
    expect(await result).toBe('connected');

    // Act
    joined.cancel();

    // Assert
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Capture_AtomicRevisionCheck', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart, state, zr } = fixture();
    let interrupt = true;
    const read = zr.animation.isFinished;
    zr.animation.isFinished = () => {
      if (interrupt) {
        interrupt = false;
        chart.setOption({}, {});
        chart.stability.begin('new work', 'revision');
      }

      return read();
    };
    const result = capture(chart, undefined, undefined, 100);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/timeout/i);

    // Act
    await vi.advanceTimersByTimeAsync(110);
    await rejected;

    // Assert
    expect(state.captures).toBe(0);
  });

  it('Stability_DisposalCleansWaiters', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart } = fixture();
    const pending = chart.stability.begin('layout', 'revision');
    const result = capture(chart);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/disposed/i);

    // Act
    await vi.advanceTimersByTimeAsync(16);
    chart.dispose();
    await vi.advanceTimersByTimeAsync(16);
    await rejected;
    pending.complete();

    // Assert
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ParticipantFailureAndCancellation_AreErrorsAndStaleSignalsAreIgnored', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart } = fixture();
    const pending = chart.stability.begin('layout', 'revision');
    const result = capture(chart);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/broken layout/);

    // Arrange
    pending.fail(Error('broken layout'));
    await vi.advanceTimersByTimeAsync(32);
    await rejected;
    chart.setOption({}, {});
    const canceled = chart.stability.begin('layout', 'revision');
    canceled.cancel();
    const cancelResult = capture(chart);

    // Act & Assert
    const cancelRejected = expect(cancelResult).rejects.toThrow(/cancel/i);

    // Act
    await vi.advanceTimersByTimeAsync(32);
    await cancelRejected;

    // Assert
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Cancellation_AndImages_DoNotReturnPartialSuccess', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart, state } = fixture();
    state.image = { complete: false, naturalWidth: 0, tagName: 'IMG' };
    const controller = new AbortController();
    const result = capture(chart, undefined, undefined, 1000, controller.signal);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/cancel/i);

    // Act
    await vi.advanceTimersByTimeAsync(32);

    // Assert
    expect(state.captures).toBe(0);

    // Act
    controller.abort(Error('cancelled'));
    await rejected;

    // Assert
    expect(vi.getTimerCount()).toBe(0);

    // Arrange
    state.image.complete = true;
    const broken = capture(chart);

    // Act & Assert
    const brokenRejected = expect(broken).rejects.toThrow(/image/i);
    await vi.advanceTimersByTimeAsync(32);
    await brokenRejected;
  });

  it('NativeAnimationProgressiveLazyUpdateAndActions_BlockCapture', async () => {
    // Arrange
    vi.useFakeTimers();

    // Act
    const { chart, state, native, zr } = fixture();

    // Assert
    for (const toggle of [
      () => state.animation = !state.animation,
      () => native._scheduler.unfinished = !native._scheduler.unfinished,
      () => native.__pendingUpdate = !native.__pendingUpdate,
      () => native._pendingActions = native._pendingActions.length ? [] : [{}],
      () => zr._needsRefresh = !zr._needsRefresh,
    ]) {
      toggle();
      const before = state.captures;
      const result = capture(chart);
      await vi.advanceTimersByTimeAsync(32);
      expect(state.captures).toBe(before);
      toggle();
      await vi.advanceTimersByTimeAsync(32);
      await result;
      expect(state.captures).toBe(before + 1);
    }

    expect(vi.getTimerCount()).toBe(0);
  });

  it('UnsupportedRendererFormat_IsExplicit', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart } = fixture();
    const result = capture(chart, undefined, 'renderToSVGString');

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/renderer|format/i);
    await vi.advanceTimersByTimeAsync(32);
    await rejected;
  });

  it('ExportBackgroundProbes_AreReleasedAfterCapture', async () => {
    // Arrange
    vi.useFakeTimers();
    const released: string[] = [];
    vi.stubGlobal('Image', class {
      src = '';
      complete = true;
      naturalWidth = 1;
      tagName = 'IMG';

      decode() {
        return Promise.resolve();
      }

      removeAttribute(name: string) {
        released.push(name);
      }
    });
    const { chart } = fixture();
    const { stableCapture } = await import('../../../src/BlazorECharts/JavaScript/exports.ts');
    const result = stableCapture(chart, new GroupCoordinator(), 'getDataURL', [{ backgroundColor: { image: 'unique-export.png' } }], 1000);
    await vi.advanceTimersByTimeAsync(32);

    // Act
    await result;

    // Assert
    expect(released).toEqual(['src']);
  });

  it('RenderFailure_CannotProduceOldSuccess', async () => {
    // Arrange
    vi.useFakeTimers();
    const { chart, native, state } = fixture();
    native.setOption = () => { throw Error('render failed'); };

    // Act & Assert
    expect(() => chart.setOption({}, {})).toThrow('render failed');

    // Arrange
    const result = capture(chart);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/render failed/);

    // Act
    await vi.advanceTimersByTimeAsync(32);
    await rejected;

    // Assert
    expect(state.captures).toBe(0);
  });

  it('HydrationFailure_RejectsPendingStableWaitInsteadOfCapturingPreviousState', async () => {
    // Arrange
    vi.useFakeTimers();
    const { native, state } = fixture();
    let rejectImport!: (error: unknown) => void;
    const runtime: any = {
      version: '6.1.0',
      graphic: {},
      use() {},
      dispose() {},
      registerMap() {},
      registerTheme() {},
      registerLocale() {},
      connect() {},
      disconnect() {},
      getInstanceById() {},
      getInstanceByDom() {},
      init: () => native,
    };
    const page = new PageRuntime(
      async url => url.endsWith('ec.js') ? runtime : new Promise((_r, reject) => rejectImport = reject),
      'https://example.test/',
      'https://example.test/ec.js'
    );
    await page.openFacade('owner');
    const id = page.createChart('owner', {} as HTMLElement, null, {})!;
    const apply = Promise.resolve(
      page.setOption(
        'owner',
        id,
        {
          json: { callback: null },
          bindings: [
            { kind: 'module', path: ['callback'], token: 'callback', signature: 'fixture', moduleUrl: './broken.js', exportName: 'callback' },
          ],
        },
        {}
      )
    );

    // Act & Assert
    const applyRejected = expect(apply).rejects.toThrow('module failure');

    // Arrange
    const result = page.exportChart('owner', id, 'operation', 'getDataURL', { json: { args: [] }, bindings: [] }, 1000);

    // Act & Assert
    const rejected = expect(result).rejects.toThrow('module failure');

    // Act
    await vi.advanceTimersByTimeAsync(16);
    rejectImport(Error('module failure'));
    await applyRejected;
    await vi.advanceTimersByTimeAsync(32);
    await rejected;

    // Assert
    expect(state.captures).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ConnectedExport_DisposedMemberRejectsAndRecreateIgnoresOldParticipants', async () => {
    // Arrange
    vi.useFakeTimers();
    const a = fixture();
    const b = fixture();
    const groups = new GroupCoordinator();
    a.native.group = b.native.group = 'g';
    groups.track('a', a.chart);
    groups.track('b', b.chart);
    groups.connect('g');
    b.chart.stability.begin('pending', 'revision');
    const result = capture(a.chart, groups, 'getConnectedDataURL');

    // Act & Assert
    const rejected = expect(result).rejects.toThrow(/disposed/i);

    // Act
    await vi.advanceTimersByTimeAsync(16);
    groups.remove('b');
    b.chart.dispose();
    await vi.advanceTimersByTimeAsync(16);
    await rejected;
    const old = a.chart.stability.begin('old', 'revision');
    const replacement = fixture();
    a.chart.recreate(() => replacement.native);
    old.fail(Error('obsolete failure'));
    const recreated = capture(a.chart);
    await vi.advanceTimersByTimeAsync(32);
    await recreated;

    // Assert
    expect(vi.getTimerCount()).toBe(0);
  });

  it('LayoutParticipantFailure_RaisesBrowserErrorEvent', () => {
    // Arrange
    const { native } = fixture();
    const element = new EventTarget();
    const errors: any[] = [];
    element.addEventListener('blazorecharts:error', event => errors.push((event as CustomEvent).detail));
    const chart = new ChartInstance(native, undefined, undefined, element as unknown as HTMLElement);
    chart.setOption({}, {});

    // Act
    chart.stability.begin('WordCloud', 'layout').fail(Error('font failed'));

    // Assert
    expect(errors).toEqual([
      { code: 'LayoutFailed', message: expect.stringContaining('font failed'), operation: 'layout:WordCloud', upstreamVersion: '6.1.0' },
    ]);

    // Act
    chart.stability.begin('cancelled', 'layout').cancel();
    const stale = chart.stability.begin('stale', 'revision');
    chart.setOption({}, {});
    stale.fail(Error('obsolete'));
    const retired = chart.stability.begin('retired', 'layout');
    retired.retire();
    retired.fail(Error('late'));

    // Assert
    expect(errors).toHaveLength(1);
  });

  it('TicketScope_RevisionEndsOnAnyRenderRevisionAndLayoutLastsUntilSettled', () => {
    // Arrange
    const { chart, native } = fixture();
    native.dispatchAction = () => {};

    // Act
    const overlay = chart.stability.begin('overlay', 'revision');

    // Assert
    expect(chart.stability.ready()).toBe(false);

    // Act
    chart.dispatchAction({ type: 'highlight' }, null);

    // Assert
    expect(chart.stability.ready()).toBe(true);

    // Act
    overlay.complete();
    const layout = chart.stability.begin('layout', 'layout');
    chart.dispatchAction({ type: 'highlight' }, null);
    chart.setOption({}, {});

    // Assert
    expect(chart.stability.ready()).toBe(false);

    // Act
    layout.complete();

    // Assert
    expect(chart.stability.ready()).toBe(true);
  });

  it('Begin_RequiresAnExplicitScope', () => {
    // Arrange
    const { chart } = fixture();
    const begin = chart.stability.begin.bind(chart.stability) as (name: string, scope?: string) => unknown;

    // Act & Assert
    expect(() => begin('missing')).toThrow(/LayoutScopeInvalid/);
    expect(() => begin('unknown', 'frame')).toThrow(/LayoutScopeInvalid/);
    expect(chart.stability.ready()).toBe(true);
  });

  it('TryStabilityParticipant_IsNullForChartsOutsideTheBridge', async () => {
    // Arrange
    const { native } = fixture();
    const runtime: any = {
      version: '6.1.0',
      graphic: {},
      use() {},
      dispose() {},
      registerMap() {},
      registerTheme() {},
      registerLocale() {},
      connect() {},
      disconnect() {},
      getInstanceById() {},
      getInstanceByDom() {},
      init: () => native,
    };
    const page = new PageRuntime(async () => runtime, 'https://example.test/', 'https://example.test/ec.js');
    await page.openFacade('owner');

    // Act
    page.createChart('owner', {} as HTMLElement, null, {});

    // Assert
    expect(page.tryStabilityParticipant({ setOption() {} } as any)).toBeNull();

    // Act & Assert
    expect(() => page.stabilityParticipant({ setOption() {} } as any)).toThrow(/ChartDisposed/);
    expect(typeof page.tryStabilityParticipant(native)?.begin).toBe('function');
  });
});
