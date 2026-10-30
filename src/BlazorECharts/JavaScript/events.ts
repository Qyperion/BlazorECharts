import type { ChartObject } from './runtime-provider.ts';
import { ReferenceRegistry, type ReferenceLease } from './reference-registry.ts';
import type { JsBindingPath, ReferenceHandle } from './binding-contracts.ts';
import { EChartsError } from './errors.ts';
import { connectionState, isDisconnection, utf8Length } from './connection-state.ts';

export interface EventCallbacks {
  invokeMethodAsync(method: string, ...args: unknown[]): Promise<unknown>;
}

interface Subscription {
  name: string;
  query: unknown;
  callback: EventCallbacks;
  throttle: number;
  last: number;
  listener?: (payload?: unknown) => void;
}

const elementEvents = new Set(['click', 'dblclick', 'mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout', 'globalout', 'contextmenu']);

/** Browser-native objects stay in the existing reference protocol, never JSON.stringify(event). */
export class ChartEvents {
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #pending = new Set<ReferenceLease>();

  // Deliveries sent and not yet settled. Those sent before an outage is detected never settle.
  readonly #deliveries = new Set<object>();

  readonly #references: ReferenceRegistry;
  readonly #stopFollowing?: () => void;
  #epoch = 0;
  #active = true;
  #reportedDisconnected = false;

  /** `resultLimit` is the Interactive Server message limit, in bytes, for one delivery; null sends any size. */
  constructor(
    private native: ChartObject,
    runtimeId: string,
    readonly chartId: string,
    readonly element?: HTMLElement,
    readonly server = false,
    readonly resultLimit: number | null = null
  ) {
    this.#references = new ReferenceRegistry(runtimeId, chartId);

    // Start following the connection now: an outage can begin before the first event.
    if (server)
      this.#stopFollowing = connectionState().onDisconnected(() => this.#abandon());
  }

  get size(): number {
    return this.#subscriptions.size;
  }

  get pendingDeliveries(): number {
    return this.#deliveries.size;
  }

  get leaseCount(): number {
    return this.#references.leaseCount;
  }

  /** Retain during an awaited delivery, before its temporary borrowed handles expire. */
  retain(handle: ReferenceHandle): ReferenceLease {
    return this.#references.acquire(handle);
  }

  subscribe(id: string, name: string, query: unknown, callback: EventCallbacks, throttle = 0): void {
    if (!this.#active)
      throw new EChartsError('ChartDisposed', 'The chart is disposed.');

    if (this.#subscriptions.has(id))
      throw new EChartsError('SubscriptionConflict', 'Subscription identity is already active.');

    if (!Number.isFinite(throttle) || throttle < 0)
      throw new EChartsError('SubscriptionInvalid', 'Throttle must be a finite nonnegative duration.');

    const entry = { name, query, callback, throttle, last: -Infinity };
    this.#subscriptions.set(id, entry);
    try {
      this.#bind(id, entry);
    } catch (error) {
      this.#subscriptions.delete(id);
      throw error;
    }
  }

  #bind(id: string, entry: Subscription): void {
    if (!this.native.on || !this.native.off)
      throw new EChartsError('ChartCapabilityMissing', 'The native chart lacks on/off.');

    const epoch = this.#epoch;
    entry.listener = payload => {
      if (!this.#active || epoch !== this.#epoch || this.#subscriptions.get(id) !== entry)
        return;

      // During a Server outage a delivery could never complete: send nothing and report the outage once.
      if (this.server && !connectionState().connected) {
        this.#abandon();
        this.#disconnected(entry.name);
        return;
      }

      this.#reportedDisconnected = false;
      const now = performance.now();
      if (entry.throttle && now - entry.last < entry.throttle)
        return;

      entry.last = now;

      // Defer .NET invocation outside native dispatchAction and the managed command slot.
      const leases: ReferenceLease[] = [];
      const references: unknown[] = [];
      const ancestors = new Set<object>();
      const encode = (value: unknown, path: JsBindingPath): unknown => {
        if (value == null || typeof value === 'string' || typeof value === 'boolean')
          return value ?? null;

        if (typeof value === 'number')
          return Number.isFinite(value) ? value : null;

        if (typeof value === 'undefined')
          return null;

        if (typeof value !== 'object' && typeof value !== 'function')
          return null;

        const proto = Object.getPrototypeOf(value);

        // A LinearGradient or RadialGradient color is plain data; patterns and other instances stay browser references.
        const gradient = (value as { type?: unknown }).type === 'linear' || (value as { type?: unknown }).type === 'radial'
          ? Array.isArray((value as { colorStops?: unknown }).colorStops)
          : false;
        if ((elementEvents.has(entry.name) && path.length === 1 && path[0] === 'event')
          || ancestors.has(value)
          || (proto !== Object.prototype && proto !== null && !Array.isArray(value) && !gradient)) {
          const lease = this.#references.register(value, 'borrowed');
          leases.push(lease);
          this.#pending.add(lease);
          references.push({ path, reference: lease.handle });
          return null;
        }

        ancestors.add(value);
        try {
          if (Array.isArray(value))
            return value.map((item, i) => encode(item, [...path, i]));

          const result: Record<string, unknown> = Object.create(null);
          for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (!descriptor.enumerable || !('value' in descriptor) || typeof descriptor.value === 'undefined')
              continue;

            result[key] = encode(descriptor.value, [...path, key]);
          }

          return result;
        } finally {
          ancestors.delete(value);
        }
      };
      const release = () => {
        for (const lease of leases) {
          this.#pending.delete(lease);
          void lease.dispose();
        }
      };
      let json: unknown;
      try {
        json = encode(payload ?? {}, []);
      } catch (error) {
        release();
        this.#error(id, entry.name, error);
        return;
      }

      // A Server message over the hub limit would close the circuit: report it instead of sending it.
      if (this.resultLimit != null) {
        const size = utf8Length(JSON.stringify([id, epoch, json, references]) ?? '') + 512;
        if (size > this.resultLimit) {
          release();
          this.#tooLarge(id, entry.name, size);
          return;
        }
      }

      const delivery = {};
      this.#deliveries.add(delivery);
      void Promise.resolve()
        .then(async () => {
          if (!this.#active || epoch !== this.#epoch || this.#subscriptions.get(id) !== entry)
            return;

          await entry.callback.invokeMethodAsync('Deliver', id, epoch, json, references);
        })
        .catch(error => {
          if (!this.#active || epoch !== this.#epoch || this.#subscriptions.get(id) !== entry)
            return;

          if (this.server && isDisconnection(true, error))
            this.#disconnected(entry.name);
          else
            this.#error(id, entry.name, error);
        })
        .finally(() => {
          this.#deliveries.delete(delivery);
          release();
        });
    };
    if (entry.query == null)
      this.native.on(entry.name, entry.listener);
    else
      this.native.on(entry.name, entry.query, entry.listener);
  }

  // An outage was detected: deliveries sent before it never settle, so their browser references are released now.
  #abandon(): void {
    this.#deliveries.clear();
    for (const lease of this.#pending)
      void lease.dispose();

    this.#pending.clear();
  }

  #tooLarge(id: string, name: string, size: number): void {
    this.element?.dispatchEvent?.(new CustomEvent('blazorecharts:error', {
      bubbles: true,
      detail: {
        code: 'EventTooLarge',
        message: `${name} event of about ${size} bytes exceeds the ${this.resultLimit}-byte message limit of this Interactive Server circuit and was not delivered. `
          + 'Filter or throttle the event, or raise HubOptions.MaximumReceiveMessageSize and EChartsRuntimeOptions.MaximumServerResultSize together.',
        operation: `event:${name}`,
        subscriptionId: id,
        upstreamVersion: '6.1.0',
      },
    }));
  }

  #disconnected(name: string): void {
    if (this.#reportedDisconnected)
      return;

    this.#reportedDisconnected = true;
    this.element?.dispatchEvent?.(new CustomEvent('blazorecharts:error', {
      bubbles: true,
      detail: {
        code: 'CircuitDisconnected',
        message: 'The Server circuit is disconnected; events are not delivered until reconnection.',
        operation: `event:${name}`,
        upstreamVersion: '6.1.0',
      },
    }));
  }

  #error(id: string, name: string, error: unknown): void {
    this.element?.dispatchEvent?.(new CustomEvent('blazorecharts:error', {
      bubbles: true,
      detail: { code: 'EventHandlerFailed', message: String(error), operation: `event:${name}`, subscriptionId: id, upstreamVersion: '6.1.0' },
    }));
  }

  unsubscribe(id: string): void {
    const entry = this.#subscriptions.get(id);
    if (!entry)
      return;

    this.#subscriptions.delete(id);
    if (entry.listener)
      this.native.off?.(entry.name, entry.listener);
  }

  detach(): void {
    this.#epoch++;
    for (const entry of this.#subscriptions.values())
      if (entry.listener)
        this.native.off?.(entry.name, entry.listener);

    for (const lease of this.#pending)
      void lease.dispose();

    this.#pending.clear();
  }

  rebind(native: ChartObject): void {
    this.native = native;
    for (const [id, entry] of this.#subscriptions)
      this.#bind(id, entry);
  }

  dispose(): void {
    if (!this.#active)
      return;

    this.#active = false;
    this.#stopFollowing?.();
    this.detach();
    this.#deliveries.clear();
    this.#subscriptions.clear();
  }
}
