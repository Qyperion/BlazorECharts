import { validateBindings } from './binding-validation.ts';
import { hydrateBindings } from './bindings.ts';
import { createNativeValue } from './native-values.ts';
import { invokeNativeGraphic } from './graphic.ts';
import { NativeRegistrations } from './native-registrations.ts';
import { GraphicMutations, type GraphicMutationState } from './graphic-mutations.ts';
import type { PreparedOptionTransport, ReferenceHandle } from './binding-contracts.ts';
import { EChartsError } from './errors.ts';
import { ExtensionRegistry, type ExtensionDescriptor } from './extension-registry.ts';
import { ChartInstance } from './chart-instance.ts';
import { GroupCoordinator } from './group-coordinator.ts';
import { stableCapture, validateTimeout } from './exports.ts';
import { waitForLifetime } from './async-lifetime.ts';
import { invokeGlobal } from './global-methods.ts';
import type { EventCallbacks } from './events.ts';
import { ReferenceRegistry, type ReferenceLease } from './reference-registry.ts';
import { extractSnapshot } from './option-snapshot.ts';
import { ChartObservers, type ManagedChartCallbacks } from './chart-observers.ts';
import { utf8Length } from './connection-state.ts';
import {
  loadProvider,
  normalizeConfiguration,
  retryingModuleImporter,
  type EChartsRuntimeObject,
  type ChartObject,
  type ThemeValue,
  type ModuleImporter,
  type RuntimeConfiguration,
  type NormalizedConfiguration
} from './runtime-provider.ts';

interface Facade {
  active: boolean;
  ready: boolean;
  charts: Map<string, ChartInstance>;
  observations: Map<string, ChartObservers>;
  lifetime: AbortController;

  /** An Interactive Server facade: its results and events cross the SignalR circuit. */
  server: boolean;

  resultLimit: number | null;
}

/** One immutable configuration and one load promise per browser page. */
export class PageRuntime {
  // getRandomValues is also available on ordinary HTTP origins; randomUUID requires HTTPS.
  readonly id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

  readonly extensions: ExtensionRegistry;
  readonly groups = new GroupCoordinator();
  readonly #facades = new Map<string, Facade>();
  #configuration?: NormalizedConfiguration;
  #promise?: Promise<EChartsRuntimeObject>;
  #runtime?: EChartsRuntimeObject;
  #failed = false;
  #nextChart = 0;
  #nextResult = 0;
  readonly #references = new ReferenceRegistry(this.id, 'instance-results');
  readonly #referenceIdentities = new WeakMap<object, ReferenceHandle>();
  readonly #results = new Map<string, { owner: string; leases: ReferenceLease[] }>();
  readonly #registrations = new NativeRegistrations();
  readonly #mutations = new GraphicMutations(this.#references);
  readonly #nativeDisposed = new Map<string, string>();
  readonly #exports = new Map<string, { owner: string; chart: string; controller: AbortController }>();
  readonly #toBrowser = new Map<string, number>();
  readonly #toDotNet = new Map<string, number>();
  readonly importer: ModuleImporter;

  constructor(importer: ModuleImporter, readonly baseURI: string, readonly localModuleUrl: string) {
    this.importer = retryingModuleImporter(importer, baseURI);
    this.extensions = new ExtensionRegistry(() => this.#promise!, this.importer, baseURI);
  }

  async load(config: RuntimeConfiguration = {}, retry = false): Promise<EChartsRuntimeObject> {
    const normalized = normalizeConfiguration(config, this.baseURI, this.localModuleUrl);
    if (this.#configuration && JSON.stringify(this.#configuration) !== JSON.stringify(normalized))
      throw new EChartsError('RuntimeConfigurationConflict', 'This page already uses a different runtime provider or version.');

    this.#configuration ??= normalized;
    if (!this.#promise || (this.#failed && retry)) {
      this.#failed = false;
      this.#promise = Promise.resolve()
        .then(() => loadProvider(normalized, this.importer))
        .then(runtime => this.#runtime = runtime)
        .catch(error => {
          this.#failed = true;
          if (error instanceof EChartsError)
            throw error;

          throw new EChartsError('RuntimeLoadFailed', `Unable to load ${normalized.moduleUrl}: ${String(error)}`, { cause: error });
        });
    }

    return this.#promise;
  }

  async openFacade(
    ownerId: string,
    config: RuntimeConfiguration = {},
    descriptors: readonly ExtensionDescriptor[] = [],
    retry = false,
    server = false,
    resultLimit: number | null = null
  ): Promise<string> {
    if (!ownerId?.trim())
      throw new EChartsError('FacadeIdentityInvalid', 'A facade owner ID is required.');

    if (resultLimit != null && !(Number.isSafeInteger(resultLimit) && resultLimit > 0))
      throw new EChartsError('RuntimeConfigurationInvalid', 'The Server result limit must be a positive integer.');

    let facade = this.#facades.get(ownerId);
    if (!facade) {
      facade = { active: true, ready: false, charts: new Map(), observations: new Map(), lifetime: new AbortController(), server, resultLimit };
      this.#facades.set(ownerId, facade);
    }

    await this.load(config, retry);
    await this.extensions.registerAll(descriptors, retry);
    if (!facade.active)
      throw new EChartsError('FacadeDisposed', 'The facade was disposed during initialization.');

    facade.ready = true;
    return this.id;
  }

  observeChart(
    ownerId: string,
    observationId: string,
    element: HTMLElement,
    autoResize: boolean,
    generation: number,
    callbacks: ManagedChartCallbacks,
    serverCallbacks = false
  ): boolean {
    const facade = this.#facade(ownerId);
    if (facade.observations.has(observationId))
      throw new EChartsError('ChartObservationConflict', 'Observation identity is already active.');

    const observers = new ChartObservers(
      element,
      autoResize,
      generation,
      this.#managed(callbacks),
      () => {
        try {
          for (const [id, chart] of facade.charts)
            if (chart.observationId === observationId)
              this.disposeChart(ownerId, id);
        } finally {
          this.releaseObservation(ownerId, observationId);
        }
      },
      serverCallbacks
    );
    facade.observations.set(observationId, observers);
    return observers.initiallySized;
  }

  releaseObservation(ownerId: string, observationId: string): void {
    const observations = this.#facades.get(ownerId)?.observations;
    const observers = observations?.get(observationId);
    observations?.delete(observationId);
    observers?.dispose();
  }

  setAutoResize(ownerId: string, observationId: string, autoResize: boolean): void {
    const observers = this.#facade(ownerId).observations.get(observationId);
    if (!observers)
      throw new EChartsError('ChartElementRemoved', 'The chart observation was released.');

    observers.autoResize = autoResize;
  }

  checkChartSize(ownerId: string, observationId: string): boolean {
    const observers = this.#facade(ownerId).observations.get(observationId);
    if (!observers)
      throw new EChartsError('ChartElementRemoved', 'The chart observation was released.');

    return observers.armSizeWait();
  }

  createChart(
    ownerId: string,
    element: HTMLElement,
    theme: ThemeValue,
    init: Record<string, unknown>,
    observationId?: string | null,
    exportReadiness?: EventCallbacks | null
  ): string | null {
    const facade = this.#facade(ownerId);
    const observers = observationId ? facade.observations.get(observationId) : undefined;
    if (observationId && (!observers || !element.isConnected))
      throw new EChartsError('ChartElementRemoved', 'The chart container or observation was removed.');

    if (observers && !observers.hasSize)
      return null;

    if (this.#runtime!.getInstanceByDom(element))
      throw new EChartsError('ChartElementInUse', 'The element already owns an ECharts instance.');

    const chart = this.#runtime!.init(element, theme, init);
    const id = `chart:${++this.#nextChart}`;
    try {
      const instance = new ChartInstance(
        chart,
        observationId ?? undefined,
        observers,
        element,
        this.id,
        id,
        theme,
        facade.server,
        facade.resultLimit
      );
      if (exportReadiness)
        instance.exportReadiness = this.#managed(exportReadiness);

      facade.charts.set(id, instance);
      this.groups.track(id, instance);
    } catch (error) {
      chart.dispose();
      throw error;
    }

    return id;
  }

  setOption(
    ownerId: string,
    chartId: string,
    prepared: PreparedOptionTransport,
    update: Record<string, unknown>,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): void | Promise<void> {
    const chart = this.#chart(ownerId, chartId);
    const policy = { runtimeId: this.id, allowInlineJavaScript: this.#configuration?.allowInlineJavaScript };
    validateBindings(prepared.json, prepared.bindings, policy);
    if (!prepared.bindings.length) {
      chart.setOption(prepared.json, update, generation, revision, sequence);
      return;
    }

    const epoch = chart.commands.generation;
    const renderRevision = chart.commands.renderRevision;
    const releaseResource = chart.stability.resource();
    return hydrateBindings(
      prepared,
      policy,
      this.#references,
      this.importer,
      this.baseURI,
      () => {
        if (this.#chart(ownerId, chartId) !== chart)
          throw Error('Chart disposed during hydration.');

        chart.assertActive(epoch);
      },
      chart.hydrationSignal
    ).then(async hydrated => {
      try {
        chart.setOption(hydrated.value, update, generation, revision, sequence, hydrated.leases);
      } catch (error) {
        await Promise.all(hydrated.leases.map(l => l.dispose()));
        throw error;
      }
    }).catch(error => {
      if (!chart.stability.disposed && chart.commands.generation === epoch && chart.commands.renderRevision === renderRevision)
        chart.stability.fail(error);

      throw error;
    }).finally(releaseResource);
  }

  setTheme(
    ownerId: string,
    chartId: string,
    theme: string | null,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): void {
    this.#chart(ownerId, chartId).setTheme(theme, generation, revision, sequence);
  }

  subscribe(ownerId: string, chartId: string, id: string, name: string, query: unknown, callback: EventCallbacks, throttle = 0): void {
    this.#chart(ownerId, chartId).events.subscribe(id, name, query, this.#managed(callback), throttle);
  }

  unsubscribe(ownerId: string, chartId: string, id: string): void {
    this.#facades.get(ownerId)?.charts.get(chartId)?.events.unsubscribe(id);
  }

  dispatchAction(
    ownerId: string,
    chartId: string,
    payload: Record<string, unknown>,
    settings: boolean | Record<string, unknown> | null,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): void {
    this.#chart(ownerId, chartId).dispatchAction(payload, settings, generation, revision, sequence);
  }

  async dispatchBoundAction(
    owner: string,
    chartId: string,
    prepared: PreparedOptionTransport,
    settings: boolean | Record<string, unknown> | null,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): Promise<void> {
    const chart = this.#chart(owner, chartId);
    const epoch = chart.commands.generation;
    const result = await hydrateBindings(
      prepared,
      { runtimeId: this.id, allowInlineJavaScript: this.#configuration?.allowInlineJavaScript },
      this.#references,
      this.importer,
      this.baseURI,
      () => chart.assertActive(epoch),
      chart.hydrationSignal
    );
    try {
      chart.dispatchAction(result.value, settings, generation, revision, sequence);
      chart.retainActionBindings(result.leases);
    } catch (error) {
      await Promise.all(result.leases.map(l => l.dispose()));
      throw error;
    }
  }

  recreateChart(
    ownerId: string,
    chartId: string,
    init: Record<string, unknown>,
    theme: string | null,
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): void {
    const chart = this.#chart(ownerId, chartId);
    if (chart.observers && !chart.observers.hasSize)
      throw new EChartsError('ChartContainerNotReady', 'Cannot recreate a hidden or removed chart.');

    try {
      chart.recreate(effectiveTheme => this.#runtime!.init(chart.element!, effectiveTheme, init), generation, revision, sequence, theme);
      this.groups.track(chartId, chart);
    } catch (error) {
      if (chart.recreationFailed)
        this.disposeChart(ownerId, chartId);

      throw error;
    }
  }

  invokeMethod(
    ownerId: string,
    chartId: string,
    method: string,
    args: unknown[],
    generation?: number | null,
    revision?: number | null,
    sequence?: number | null
  ): unknown {
    if (method === 'isDisposed' && this.#nativeDisposed.get(chartId) === ownerId) {
      this.#facade(ownerId);
      return { value: true, bindings: [], leaseId: null };
    }

    const previousGroup = this.#chart(ownerId, chartId).native.group ?? '';
    const value = this.#chart(ownerId, chartId).invokeMethod(method, args, generation, revision, sequence);
    if (method === 'setGroup') {
      this.groups.changed(previousGroup);
      if (args[0] !== previousGroup)
        this.groups.changed(args[0] as string);
    }

    const result = extractSnapshot(
      value,
      this.#references,
      method === 'getDom' || method === 'getZr',
      ['convertToPixel', 'convertFromPixel', 'convertToLayout', 'getVisual'].includes(method),
      v => this.#registerReference(v)
    );
    return this.#result(ownerId, method, result);
  }

  // A Server reply over the hub limit would close the circuit: fail with a small message instead and release the result.
  #result(ownerId: string, operation: string, result: { json: unknown; bindings: unknown[]; leases: ReferenceLease[] }) {
    const limit = this.#facade(ownerId).resultLimit;
    if (limit != null) {
      const size = utf8Length(JSON.stringify({ value: result.json, bindings: result.bindings, leaseId: 'result:0000000000' }) ?? '');
      if (size + 512 > limit) {
        for (const lease of result.leases)
          void lease.dispose();

        throw new EChartsError(
          'ResultTooLarge',
          `${operation} returned about ${size} bytes, over the ${limit}-byte result limit of this Interactive Server circuit. `
          + 'Raise HubOptions.MaximumReceiveMessageSize and EChartsRuntimeOptions.MaximumServerResultSize together, or read less data.'
        );
      }
    }

    const leaseId = result.leases.length ? `result:${++this.#nextResult}` : null;
    if (leaseId)
      this.#results.set(leaseId, { owner: ownerId, leases: result.leases });

    return { value: result.json, bindings: result.bindings, leaseId };
  }

  async releaseResult(ownerId: string, leaseId: string): Promise<void> {
    const entry = this.#results.get(leaseId);
    if (!entry || entry.owner !== ownerId)
      return;

    this.#results.delete(leaseId);
    await Promise.all(entry.leases.map(lease => lease.dispose()));
  }

  async exportChart(
    owner: string,
    id: string,
    operation: string,
    method: string,
    prepared: PreparedOptionTransport,
    timeout: number
  ): Promise<unknown> {
    const chart = this.#chart(owner, id);
    const controller = new AbortController();
    validateTimeout(timeout);
    if (this.#exports.has(operation))
      throw new EChartsError('ExportIdentityConflict', 'Export operation identity is already active.');

    this.#exports.set(operation, { owner, chart: id, controller });
    const deadline = performance.now() + timeout;
    const timer = setTimeout(
      () => controller.abort(new EChartsError('StabilityTimeout', 'The chart stability timeout elapsed before capture.')),
      timeout
    );
    let leases: ReferenceLease[] = [];
    const checkpoints = new Map<ChartInstance, number>();
    const preparations = new Map<string, EventCallbacks>();
    let nextPreparation = 0;
    try {
      const hydrated = await hydrateBindings(
        prepared,
        { runtimeId: this.id, allowInlineJavaScript: this.#configuration?.allowInlineJavaScript },
        this.#references,
        this.importer,
        this.baseURI,
        () => chart.assertActive(),
        controller.signal
      );
      leases = hydrated.leases;
      const value = await stableCapture(
        chart,
        this.groups,
        method,
        hydrated.value.args as unknown[],
        Math.max(0, deadline - performance.now()),
        controller.signal,
        {
          runtime: this.#runtime,
          prepare: async members => {
            await waitForLifetime(
              Promise.all(members.map(async member => {
                if (!member.exportReadiness || checkpoints.has(member))
                  return;

                const identity = `${operation}:${++nextPreparation}`;
                const callback = member.exportReadiness;
                preparations.set(identity, callback);
                try {
                  const sequence = await callback.invokeMethodAsync('Prepare', identity, Math.max(0, deadline - performance.now()));
                  checkpoints.set(member, sequence as number);
                } finally {
                  preparations.delete(identity);
                }
              })),
              controller.signal
            );
          },
          validate: async members => {
            const valid = await waitForLifetime(
              Promise.all(members.map(async member => {
                if (!member.exportReadiness)
                  return !member.stability.disposed;

                const result = await member.exportReadiness.invokeMethodAsync('Validate', checkpoints.get(member));
                if (!result)
                  checkpoints.delete(member);

                return result === true;
              })),
              controller.signal
            );
            return valid.every(Boolean);
          },
        }
      );
      const result = extractSnapshot(
        value,
        this.#references,
        ['renderToCanvas', 'getRenderedCanvas'].includes(method),
        false,
        v => this.#registerReference(v)
      );
      return this.#result(owner, method, result);
    } finally {
      clearTimeout(timer);
      this.#exports.delete(operation);
      controller.abort(new EChartsError('ExportEnded', 'The export operation ended.'));
      for (const [identity, callback] of preparations)
        void callback.invokeMethodAsync('CancelPrepare', identity).catch(() => { /* Chart/circuit disposal also cancels the managed barrier. */ });

      await Promise.all(leases.map(l => l.dispose()));
    }
  }

  cancelExport(owner: string, operation: string): void {
    const entry = this.#exports.get(operation);
    if (entry?.owner === owner)
      entry.controller.abort(new EChartsError('ExportCancelled', 'Export was cancelled.'));
  }

  stabilityParticipant(native: ChartObject) {
    const participant = this.tryStabilityParticipant(native);
    if (!participant)
      throw new EChartsError('ChartDisposed', 'Stability participants require a live bridge-owned chart.');

    return participant;
  }

  tryStabilityParticipant(native: ChartObject) {
    for (const facade of this.#facades.values())
      for (const chart of facade.charts.values())
        if (chart.native === native)
          return Object.freeze({ begin: chart.stability.begin.bind(chart.stability) });

    return null;
  }

  async createNative(owner: string, kind: string, options: Record<string, unknown>, prepared: PreparedOptionTransport): Promise<unknown> {
    const facade = this.#facade(owner);
    const active = () => {
      if (this.#facade(owner) !== facade)
        throw Error('Facade disposed during native creation.');
    };
    const hydrated = await hydrateBindings(
      prepared,
      { runtimeId: this.id, allowInlineJavaScript: this.#configuration?.allowInlineJavaScript },
      this.#references,
      this.importer,
      this.baseURI,
      active,
      facade.lifetime.signal
    );
    try {
      if (kind === 'reference') {
        const handle = options as unknown as ReferenceHandle;
        if (handle.runtimeId !== this.id)
          throw Error('Reference runtime identity mismatch.');

        const source = handle.ownerId === this.#references.ownerId
          ? this.#references.acquire(handle)
          : this.#findChart(handle.ownerId).events.retain(handle);
        const lease = handle.ownerId === this.#references.ownerId ? source : this.#registerReference(source.value, () => source.dispose());
        const leaseId = `result:${++this.#nextResult}`;
        this.#results.set(leaseId, { owner, leases: [lease] });
        return { value: null, bindings: [{ path: [], kind: 'object', ...lease.handle }], leaseId };
      }

      const created = await createNativeValue(kind, options, hydrated.value.args as unknown[], this.importer, this.baseURI, facade.lifetime.signal);
      try {
        active();
      } catch (error) {
        created.release?.();
        throw error;
      }

      const cleanup = async () => {
        created.release?.();
        await Promise.all(hydrated.leases.map(l => l.dispose()));
      };
      const lease = this.#registerReference(created.value, created.release || hydrated.leases.length ? cleanup : undefined);
      const state = this.#mutations.state(created.value);
      if (state)
        this.#trackNativeTarget(created.value, lease, state);

      const leaseId = `result:${++this.#nextResult}`;
      this.#results.set(leaseId, { owner, leases: [lease] });
      return { value: null, bindings: [{ path: [], kind: 'object', ...lease.handle }], leaseId };
    } catch (error) {
      await Promise.all(hydrated.leases.map(l => l.dispose()));
      throw error;
    }
  }

  async invokeNative(owner: string, path: string, construct: boolean, prepared: PreparedOptionTransport): Promise<unknown> {
    const facade = this.#facade(owner);
    const active = () => {
      if (this.#facade(owner) !== facade)
        throw Error('Facade disposed during native invocation.');
    };
    const hydrated = await hydrateBindings(
      prepared,
      { runtimeId: this.id, allowInlineJavaScript: this.#configuration?.allowInlineJavaScript },
      this.#references,
      this.importer,
      this.baseURI,
      active,
      facade.lifetime.signal
    );
    let transferred = false;
    try {
      active();
      const args = hydrated.value.args as unknown[];
      const beforeMutation = this.#mutations.prepare(path, args);
      const nativeResult = construct
        ? { value: invokeNativeGraphic(this.#runtime!, path, hydrated.value.args as unknown[], true), disposedCharts: [] }
        : this.#invokeOwnedNative(owner, path, hydrated.value.args as unknown[]);
      const value = nativeResult.value;
      let dependencies = hydrated.leases;
      if (await this.#registrations.adopt(path, hydrated.value.args as unknown[], dependencies)) {
        dependencies = [];
        transferred = true;
      } else if (await this.#mutations.adopt(beforeMutation, args, prepared, dependencies, (t, l, s) => this.#trackNativeTarget(t, l, s))) {
        dependencies = [];
        transferred = true;
      }

      let dependents = 0;
      const result = extractSnapshot(value, this.#references, construct, true, v => {
        if (!dependencies.length)
          return this.#registerReference(v);

        dependents++;
        return this.#registerReference(v, async () => {
          if (--dependents === 0)
            await Promise.all(dependencies.map(l => l.dispose()));
        });
      });
      if (!result.leases.length)
        await Promise.all(dependencies.map(l => l.dispose()));

      return { ...this.#result(owner, path, result), disposedCharts: nativeResult.disposedCharts };
    } catch (error) {
      if (!transferred)
        await Promise.all(hydrated.leases.map(l => l.dispose()));

      throw error;
    }
  }

  /** Selected page identity for synchronous browser callback modules and full native graphic/custom-renderItem API. */
  getECharts(): EChartsRuntimeObject {
    if (!this.#runtime)
      throw Error('Initialize ECharts before using browser helpers.');

    return this.#runtime;
  }

  /** Page-wide native accounting for diagnostics; independent of any one facade's lifetime. */
  referenceStatistics() {
    return Object.freeze({ entries: this.#references.count, leases: this.#references.leaseCount, results: this.#results.size });
  }

  /** Page-wide owned resources and bridge traffic for diagnostics and resource gates; not a supported consumer API. */
  resourceStatistics() {
    let charts = 0;
    let observations = 0;
    let subscriptions = 0;
    let deliveries = 0;
    let eventLeases = 0;
    for (const facade of this.#facades.values()) {
      charts += facade.charts.size;
      observations += facade.observations.size;
      for (const chart of facade.charts.values()) {
        subscriptions += chart.events.size;
        deliveries += chart.events.pendingDeliveries;
        eventLeases += chart.events.leaseCount;
      }
    }

    return Object.freeze({
      facades: this.#facades.size,
      charts,
      observations,
      subscriptions,
      deliveries,
      eventLeases,
      exports: this.#exports.size,
      results: this.#results.size,
      references: this.#references.count,
      leases: this.#references.leaseCount,
      groupMembers: this.groups.size,
      toBrowser: Object.fromEntries(this.#toBrowser),
      toDotNet: Object.fromEntries(this.#toDotNet),
    });
  }

  bridged(name: string): this {
    this.#toBrowser.set(name, (this.#toBrowser.get(name) ?? 0) + 1);
    return this;
  }

  #managed<T extends EventCallbacks>(callback: T): T {
    const counts = this.#toDotNet;
    return {
      invokeMethodAsync(method: string, ...args: unknown[]) {
        counts.set(method, (counts.get(method) ?? 0) + 1);
        return callback.invokeMethodAsync(method, ...args);
      },
    } as T;
  }

  #registerReference(value: object, cleanup?: () => Promise<void>): ReferenceLease {
    // Snapshot aliases retain the original entry, including its hidden native dependencies.
    const handle = this.#referenceIdentities.get(value);
    if (handle && !cleanup) {
      try {
        return this.#references.acquire(handle);
      } catch { /* Last lease expired; create a new token. */ }
    }

    const lease = cleanup ? this.#references.register(value, 'owned', cleanup) : this.#references.register(value);
    this.#referenceIdentities.set(value, lease.handle);
    return lease;
  }

  #ownerOfNative(native: unknown): { ownerId: string; chartId: string; chart: ChartInstance } | undefined {
    for (const [ownerId, facade] of this.#facades)
      if (facade.active)
        for (const [chartId, chart] of facade.charts)
          if (chart.native === native)
            return { ownerId, chartId, chart };
  }

  #trackNativeTarget(target: object, lease: ReferenceLease, state: GraphicMutationState): void {
    const zr = (target as { __zr?: unknown }).__zr;
    if (!zr)
      return;

    for (const facade of this.#facades.values())
      if (facade.active)
        for (const chart of facade.charts.values())
          if ((chart.native as unknown as { getZr?(): unknown }).getZr?.() === zr)
            chart.retainNativeTarget(target, lease, () => state.prune(), state.cancelAnimations);
  }

  #invokeOwnedNative(owner: string, path: string, args: unknown[]): { value: unknown; disposedCharts: { ownerId: string; chartId: string }[] } {
    const call = () => invokeNativeGraphic(this.#runtime!, path, args, false);
    if (path === 'init') {
      const element = args[0] as HTMLElement;
      const existing = this.#runtime!.getInstanceByDom(element);
      if (existing)
        return { value: existing, disposedCharts: [] };

      const id = this.createChart(owner, element, args[1] as ThemeValue ?? null, args[2] as Record<string, unknown> ?? {});
      return { value: this.#chart(owner, id!).native, disposedCharts: [] };
    }

    if (path === 'dispose') {
      const input = args[0];
      const native = typeof input === 'string'
        ? (this.#runtime! as unknown as { getInstanceById(id: string): unknown }).getInstanceById(input)
        : this.#ownerOfNative(input)?.chart.native
        ?? (input && typeof (input as { getDom?: unknown }).getDom === 'function' ? input : this.#runtime!.getInstanceByDom(input as HTMLElement));
      const owned = this.#ownerOfNative(native);
      if (!owned)
        return { value: call(), disposedCharts: [] };

      const observers = owned.chart.observers;
      this.disposeChart(owned.ownerId, owned.chartId);
      this.#nativeDisposed.set(owned.chartId, owned.ownerId);
      observers?.browserDisposed();
      return { value: undefined, disposedCharts: [{ ownerId: owned.ownerId, chartId: owned.chartId }] };
    }

    if (path === 'connect') {
      const previous = Array.isArray(args[0]) ? args[0].map(c => this.#ownerOfNative(c)?.chart.native.group ?? '') : [];
      const value = call();
      for (const group of new Set(previous))
        this.groups.changed(group);

      this.groups.connect(value as string);
      return { value, disposedCharts: [] };
    }

    if (path === 'disconnect' || path === 'disConnect') {
      const value = call();
      this.groups.disconnect(args[0] as string);
      return { value, disposedCharts: [] };
    }

    return { value: call(), disposedCharts: [] };
  }

  disposeChart(ownerId: string, chartId: string): void {
    const facade = this.#facades.get(ownerId);
    const chart = facade?.charts.get(chartId);
    if (!chart)
      return;

    for (const entry of this.#exports.values())
      if (entry.owner === ownerId && entry.chart === chartId)
        entry.controller.abort(new EChartsError('ChartDisposed', 'Chart disposed during export.'));

    facade!.charts.delete(chartId);
    this.groups.remove(chartId);
    try {
      chart.dispose();
    } finally {
      if (chart.observationId)
        this.releaseObservation(ownerId, chart.observationId);
    }
  }

  releaseFacade(ownerId: string): void {
    const facade = this.#facades.get(ownerId);
    if (!facade)
      return;

    facade.active = false;
    for (const entry of this.#exports.values())
      if (entry.owner === ownerId)
        entry.controller.abort(new EChartsError('FacadeDisposed', 'Facade disposed during export.'));

    facade.lifetime.abort(Error('Facade disposed during native work.'));
    const failures: unknown[] = [];
    for (const id of [...facade.charts.keys()]) {
      const chart = facade.charts.get(id)!;
      facade.charts.delete(id);
      this.groups.remove(id);
      try {
        chart.dispose();
      } catch (error) {
        failures.push(error);
      }
    }

    for (const observation of facade.observations.values())
      observation.dispose();

    facade.observations.clear();
    for (const [id, entry] of this.#results)
      if (entry.owner === ownerId) {
        this.#results.delete(id);
        for (const lease of entry.leases)
          void lease.dispose();
      }

    this.#facades.delete(ownerId);
    for (const [id, owner] of this.#nativeDisposed)
      if (owner === ownerId)
        this.#nativeDisposed.delete(id);

    if (failures.length)
      throw new AggregateError(failures, 'Failed to dispose facade charts.');
  }

  #facade(ownerId: string): Facade {
    const facade = this.#facades.get(ownerId);
    if (!facade?.active || !facade.ready)
      throw new EChartsError('FacadeDisposed', 'The facade is not active and initialized.');

    return facade;
  }

  invokeGlobal(ownerId: string, method: string, args: unknown[], numbers: readonly number[] = []): unknown {
    // A released facade must not change the page's shared maps, themes or locales.
    this.#facade(ownerId);
    const value = invokeGlobal(this.#runtime!, method, args, numbers);
    return this.#result(ownerId, method, { json: value, bindings: [], leases: [] }).value;
  }

  connect(ownerId: string, value: string | string[]): string {
    this.#facade(ownerId);
    const runtime = this.#runtime! as unknown as { connect(v: string | ChartObject[]): string };
    const charts = typeof value === 'string' ? undefined : value.map(id => this.#findChart(id));
    const old = charts?.map(c => c.native.group ?? '') ?? [];
    const group = runtime.connect(charts ? charts.map(c => c.native) : value as string);
    for (const previous of new Set(old))
      this.groups.changed(previous);

    this.groups.connect(group);
    return group;
  }

  disconnect(ownerId: string, group: string): void {
    this.#facade(ownerId);
    (this.#runtime! as unknown as { disconnect(group: string): void }).disconnect(group);
    this.groups.disconnect(group);
  }

  groupSnapshot(ownerId: string, group: string) {
    this.#facade(ownerId);
    return this.groups.snapshot(group);
  }

  findInstance(ownerId: string, kind: 'id' | 'dom', value: string | HTMLElement): string | null {
    this.#facade(ownerId);
    const native = kind === 'dom'
      ? this.#runtime!.getInstanceByDom(value as HTMLElement)
      : (this.#runtime! as unknown as { getInstanceById(id: string): ChartObject | undefined }).getInstanceById(value as string);
    return [...this.#facade(ownerId).charts].find(([, c]) => c.native === native)?.[0] ?? null;
  }

  #findChart(id: string): ChartInstance {
    for (const facade of this.#facades.values()) {
      const chart = facade.charts.get(id);
      if (facade.active && chart && !chart.native.isDisposed?.())
        return chart;
    }

    throw new EChartsError('ChartDisposed', 'Group member is unavailable on this page runtime.');
  }

  #chart(ownerId: string, chartId: string): ChartInstance {
    const chart = this.#facade(ownerId).charts.get(chartId);
    if (!chart)
      throw new EChartsError('ChartDisposed', 'The chart is disposed, unknown, or belongs to another facade.');

    return chart;
  }
}
