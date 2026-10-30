import { EChartsError } from './errors.ts';
import { connectionState, isDisconnection } from './connection-state.ts';

export interface ManagedChartCallbacks {
  invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown>;
}

// One document MutationObserver for all charts; the style filter only while a Server chart needs it.
interface Mutations {
  observer: MutationObserver;
  callbacks: Map<() => void, boolean>;
  style: boolean;
}

const mutations = new WeakMap<Document, Mutations>();

function observeMutations(document: Document, callback: () => void, server: boolean): () => void {
  let entry = mutations.get(document);
  if (!entry) {
    const callbacks = new Map<() => void, boolean>();
    entry = {
      observer: new MutationObserver(() => {
        for (const listener of [...callbacks.keys()])
          listener();
      }),
      callbacks,
      style: false,
    };
    mutations.set(document, entry);
  }

  const shared = entry;
  const observe = (first: boolean) => {
    const style = [...shared.callbacks.values()].some(Boolean);
    if (!first && style === shared.style)
      return;

    shared.style = style;

    // The framework fallback reconnect host toggles style.display without dispatching the UI event.
    shared.observer.observe(
      document.documentElement,
      style ? { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] } : { childList: true, subtree: true }
    );
  };
  shared.callbacks.set(callback, server);
  observe(shared.callbacks.size === 1);
  return () => {
    if (!shared.callbacks.delete(callback))
      return;

    if (shared.callbacks.size === 0) {
      shared.observer.disconnect();
      shared.style = false;
      return;
    }

    if (shared.style && ![...shared.callbacks.values()].some(Boolean)) {
      shared.observer.disconnect();
      observe(true);
    }
  };
}

/** Browser-owned cleanup continues working when no managed circuit is reachable. */
export class ChartObservers {
  readonly #resize: ResizeObserver;
  readonly #removal: () => void;
  readonly #reconnected?: () => void;
  #frame = 0;
  #disposed = false;
  #signaled = false;
  #sizeDelivered = false;
  #reportedDisconnected = false;
  #removalDeferred = false;
  #removalAttempts = 0;
  #resizeChart?: () => void;
  readonly initiallySized: boolean;
  #autoResize: boolean;

  constructor(
    readonly element: HTMLElement,
    autoResize: boolean,
    readonly generation: number,
    readonly callbacks: ManagedChartCallbacks,
    readonly removed: () => void,
    readonly serverCallbacks = false
  ) {
    this.#autoResize = autoResize;
    this.initiallySized = this.hasSize;
    this.#signaled = this.initiallySized;
    this.#sizeDelivered = this.initiallySized;
    this.#resize = new ResizeObserver(() => this.#schedule());
    this.#removal = observeMutations(
      document,
      () => {
        if (this.#disposed)
          return;

        if (element.isConnected) {
          this.#resumeSize();
          return;
        }

        this.dispose();
        try {
          removed();
        } catch (error) {
          this.report(error);
        }

        this.#notify('BrowserRemoved');
      },
      serverCallbacks
    );
    this.#resize.observe(element);
    if (serverCallbacks)
      this.#reconnected = connectionState(document).onReconnected(() => {
        this.#reportedDisconnected = false;
        this.#resumeSize();
      });

    if (!element.isConnected) {
      this.dispose();
      throw new EChartsError('ChartElementRemoved', 'The chart container was removed.');
    }
  }

  get autoResize(): boolean {
    return this.#autoResize;
  }

  /** Starts or stops resizing a bound chart with its container. */
  set autoResize(value: boolean) {
    if (value === this.#autoResize || this.#disposed) {
      this.#autoResize = value;
      return;
    }

    this.#autoResize = value;
    if (!this.#resizeChart)
      return;

    if (value) {
      this.#resize.observe(this.element);
      this.#schedule();
      return;
    }

    // A size wait for a hidden container keeps observing until it signals the shown container.
    if (!this.#signaled)
      return;

    this.#resize.disconnect();
    if (this.#frame)
      cancelAnimationFrame(this.#frame);

    this.#frame = 0;
  }

  get hasSize(): boolean {
    return this.element.isConnected && this.element.clientWidth > 0 && this.element.clientHeight > 0;
  }

  armSizeWait(): boolean {
    this.#signaled = this.hasSize;
    this.#sizeDelivered = this.#signaled;

    // A bound chart without AutoResize observes its size only until a hidden container is shown again.
    if (!this.#signaled && !this.autoResize && this.#resizeChart && !this.#disposed)
      this.#resize.observe(this.element);

    return this.#signaled;
  }

  #resumeSize(): void {
    if (!this.#disposed && this.#signaled && !this.#sizeDelivered && this.hasSize)
      this.#notify('ContainerReady');
  }

  bind(resize: () => void): void {
    if (this.#disposed || !this.hasSize)
      throw new EChartsError('ChartContainerNotReady', 'The chart container must be connected and have a nonzero size.');

    this.#resizeChart = resize;
    if (!this.autoResize) {
      this.#resize.disconnect();
      if (this.#frame)
        cancelAnimationFrame(this.#frame);

      this.#frame = 0;
    }
  }

  #schedule(): void {
    if (this.#disposed || this.#frame)
      return;

    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (this.#disposed || !this.hasSize)
        return;

      if (!this.#signaled) {
        this.#signaled = true;
        this.#notify('ContainerReady');
      }

      if (!this.autoResize && this.#resizeChart) {
        this.#resize.disconnect();
        return;
      }

      try {
        this.#resizeChart?.();
      } catch (error) {
        this.report(error);
      }
    });
  }

  #notify(method: string, ...args: unknown[]): void {
    // Observe both synchronous disposal failures and rejected Server callback promises.
    Promise.resolve()
      .then(() => {
        if (this.#disposed && method !== 'BrowserRemoved')
          return;

        if (method === 'ContainerReady' && this.#sizeDelivered)
          return;

        if (this.serverCallbacks && !connectionState(document).connected) {
          if (!this.#reportedDisconnected)
            this.#dispatch('CircuitDisconnected', 'The Server circuit is disconnected; use the browser error channel until reconnection.', method);

          this.#reportedDisconnected = true;
          if (method === 'BrowserRemoved')
            this.#deferRemoval();

          return;
        }

        this.#reportedDisconnected = false;
        if (method === 'ContainerReady')
          this.#sizeDelivered = true;

        return this.callbacks.invokeMethodAsync(method, this.generation, ...args);
      })
      .catch(error => {
        if (method === 'ContainerReady')
          this.#sizeDelivered = false;

        const disconnected = isDisconnection(this.serverCallbacks, error);
        if (disconnected && this.serverCallbacks && method === 'BrowserRemoved')
          this.#deferRemoval();

        this.#dispatch(disconnected ? 'CircuitDisconnected' : 'CallbackFailed', String(error), method);
      });
  }

  // The component must learn that its container is gone, or it stays Ready with a disposed chart: retry after reconnection.
  #deferRemoval(): void {
    if (this.#removalDeferred || ++this.#removalAttempts > 60)
      return;

    this.#removalDeferred = true;
    const retry = () => {
      stop();
      clearInterval(poll);
      this.#removalDeferred = false;
      this.#notify('BrowserRemoved');
    };
    const stop = connectionState(document).onReconnected(retry);

    // Blazor's fallback reconnect overlay raises no event: check the connection while the removal waits.
    const poll = setInterval(
      () => {
        if (connectionState(document).connected)
          retry();
      },
      1_000
    );
  }

  #dispatch(code: string, message: string, operation: string): void {
    this.element.dispatchEvent(new CustomEvent('blazorecharts:error', {
      bubbles: true,
      detail: { code, message, operation, generation: this.generation, upstreamVersion: '6.1.0' },
    }));
  }

  report(error: unknown): void {
    const code = error instanceof EChartsError ? error.code : 'ChartResizeFailed';
    this.#dispatch(code, String(error), 'resize');
    this.#notify('BrowserError', code, String(error));
  }

  browserDisposed(): void {
    this.dispose();
    this.#notify('BrowserRemoved');
  }

  dispose(): void {
    if (this.#disposed)
      return;

    this.#disposed = true;
    this.#resize.disconnect();
    this.#removal();
    this.#reconnected?.();
    if (this.#frame)
      cancelAnimationFrame(this.#frame);

    this.#frame = 0;
    this.#resizeChart = undefined;
  }
}
