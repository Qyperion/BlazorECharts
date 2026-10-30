import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartObservers } from '../../../src/BlazorECharts/JavaScript/chart-observers.ts';

function browser() {
  const resize: FakeObserver[] = [];
  const mutation: FakeObserver[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;

  class FakeObserver {
    connected = false;

    constructor(readonly callback: () => void) {}

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }
  }

  vi.stubGlobal('ResizeObserver', class extends FakeObserver {
    constructor(cb: () => void) {
      super(cb);
      resize.push(this);
    }
  });
  vi.stubGlobal('MutationObserver', class extends FakeObserver {
    constructor(cb: () => void) {
      super(cb);
      mutation.push(this);
    }
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { documentElement: {} }));
  const element = Object.assign(new EventTarget(), { clientWidth: 0, clientHeight: 0, isConnected: true }) as unknown as HTMLElement;
  const tick = () => {
    for (const [key, callback] of frames) {
      frames.delete(key);
      callback(0);
    }
  };
  return {
    element,
    resize,
    mutation,
    frames,
    tick,
    size() {
      Object.assign(element, { clientWidth: 600, clientHeight: 300 });
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('browser lifecycle observers', () => {
  it('hidden container signals size once and batches native resize in one animation frame', async () => {
    // Arrange
    const env = browser();
    const notify = vi.fn(async () => {});

    // Act
    const observer = new ChartObservers(env.element, true, 7, { invokeMethodAsync: notify }, () => {});

    // Assert
    expect(observer.initiallySized).toBe(false);

    // Act
    env.resize[0].callback();
    env.tick();

    // Assert
    expect(notify).not.toHaveBeenCalled();

    // Act
    env.size();
    env.resize[0].callback();
    env.resize[0].callback();
    env.tick();
    await Promise.resolve();

    // Assert
    expect(notify).toHaveBeenCalledExactlyOnceWith('ContainerReady', 7);

    // Act
    const resize = vi.fn();
    observer.bind(resize);
    env.resize[0].callback();
    env.resize[0].callback();

    // Assert
    expect(resize).not.toHaveBeenCalled();

    // Act
    env.tick();

    // Assert
    expect(resize).toHaveBeenCalledTimes(1);
    observer.dispose();
  });

  it('removing an ancestor releases observers and cancels pending frames exactly once', async () => {
    // Arrange
    const env = browser();
    env.size();
    const removed = vi.fn();
    const notify = vi.fn(async () => {});
    const observer = new ChartObservers(env.element, true, 1, { invokeMethodAsync: notify }, removed);
    const resize = vi.fn();
    observer.bind(resize);
    env.resize[0].callback();
    Object.assign(env.element, { isConnected: false });
    env.mutation[0].callback();
    env.mutation[0].callback();
    await Promise.resolve();
    observer.dispose();

    // Act
    env.tick();

    // Assert
    expect(removed).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith('BrowserRemoved', 1);
    expect(env.resize[0].connected).toBe(false);
    expect(env.mutation[0].connected).toBe(false);
    expect(env.frames.size).toBe(0);
    expect(resize).not.toHaveBeenCalled();
  });

  it('AutoResize false still waits for initial size and keeps DOM removal cleanup', () => {
    // Arrange
    const env = browser();
    env.size();
    const observer = new ChartObservers(env.element, false, 1, { invokeMethodAsync: async () => {} }, () => {});
    env.resize[0].callback();
    const resize = vi.fn();
    observer.bind(resize);

    // Act
    env.tick();

    // Assert
    expect(resize).not.toHaveBeenCalled();
    expect(env.resize[0].connected).toBe(false);
    expect(env.mutation[0].connected).toBe(true);

    // Act
    observer.dispose();

    // Assert
    expect(env.mutation[0].connected).toBe(false);
  });

  it('a disconnected callback rejection reaches the browser error channel without another managed callback', async () => {
    // Arrange
    const env = browser();
    const failures: unknown[] = [];
    env.element.addEventListener('blazorecharts:error', event => failures.push((event as CustomEvent).detail));
    const notify = vi.fn(async () => { throw new Error("Cannot send data if the connection is not in the 'Connected' State."); });
    const observer = new ChartObservers(env.element, true, 2, { invokeMethodAsync: notify }, () => {});
    env.size();
    env.resize[0].callback();
    env.tick();

    // Act
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(failures).toMatchObject([{ code: 'CircuitDisconnected', operation: 'ContainerReady', generation: 2 }]);
    expect(notify).toHaveBeenCalledTimes(1);
    observer.dispose();
  });

  it('Server circuit down prevents sending managed callbacks and resumed hidden sizing can complete', async () => {
    // Arrange
    const env = browser();
    const notify = vi.fn(async () => {});
    const failures: unknown[] = [];
    env.element.addEventListener('blazorecharts:error', event => failures.push((event as CustomEvent).detail));
    const observer = new ChartObservers(env.element, true, 3, { invokeMethodAsync: notify }, () => {}, true);
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'show' } }));
    env.size();
    env.resize[0].callback();
    env.tick();

    // Act
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify).not.toHaveBeenCalled();
    expect(failures).toMatchObject([{ code: 'CircuitDisconnected' }]);

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
    await Promise.resolve();

    // Assert
    expect(notify).toHaveBeenCalledExactlyOnceWith('ContainerReady', 3);
    observer.dispose();
  });

  it('a container removed during a Server outage reports BrowserRemoved after reconnection', async () => {
    // Arrange
    const env = browser();
    env.size();
    const removed = vi.fn();
    let rejectFirst = true;

    // A send on the dead connection rejects; the reconnected circuit accepts the deferred removal.
    const notify = vi.fn(async () => {
      if (rejectFirst) {
        rejectFirst = false;
        throw new Error("Cannot send data if the connection is not in the 'Connected' State.");
      }
    });
    const observer = new ChartObservers(env.element, true, 4, { invokeMethodAsync: notify }, removed, true);
    observer.bind(() => {});
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'show' } }));
    Object.assign(env.element, { isConnected: false });
    env.mutation[0].callback();

    // Act
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(removed).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify).toHaveBeenCalledExactlyOnceWith('BrowserRemoved', 4);

    // Act
    // A removal whose send fails after reconnection waits for the next one.
    rejectFirst = true;
    const second = new ChartObservers(
      Object.assign(new EventTarget(), { clientWidth: 600, clientHeight: 300, isConnected: true }) as unknown as HTMLElement,
      true,
      5,
      { invokeMethodAsync: notify },
      () => {},
      true
    );
    second.browserDisposed();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify).toHaveBeenLastCalledWith('BrowserRemoved', 5);

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'show' } }));
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify.mock.calls.filter(call => call[1] === 5)).toHaveLength(2);

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify.mock.calls.filter(call => call[1] === 5)).toHaveLength(2);
  });

  it('behind Blazor fallback overlay, a removal waits until the overlay hides', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const env = browser();
      env.size();
      const overlay = { shadowRoot: { querySelector: (): unknown => ({}) } };
      Object.assign(document, { body: { children: [overlay] } });
      const notify = vi.fn(async () => {});
      const observer = new ChartObservers(env.element, true, 6, { invokeMethodAsync: notify }, () => {}, true);
      observer.browserDisposed();
      await new Promise(resolve => setTimeout(resolve, 0));
      vi.advanceTimersByTime(3_000);

      // Act
      await new Promise(resolve => setTimeout(resolve, 0));

      // Assert
      expect(notify).not.toHaveBeenCalled();

      // Act
      overlay.shadowRoot.querySelector = () => null;
      vi.advanceTimersByTime(1_000);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Assert
      expect(notify).toHaveBeenCalledExactlyOnceWith('BrowserRemoved', 6);

      // Act
      vi.advanceTimersByTime(5_000);

      // Assert
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a bound chart without AutoResize signals a shown container after a re-armed size wait', async () => {
    // Arrange
    const env = browser();
    env.size();
    const notify = vi.fn(async () => {});
    const observer = new ChartObservers(env.element, false, 4, { invokeMethodAsync: notify }, () => {});
    const resize = vi.fn();

    // Act
    observer.bind(resize);

    // Assert
    expect(env.resize[0].connected).toBe(false);

    // Act
    Object.assign(env.element, { clientWidth: 0, clientHeight: 0 });

    // Assert
    expect(observer.armSizeWait()).toBe(false);
    expect(env.resize[0].connected).toBe(true);

    // Act
    env.size();
    env.resize[0].callback();
    env.tick();
    await Promise.resolve();

    // Assert
    expect(notify).toHaveBeenCalledExactlyOnceWith('ContainerReady', 4);
    expect(resize).not.toHaveBeenCalled();
    expect(env.resize[0].connected).toBe(false);
    observer.dispose();
  });

  it('AutoResize turned off while a bound chart waits for its hidden container still signals the shown container', async () => {
    // Arrange
    const env = browser();
    env.size();
    const notify = vi.fn(async () => {});
    const observer = new ChartObservers(env.element, true, 8, { invokeMethodAsync: notify }, () => {});
    const resize = vi.fn();
    observer.bind(resize);

    // Act
    Object.assign(env.element, { clientWidth: 0, clientHeight: 0 });

    // Assert
    expect(observer.armSizeWait()).toBe(false);

    // Act
    observer.autoResize = false;

    // Assert
    expect(env.resize[0].connected).toBe(true);

    // Act
    env.size();
    env.resize[0].callback();
    env.tick();
    await Promise.resolve();

    // Assert
    expect(notify).toHaveBeenCalledExactlyOnceWith('ContainerReady', 8);
    expect(resize).not.toHaveBeenCalled();
    expect(env.resize[0].connected).toBe(false);
    observer.dispose();
  });

  it('a bound chart resends a shown-container signal lost to a Server outage after reconnection', async () => {
    // Arrange
    const env = browser();
    env.size();
    const notify = vi.fn(async () => {});
    const observer = new ChartObservers(env.element, false, 9, { invokeMethodAsync: notify }, () => {}, true);
    observer.bind(() => {});

    // Act
    Object.assign(env.element, { clientWidth: 0, clientHeight: 0 });

    // Assert
    expect(observer.armSizeWait()).toBe(false);

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'show' } }));
    env.size();
    env.resize[0].callback();
    env.tick();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify).not.toHaveBeenCalled();

    // Act
    document.dispatchEvent(new CustomEvent('components-reconnect-state-changed', { detail: { state: 'hide' } }));
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify).toHaveBeenCalledExactlyOnceWith('ContainerReady', 9);

    // Act
    env.mutation[0].callback();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(notify).toHaveBeenCalledTimes(1);
    observer.dispose();
  });

  it('a failing managed callback outside a Server circuit is CallbackFailed, not CircuitDisconnected', async () => {
    // Arrange
    const env = browser();
    env.size();
    const codes: string[] = [];
    env.element.addEventListener('blazorecharts:error', event => codes.push((event as CustomEvent<{ code: string }>).detail.code));
    const observer = new ChartObservers(
      env.element,
      true,
      5,
      { invokeMethodAsync: async () => { throw new Error('OnError handler failed'); } },
      () => {}
    );
    observer.report(new Error('resize failed'));

    // Act
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert
    expect(codes).toEqual(['ChartResizeFailed', 'CallbackFailed']);
    observer.dispose();
  });

  it('changing AutoResize on a bound chart stops and restarts resizing', () => {
    // Arrange
    const env = browser();
    env.size();
    const observer = new ChartObservers(env.element, true, 6, { invokeMethodAsync: async () => {} }, () => {});
    const resize = vi.fn();
    observer.bind(resize);

    // Act
    observer.autoResize = false;

    // Assert
    expect(env.resize[0].connected).toBe(false);

    // Act
    env.resize[0].callback();
    env.tick();

    // Assert
    expect(resize).not.toHaveBeenCalled();

    // Act
    observer.autoResize = true;

    // Assert
    expect(env.resize[0].connected).toBe(true);

    // Act
    env.tick();

    // Assert
    expect(resize).toHaveBeenCalledTimes(1);
    observer.dispose();
  });
});
