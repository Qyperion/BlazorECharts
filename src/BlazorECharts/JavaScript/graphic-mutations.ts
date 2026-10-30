import type { PreparedOptionTransport } from './binding-contracts.ts';
import type { ReferenceLease, ReferenceRegistry } from './reference-registry.ts';

interface Animator {
  done(callback: () => void): unknown;
  aborted(callback: () => void): unknown;
}

interface Target {
  __zr?: unknown;
  animators?: Animator[];
}

const dispose = (leases: ReferenceLease[]) => Promise.all(leases.map(l => l.dispose())).then(() => undefined);
const key = (lease: ReferenceLease) => `${lease.handle.ownerId}/${lease.handle.token}`;

export class GraphicMutationState {
  readonly #properties = new Map<string, ReferenceLease>();
  readonly #animations = new Set<() => void>();
  closed = false;

  constructor(readonly target: object, registry: ReferenceRegistry, lease: ReferenceLease) {
    registry.onLastRelease(lease.handle, () => this.dispose());
  }

  async properties(leases: ReferenceLease[]): Promise<void> {
    for (const lease of leases) {
      const k = key(lease);
      if (this.#properties.has(k))
        await lease.dispose();
      else
        this.#properties.set(k, lease);
    }

    this.prune();
  }

  prune(): void {
    const used = graph(this.target, true);
    for (const [key, lease] of this.#properties) {
      const reachable = [...graph(lease.value, true)].some(value => used.has(value));
      if (!reachable) {
        this.#properties.delete(key);
        void lease.dispose();
      }
    }
  }

  animate(animators: Animator[], leases: ReferenceLease[], target: ReferenceLease): void {
    // Unattached animations depend on the consumer's target handle. Attached animations
    // independently pin it until completion, abort, target removal or chart cleanup.
    const pin = (this.target as Target).__zr ? target.retain() : undefined;
    const pending = new Set(animators);
    let finished = false;
    const finish = () => {
      if (finished)
        return;

      finished = true;
      this.#animations.delete(finish);
      void dispose([...leases, ...(pin ? [pin] : [])]);
      this.prune();
    };
    this.#animations.add(finish);
    for (const animator of animators) {
      const end = () => {
        pending.delete(animator);
        if (!pending.size)
          finish();
      };
      animator.done(end);
      animator.aborted(end);
    }
  }

  cancelAnimations = (): void => {
    for (const end of [...this.#animations])
      end();
  };

  async dispose(): Promise<void> {
    if (this.closed)
      return;

    this.closed = true;
    this.cancelAnimations();
    const properties = [...this.#properties.values()];
    this.#properties.clear();
    await dispose(properties);
  }
}

/** Pinned initProps/updateProps store props on the target and callbacks on native animators. */
export class GraphicMutations {
  readonly #states = new WeakMap<object, GraphicMutationState>();

  constructor(readonly registry: ReferenceRegistry) {}

  state(target: object): GraphicMutationState | undefined {
    const state = this.#states.get(target);
    return state?.closed ? undefined : state;
  }

  prepare(path: string, args: unknown[]): Animator[] | undefined {
    return ['graphic.initProps', 'graphic.updateProps'].includes(path) ? [...((args[0] as Target)?.animators ?? [])] : undefined;
  }

  async adopt(
    before: Animator[] | undefined,
    args: unknown[],
    prepared: PreparedOptionTransport,
    leases: ReferenceLease[],
    track: (target: object, lease: ReferenceLease, state: GraphicMutationState) => void
  ): Promise<boolean> {
    if (!before)
      return false;

    // Read lease values before any of them is released: a disposed lease no longer exposes its value.
    const target = args[0] as object;
    const targets = leases.filter(l => l.value === target);
    const targetLease = targets[0];
    if (!targetLease)
      throw Error('Graphic mutation target requires an explicit live native reference.');

    let state = this.state(target);
    if (!state) {
      state = new GraphicMutationState(target, this.registry, targetLease);
      this.#states.set(target, state);
    }

    const propertyTokens = new Set(prepared.bindings
      .filter(b => b.kind === 'object' && b.path[0] === 'args' && b.path[1] === 1)
      .map(b => `${(b as { ownerId: string }).ownerId}/${b.token}`));
    const props = leases.filter(l => l.value !== target && propertyTokens.has(key(l)));
    const future = leases.filter(l => l.value !== target && !propertyTokens.has(key(l)));
    await state.properties(props);
    const animators = ((target as Target).animators ?? []).filter(a => !before.includes(a));
    if (animators.length && future.length)
      state.animate(animators, future, targetLease);
    else
      await dispose(future);

    track(target, targetLease, state);
    await dispose(targets);
    return true;
  }
}

// Inspect own data without invoking accessors or following ZRender ownership graphs.
function graph(root: object, inspectRoot = false): Set<object> {
  const values = new Set<object>();

  function visit(value: unknown, root = false): void {
    if (value === null || !['object', 'function'].includes(typeof value) || values.has(value as object))
      return;

    values.add(value as object);
    if (!root && (typeof value === 'function' || (typeof Node !== 'undefined' && value instanceof Node)))
      return;

    for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(value)))
      if (!['__zr', 'parent', '__hostTarget', 'animators'].includes(name) && 'value' in d)
        visit(d.value);
  }

  visit(root, inspectRoot);
  return values;
}
