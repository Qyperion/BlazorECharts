import { EChartsError } from './errors.ts';
import type { ChartInstance } from './chart-instance.ts';
import { ImageReadiness } from './image-readiness.ts';

export interface StabilityTicket {
  readonly generation: number;
  readonly revision: number;
  readonly token: number;
  complete(): void;
  cancel(): void;
  fail(error: unknown): void;
  retire(): void;
}

/**
 * Extension work that stable exports wait for. Participants must begin before starting asynchronous work.
 * A 'revision' ticket ends with the render revision it began in: any setOption, dispatchAction or resize drops it.
 * A 'layout' ticket lasts until it is settled or retired, or the chart is recreated.
 */
export class ChartStability {
  #next = 0;
  #epoch = '';
  #version = 0;
  #disposed = false;
  #failure?: unknown;
  readonly #pending = new Set<number>();
  readonly #layouts = new Map<number, number>();
  readonly #layoutFailures = new Map<number, unknown>();
  readonly #resources = new Set<number>();
  readonly #images = new ImageReadiness();

  constructor(readonly chart: ChartInstance) {}

  get disposed(): boolean {
    return this.#disposed;
  }

  fail(error: unknown): void {
    this.stamp();
    this.#failure = error;
    this.#version++;
  }

  stamp(): string {
    const epoch = `${this.chart.commands.generation}:${this.chart.commands.renderRevision}`;
    if (epoch !== this.#epoch) {
      // A visual action may revise the chart without replacing its asynchronous layout.
      for (const token of this.#pending)
        if (this.#layouts.get(token) !== this.chart.commands.generation)
          this.#pending.delete(token);

      for (const [token, generation] of this.#layouts)
        if (generation !== this.chart.commands.generation) {
          this.#layouts.delete(token);
          this.#layoutFailures.delete(token);
        }

      this.#epoch = epoch;
      this.#failure = undefined;
      this.#images.clear();
      this.#version++;
    }

    return `${epoch}:${this.#version}`;
  }

  begin(name: string, scope: 'revision' | 'layout'): StabilityTicket {
    if (scope !== 'revision' && scope !== 'layout')
      throw new EChartsError('LayoutScopeInvalid', `Layout participant ${name} requires the scope 'revision' or 'layout', not ${String(scope)}.`);

    if (this.#disposed)
      throw new EChartsError('ChartDisposed', 'Cannot begin layout on a disposed chart.');

    this.stamp();
    const epoch = this.#epoch;
    const token = ++this.#next;
    const generation = this.chart.commands.generation;
    const revision = this.chart.commands.renderRevision;
    if (scope === 'layout')
      this.#layouts.set(token, generation);

    this.#pending.add(token);
    this.#version++;
    const end = (error?: unknown): boolean => {
      this.stamp();
      if (this.#disposed || (scope === 'layout' ? generation !== this.chart.commands.generation : epoch !== this.#epoch)
        || !this.#pending.delete(token))
        return false;

      this.#version++;
      if (scope === 'layout' && error !== undefined)
        this.#layoutFailures.set(token, error);
      else {
        this.#layouts.delete(token);
        if (error !== undefined)
          this.#failure = error;
      }

      return true;
    };
    return Object.freeze({
      generation,
      revision,
      token,
      complete: () => { end(); },
      cancel: () => { end(new EChartsError('LayoutCancelled', `Layout participant cancelled: ${name}`)); },
      fail: (error: unknown) => {
        const failure = new EChartsError('LayoutFailed', `Layout participant ${name}: ${String(error)}`, { cause: error });

        // Layout runs without a .NET caller; the container event reports it even when nothing awaits stability.
        if (end(failure))
          this.chart.element?.dispatchEvent?.(new CustomEvent('blazorecharts:error', {
            bubbles: true,
            detail: { code: 'LayoutFailed', message: failure.message, operation: `layout:${name}`, upstreamVersion: '6.1.0' },
          }));
      },
      retire: () => {
        this.stamp();
        const removed = this.#pending.delete(token) || this.#layouts.has(token);
        this.#layouts.delete(token);
        this.#layoutFailures.delete(token);
        if (removed)
          this.#version++;
      },
    });
  }

  /** In-flight hydration/decode blocks every revision until the actual resource operation settles. */
  resource(): () => void {
    const token = ++this.#next;
    this.#resources.add(token);
    this.#version++;
    return () => {
      if (this.#resources.delete(token))
        this.#version++;
    };
  }

  ready(): boolean {
    this.stamp();
    if (this.#disposed || this.chart.native.isDisposed?.())
      throw new EChartsError('ChartDisposed', 'The chart was disposed while waiting for stability.');

    if (this.#failure !== undefined)
      throw this.#failure;

    if (this.#layoutFailures.size)
      throw this.#layoutFailures.values().next().value;

    if (this.#pending.size || this.#resources.size)
      return false;

    // These fields are pinned to ECharts/ZRender 6.1.0, including the finished-event conditions.
    const native = this.chart.native as unknown as {
      getZr?: () => any;
      _scheduler?: { unfinished: boolean };
      __pendingUpdate?: unknown;
      _pendingActions?: unknown[];
    };
    const zr = native.getZr?.();
    if (!zr?.animation?.isFinished || !native._scheduler || !native._pendingActions)
      throw new EChartsError('StabilityCapabilityMissing', 'Stable capture requires the ECharts 6.1.0 animation/scheduler state.');

    if (!zr.animation.isFinished() || native.__pendingUpdate || native._scheduler.unfinished || native._pendingActions.length
      || zr._needsRefresh || zr._needsRefreshHover)
      return false;

    if (!this.#images.backgroundReady(zr.getBackgroundColor?.()))
      return false;

    for (const element of zr.storage.getDisplayList())
      if (!this.#images.ready(element.style?.image, element.__image) || !this.#images.ready(element.style?.fill?.image)
        || !this.#images.ready(element.style?.stroke?.image))
        return false;

    if (typeof document !== 'undefined' && document.fonts?.status === 'loading')
      return false;

    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#pending.clear();
    this.#layouts.clear();
    this.#layoutFailures.clear();
    this.#resources.clear();
    this.#images.clear();
    this.#version++;
  }
}
