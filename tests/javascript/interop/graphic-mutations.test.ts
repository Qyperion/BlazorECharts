import { describe, expect, it } from 'vitest';
import { GraphicMutations } from '../../../src/BlazorECharts/JavaScript/graphic-mutations.ts';
import { ReferenceRegistry, type ReferenceLease } from '../../../src/BlazorECharts/JavaScript/reference-registry.ts';
import type { JsBinding } from '../../../src/BlazorECharts/JavaScript/binding-contracts.ts';

class Animator {
  #done: (() => void)[] = [];
  #aborted: (() => void)[] = [];

  done(callback: () => void) {
    this.#done.push(callback);
    return this;
  }

  aborted(callback: () => void) {
    this.#aborted.push(callback);
    return this;
  }

  finish() {
    for (const c of this.#done)
      c();
  }

  abort() {
    for (const c of this.#aborted)
      c();
  }
}

// One updateProps call: the page acquires a lease per object binding, as page-runtime does before adopt().
function mutation(attached = false) {
  const registry = new ReferenceRegistry('page', 'owner');
  const mutations = new GraphicMutations(registry);
  const target: { style?: object; animators: Animator[]; __zr?: object } = { animators: [], ...(attached ? { __zr: {} } : {}) };
  const consumer = { target: registry.register(target), style: registry.register({ fill: 'red' }), done: registry.register(() => {}) };
  const binding = (lease: ReferenceLease, path: (string | number)[]): JsBinding => ({ kind: 'object', path, ...lease.handle });
  const call = async (animate: boolean) => {
    const before = mutations.prepare('graphic.updateProps', [target]);
    const leases = [consumer.target, consumer.style, consumer.done].map(l => registry.acquire(l.handle));
    target.style = consumer.style.value;
    const animator = new Animator();
    if (animate)
      target.animators.push(animator);

    const prepared = {
      json: { args: [null, { style: null }, null] },
      bindings: [binding(consumer.target, ['args', 0]), binding(consumer.style, ['args', 1, 'style']), binding(consumer.done, ['args', 2])],
    };
    const tracked: object[] = [];
    expect(await mutations.adopt(before, [target, { style: target.style }, null], prepared, leases, t => tracked.push(t))).toBe(true);
    expect(tracked).toEqual([target]);
    return animator;
  };

  // Leases held beyond the consumer's own three registrations.
  const held = () => registry.leaseCount - 3;
  return { registry, mutations, target, consumer, call, held };
}

describe('graphic mutation ownership', () => {
  it('GraphicMutations_OnlyInitAndUpdatePropsArePrepared', () => {
    // Arrange
    const mutations = new GraphicMutations(new ReferenceRegistry('page', 'owner'));
    const animator = new Animator();

    // Act & Assert
    expect(mutations.prepare('graphic.updateProps', [{ animators: [animator] }])).toEqual([animator]);
    expect(mutations.prepare('graphic.initProps', [{}])).toEqual([]);
    expect(mutations.prepare('graphic.removeElement', [{}])).toBeUndefined();
  });

  it('GraphicMutations_TargetWithoutLiveReferenceIsRejected', async () => {
    // Arrange
    const mutations = new GraphicMutations(new ReferenceRegistry('page', 'owner'));

    // Act & Assert
    await expect(mutations.adopt([], [{}], { json: {}, bindings: [] }, [], () => {})).rejects.toThrow(/explicit live native reference/);
  });

  it('GraphicMutations_PropertyStaysWhileReachableAndRepeatedLeaseIsReleased', async () => {
    // Arrange
    const f = mutation();

    // Act
    await f.call(false);

    // Assert
    expect(f.held()).toBe(1);

    // Act
    await f.call(false);

    // Assert
    expect(f.held()).toBe(1);

    // Act
    delete f.target.style;
    f.mutations.state(f.target)!.prune();
    await Promise.resolve();

    // Assert
    expect(f.held()).toBe(0);
  });

  it('GraphicMutations_CallbackLivesUntilEveryNewAnimatorEnds', async () => {
    // Arrange
    const f = mutation();

    // Act
    const first = await f.call(true);

    // Assert
    expect(f.held()).toBe(2);

    // Act
    first.finish();
    await Promise.resolve();

    // Assert
    expect(f.held()).toBe(1);

    // Act
    const second = await f.call(true);

    // Assert
    expect(f.held()).toBe(2);

    // Act
    second.abort();
    await Promise.resolve();

    // Assert
    expect(f.held()).toBe(1);
  });

  it('GraphicMutations_WithoutNewAnimatorCallbackIsReleasedAtOnce', async () => {
    // Arrange
    const f = mutation();

    // Act
    await f.call(false);

    // Assert
    expect(f.held()).toBe(1);
  });

  it('GraphicMutations_AttachedTargetIsPinnedUntilTheAnimationEnds', async () => {
    // Arrange
    const f = mutation(true);

    // Act
    const animator = await f.call(true);

    // Assert
    expect(f.held()).toBe(3);

    // Act
    animator.finish();
    await Promise.resolve();

    // Assert
    expect(f.held()).toBe(1);
  });

  it('GraphicMutations_LastTargetReleaseDisposesStateAndProperties', async () => {
    // Arrange
    const f = mutation();

    // Act
    await f.call(true);

    // Assert
    expect(f.held()).toBe(2);

    // Act
    const state = f.mutations.state(f.target)!;
    await f.consumer.target.dispose();

    // Assert
    expect(state.closed).toBe(true);
    expect(f.mutations.state(f.target)).toBeUndefined();
    expect(f.registry.leaseCount).toBe(2);
  });
});
