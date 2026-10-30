import { describe, expect, it } from 'vitest';
import { ReferenceRegistry } from '../../../src/BlazorECharts/JavaScript/reference-registry.ts';

describe('page-owned reference registry', () => {
  it('borrowed references survive chart disposal without disposing the consumer object', async () => {
    // Arrange
    let disposals = 0;
    const value = { dispose: () => { disposals++; } };
    const registry = new ReferenceRegistry('page', 'owner');
    const consumer = registry.register(value);

    // Act
    const chart = registry.acquire(consumer.handle);

    // Assert
    expect(chart.value).toBe(value);

    // Act
    await chart.dispose();
    await chart.dispose();

    // Assert
    expect(registry.leaseCount).toBe(1);

    // Act
    await consumer.dispose();

    // Assert
    expect(registry.count).toBe(0);
    expect(disposals).toBe(0);
  });

  it('chart and snapshot retain independently; owned resource is released exactly once', async () => {
    // Arrange
    let disposals = 0;
    const registry = new ReferenceRegistry('page', 'owner');
    const root = registry.register({ native: true }, 'owned', () => { disposals++; });
    const chart = root.retain();
    const snapshot = chart.retain();
    await root.dispose();

    // Act
    await snapshot.dispose();

    // Assert
    expect(chart.value).toEqual({ native: true });
    expect(disposals).toBe(0);

    // Act
    const extra = chart.retain();
    await Promise.all([chart.dispose(), chart.dispose(), extra.dispose()]);

    // Assert
    expect(disposals).toBe(1);
    expect(registry.count).toBe(0);
    expect(registry.leaseCount).toBe(0);
  });

  it('failed/cancelled acquisitions never retain entries; foreign and stale tokens fail', async () => {
    // Arrange
    const registry = new ReferenceRegistry('page', 'owner');
    const root = registry.register({});
    const controller = new AbortController();
    controller.abort();

    // Act & Assert
    expect(() => registry.acquire(root.handle, controller.signal)).toThrow();
    expect(() => registry.acquire({ ...root.handle, runtimeId: 'foreign' })).toThrow(/runtime/);
    expect(() => registry.acquire({ ...root.handle, ownerId: 'foreign' })).toThrow(/owner/);
    expect(() => registry.acquire({ ...root.handle, token: 'missing' })).toThrow(/token/);
    expect(registry.leaseCount).toBe(1);

    // Arrange
    await root.dispose();

    // Act & Assert
    expect(() => root.retain()).toThrow(/disposed/);
    expect(() => root.value).toThrow(/disposed/);
    expect(() => registry.acquire(root.handle)).toThrow(/token/);
    expect(registry.count).toBe(0);
  });

  it('release failures remove the entry and repeat disposal observes the same failure', async () => {
    // Arrange
    let disposals = 0;
    const registry = new ReferenceRegistry('page', 'owner');
    const root = registry.register({}, 'owned', async () => {
      disposals++;
      throw new Error('release failed');
    });

    // Act & Assert
    await expect(root.dispose()).rejects.toThrow('release failed');
    await expect(root.dispose()).rejects.toThrow('release failed');
    expect(disposals).toBe(1);
    expect(registry.count).toBe(0);
    expect(registry.leaseCount).toBe(0);
  });

  it('invalid registration has no side effects and registries have independent identities', async () => {
    // Arrange
    const registry = new ReferenceRegistry('page', 'owner-a');

    // Act & Assert
    expect(() => registry.register({}, 'owned')).toThrow(/release/);
    expect(registry.count).toBe(0);

    // Arrange
    const root = registry.register({});
    const other = new ReferenceRegistry('page', 'owner-b');

    // Act & Assert
    expect(() => other.acquire(root.handle)).toThrow(/owner/);
    expect(registry.leaseCount).toBe(1);
    expect(other.count).toBe(0);

    // Act
    await root.dispose();

    // Assert
    expect(registry.count).toBe(0);
  });

  it('reentrant cleanup sees the same pending disposal operation', async () => {
    // Arrange
    const registry = new ReferenceRegistry('page', 'owner');
    let nested: Promise<void> | undefined;
    let disposals = 0;
    const root = registry.register({}, 'owned', () => {
      disposals++;
      nested = root.dispose();
    });

    // Act
    const outer = root.dispose();

    // Assert
    expect(nested).toBe(outer);

    // Act
    await outer;

    // Assert
    expect(disposals).toBe(1);
    expect(registry.count).toBe(0);
  });

  it('runtime and owner identities cannot be changed after registration', async () => {
    // Arrange
    const registry = new ReferenceRegistry('page', 'owner');

    // Act
    const root = registry.register({});

    // Assert
    expect(Reflect.set(registry, 'runtimeId', 'foreign')).toBe(false);
    expect(Reflect.set(registry, 'ownerId', 'foreign')).toBe(false);

    // Act
    const chart = registry.acquire(root.handle);

    // Assert
    expect(chart.handle.runtimeId).toBe('page');

    // Act
    await chart.dispose();
    await root.dispose();

    // Assert
    expect(registry.count).toBe(0);
  });
});
