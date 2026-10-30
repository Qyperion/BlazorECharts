import type { ChartObject, ThemeValue } from './runtime-provider.ts';
import type { ChartObservers } from './chart-observers.ts';
import { EChartsError } from './errors.ts';
import { ChartCommands } from './chart-commands.ts';
import { ChartStability } from './stability.ts';
import { ChartSnapshot } from './chart-snapshot.ts';
import { ChartEvents } from './events.ts';
import type { EventCallbacks } from './events.ts';
import { dispatchAction } from './actions.ts';
import { invokeInstanceMethod, renderingMethods } from './methods.ts';
import type { ReferenceLease } from './reference-registry.ts';

interface NativeZr {
  on(name: string, callback: () => void): void;
  off(name: string, callback: () => void): void;
}

/** One native handle and its optional component observers. */
export class ChartInstance {
  #disposed = false;
  #effectiveTheme: ThemeValue;
  #declarativeTheme: ThemeValue;
  recreationFailed = false;
  readonly commands = new ChartCommands();
  readonly stability = new ChartStability(this);
  exportReadiness?: EventCallbacks;
  readonly #snapshot = new ChartSnapshot();
  readonly events: ChartEvents;
  readonly #leases = new Map<object, ReferenceLease>();
  #actionLeases: ReferenceLease[] = [];
  #hydrationLifetime = new AbortController();
  readonly #nativeTargets = new Map<object, { lease: ReferenceLease; prune: () => void; cancel: () => void }>();
  #targetZr?: NativeZr;

  #pruneTargets = () => {
    for (const [target, entry] of this.#nativeTargets) {
      if ((target as { __zr?: unknown }).__zr !== this.#targetZr) {
        this.#nativeTargets.delete(target);
        entry.cancel();
        void entry.lease.dispose();
      } else
        entry.prune();
    }
  };

  retainNativeTarget(target: object, lease: ReferenceLease, prune: () => void, cancel: () => void): void {
    if (this.#nativeTargets.has(target))
      return;

    const zr = (target as { __zr?: NativeZr }).__zr;
    if (!zr)
      return;

    if (!this.#targetZr) {
      this.#targetZr = zr;
      zr.on('rendered', this.#pruneTargets);
    }

    this.#nativeTargets.set(target, { lease: lease.retain(), prune, cancel });
  }

  #clearNativeTargets(): void {
    this.#targetZr?.off('rendered', this.#pruneTargets);
    this.#targetZr = undefined;
    for (const entry of this.#nativeTargets.values()) {
      entry.cancel();
      void entry.lease.dispose();
    }

    this.#nativeTargets.clear();
  }

  get hydrationSignal(): AbortSignal {
    return this.#hydrationLifetime.signal;
  }

  retainActionBindings(leases: ReferenceLease[]): void {
    for (const lease of this.#actionLeases)
      void lease.dispose();

    this.#actionLeases = leases;
  }

  assertActive(generation = this.commands.generation): void {
    this.#active();
    if (this.commands.generation !== generation)
      throw new EChartsError('ChartCommandStale', 'Binding belongs to an obsolete generation.');
  }

  #retain(leases: ReferenceLease[]): void {
    for (const lease of leases) {
      const value = lease.value;
      if (this.#leases.has(value))
        void lease.dispose();
      else
        this.#leases.set(value, lease);
    }
  }

  // Releases leases whose values the native option no longer reaches. `current` is a getOption() result the caller already read.
  #pruneBindings(current?: unknown): void {
    if (this.#leases.size === 0 || !this.native.getOption)
      return;

    const seen = new Set<object>();

    function visit(v: unknown): void {
      if ((typeof v !== 'object' && typeof v !== 'function') || v === null || seen.has(v))
        return;

      seen.add(v);
      if (typeof v === 'function')
        return;

      if (Array.isArray(v)) {
        // Data arrays are large and mostly primitive: only object and function items can hold a bound value.
        for (let i = 0; i < v.length; i++) {
          const item: unknown = v[i];
          if (item !== null && (typeof item === 'object' || typeof item === 'function'))
            visit(item);
        }

        return;
      }

      const prototype = Object.getPrototypeOf(v);
      if (prototype !== Object.prototype && prototype !== null)
        return;

      for (const d of Object.values(Object.getOwnPropertyDescriptors(v)))
        if ('value' in d)
          visit(d.value);
    }

    visit(current ?? this.native.getOption());
    const reachable = (value: object, visited = new Set<object>()): boolean => {
      if (seen.has(value))
        return true;

      if (visited.has(value) || typeof value === 'function')
        return false;

      visited.add(value);
      for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
        if ('value' in d && d.value !== null && (typeof d.value === 'object' || typeof d.value === 'function') && reachable(d.value, visited))
          return true;

      return false;
    };
    for (const [value, lease] of this.#leases)
      if (!reachable(value)) {
        this.#leases.delete(value);
        void lease.dispose();
      }
  }

  constructor(
    public native: ChartObject,
    readonly observationId?: string,
    readonly observers?: ChartObservers,
    readonly element?: HTMLElement,
    runtimeId = 'test-runtime',
    chartId = 'test-chart',
    theme: ThemeValue = null,
    server = false,
    resultLimit: number | null = null
  ) {
    this.#effectiveTheme = this.#declarativeTheme = theme;
    this.events = new ChartEvents(native, runtimeId, chartId, element, server, resultLimit);
    observers?.bind(() => {
      this.#active();
      if (!this.native.resize)
        throw new EChartsError('ChartCapabilityMissing', 'The native instance lacks resize().');

      this.commands.renderRevision++;
      try {
        this.native.resize();
      } catch (error) {
        this.stability.fail(error);
        throw error;
      }
    });
  }

  /** Applies options, then retains the hydrated binding leases; one getOption() serves the recreation snapshot and the lease prune. */
  setOption(
    options: unknown,
    update: unknown,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null,
    leases: ReferenceLease[] = []
  ): void {
    this.#active();
    this.commands.accept(generation, revision, sequence);
    try {
      this.native.setOption(options, update);
    } catch (error) {
      this.stability.fail(error);
      throw error;
    }

    const current = this.native.getOption?.();
    this.#snapshot.applied(this.native, options, update, current);
    this.#retain(leases);
    this.#pruneBindings(current);
  }

  setTheme(theme: string | null, generation?: number | null, revision?: number | null, sequence?: number | null): void {
    this.#active();
    if (!this.native.setTheme)
      throw new EChartsError('ChartCapabilityMissing', 'The native instance lacks setTheme().');

    this.commands.accept(generation, revision, sequence);
    try {
      this.native.setTheme(theme ?? 'default');
    } catch (error) {
      this.stability.fail(error);
      throw error;
    }

    this.#effectiveTheme = this.#declarativeTheme = theme;
    this.#snapshot.themeChanged(this.native);
  }

  recreate(
    create: (theme: ThemeValue) => ChartObject,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null,
    theme?: string | null
  ): void {
    this.#active();
    const snapshot = this.#snapshot.forRecreation(this.native);
    this.commands.accept(generation, revision, sequence, true);
    this.#hydrationLifetime.abort(Error('Chart generation disposed during hydration.'));
    this.#hydrationLifetime = new AbortController();
    this.recreationFailed = true;
    this.events.detach();
    const group = this.native.group;
    this.#clearNativeTargets();
    this.native.dispose();
    const effectiveTheme = theme !== undefined && theme !== this.#declarativeTheme ? theme : this.#effectiveTheme;
    this.native = create(effectiveTheme);
    this.native.group = group;
    this.#effectiveTheme = effectiveTheme;
    if (theme !== undefined)
      this.#declarativeTheme = theme;

    if (snapshot != null)
      this.native.setOption(snapshot, { notMerge: true });

    this.#snapshot.recreated(this.native, snapshot);
    this.events.rebind(this.native);
    this.recreationFailed = false;
  }

  dispose(): void {
    if (this.#disposed)
      return;

    this.#disposed = true;
    this.stability.dispose();
    this.exportReadiness = undefined;
    this.#hydrationLifetime.abort(Error('Chart disposed during hydration.'));
    this.#clearNativeTargets();
    for (const lease of this.#leases.values())
      void lease.dispose();

    this.#leases.clear();
    for (const lease of this.#actionLeases)
      void lease.dispose();

    this.#actionLeases = [];
    this.events.dispose();
    this.observers?.dispose();
    this.native.dispose();
  }

  dispatchAction(
    payload: Record<string, unknown>,
    settings: boolean | Record<string, unknown> | null,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): void {
    this.#active();
    this.commands.accept(generation, revision, sequence);
    try {
      dispatchAction(this.native, payload, settings);
    } catch (error) {
      this.stability.fail(error);
      throw error;
    }
  }

  invokeMethod(method: string, args: unknown[], generation?: number | null, revision?: number | null, sequence?: number | null): unknown {
    try {
      if (method !== 'isDisposed')
        this.#active();

      this.commands.accept(generation, revision, sequence, false, renderingMethods.has(method));
      const result = invokeInstanceMethod(this.native, method, args);
      if (method === 'setTheme') {
        this.#effectiveTheme = args[0] as ThemeValue;
        this.#snapshot.themeChanged(this.native);
      }

      if (method === 'clear') {
        const current = this.native.getOption?.();
        this.#snapshot.applied(this.native, {}, { notMerge: true }, current);
        this.#pruneBindings(current);
      }

      return result;
    } catch (error) {
      if (renderingMethods.has(method))
        this.stability.fail(error);

      throw new EChartsError(
        error instanceof EChartsError ? error.code : 'InstanceMethodFailed',
        `chart=${this.events.chartId}; operation=${method}; upstreamVersion=6.1.0; ${String(error)}`,
        { cause: error }
      );
    }
  }

  #active(): void {
    if (this.#disposed || this.native.isDisposed?.())
      throw new EChartsError('ChartDisposed', 'The chart has been disposed.');
  }
}
