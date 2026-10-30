import type { ReferenceHandle } from './binding-contracts.ts';

export type ReferenceOwnership = 'borrowed' | 'owned';

interface Entry {
  readonly value: object;
  readonly release?: () => void | Promise<void>;
  leases: number;
  retentions?: Set<() => Promise<void>>;
}

/** Independent consumer retention; disposal is idempotent, including failures. */
export interface ReferenceLease {
  readonly handle: ReferenceHandle;
  readonly value: object;
  retain(signal?: AbortSignal): ReferenceLease;
  dispose(): Promise<void>;
}

/** Page/runtime-owned accounting. Disposing one facade's leases does not dispose this shared registry. */
export class ReferenceRegistry {
  readonly #entries = new Map<string, Entry>();
  #nextToken = 0;
  #leaseCount = 0;

  constructor(readonly runtimeId: string, readonly ownerId: string) {
    if (!validIdentity(runtimeId) || !validIdentity(ownerId))
      throw new Error('Missing runtime or owner identity.');

    Object.freeze(this);
  }

  get count(): number {
    return this.#entries.size;
  }

  get leaseCount(): number {
    return this.#leaseCount;
  }

  /** Registers a native object once. Borrowed objects are never disposed, including objects with a dispose method. */
  register(value: object, ownership: ReferenceOwnership = 'borrowed', release?: () => void | Promise<void>): ReferenceLease {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null)
      throw new Error('Expected native object reference.');

    if (ownership !== 'borrowed' && ownership !== 'owned')
      throw new Error('Invalid reference ownership.');

    if (ownership === 'owned' && typeof release !== 'function')
      throw new Error('Owned references require a release operation.');

    if (ownership === 'borrowed' && release !== undefined)
      throw new Error('Borrowed references cannot supply a release operation.');

    const handle = Object.freeze({ runtimeId: this.runtimeId, ownerId: this.ownerId, token: `object:${++this.#nextToken}` });
    this.#entries.set(handle.token, { value, release, leases: 1 });
    this.#leaseCount++;
    return this.#lease(handle);
  }

  /** Validates all identities and cancellation before changing lease counts. Acquisition has no asynchronous gap. */
  acquire(handle: ReferenceHandle, signal?: AbortSignal): ReferenceLease {
    signal?.throwIfAborted();
    const entry = this.#entry(handle);
    const lease = this.#lease(Object.freeze({ runtimeId: handle.runtimeId, ownerId: handle.ownerId, token: handle.token }));
    entry.leases++;
    this.#leaseCount++;
    return lease;
  }

  /** Attach dependent retention cleanup without taking ownership of the borrowed native object itself. */
  onLastRelease(handle: ReferenceHandle, cleanup: () => Promise<void>): void {
    const entry = this.#entry(handle);
    (entry.retentions ??= new Set()).add(cleanup);
  }

  #entry(handle: ReferenceHandle): Entry {
    if (handle.runtimeId !== this.runtimeId)
      throw new Error('Reference runtime identity mismatch.');

    if (handle.ownerId !== this.ownerId)
      throw new Error('Reference owner identity mismatch.');

    const entry = this.#entries.get(handle.token);
    if (!entry)
      throw new Error('Unknown or disposed reference token.');

    return entry;
  }

  #lease(handle: ReferenceHandle): ReferenceLease {
    const registry = this;
    let disposed = false;
    let release: Promise<void> | undefined;
    const ensureActive = (): void => {
      if (disposed)
        throw new Error('Reference lease is disposed.');
    };
    return Object.freeze({
      handle,
      get value(): object {
        ensureActive();
        return registry.#entry(handle).value;
      },
      retain(signal?: AbortSignal): ReferenceLease {
        ensureActive();
        return registry.acquire(handle, signal);
      },
      dispose(): Promise<void> {
        if (!disposed) {
          disposed = true;

          // Promise.withResolvers is ES2024 (Safari 17.4); assign the pending release before a reentrant cleanup can ask for it.
          let resolve!: () => void;
          let reject!: (error: unknown) => void;
          release = new Promise<void>((done, fail) => {
            resolve = done;
            reject = fail;
          });
          void registry.#release(handle).then(resolve, reject);
        }

        return release!;
      },
    });
  }

  async #release(handle: ReferenceHandle): Promise<void> {
    const entry = this.#entry(handle);
    this.#leaseCount--;
    if (--entry.leases !== 0)
      return;

    this.#entries.delete(handle.token);

    // Delete before invoking user cleanup, including throwing or asynchronous cleanup.
    const invoke = (cleanup: () => void | Promise<void>): Promise<void> => {
      try {
        return Promise.resolve(cleanup());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const results = await Promise.allSettled([...(entry.retentions ?? [])].map(invoke).concat(entry.release ? [invoke(entry.release)] : []));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason);
    if (failures.length === 1)
      throw failures[0];

    if (failures.length)
      throw new AggregateError(failures, 'Native reference retention cleanup failed.');
  }
}

function validIdentity(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
