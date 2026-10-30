import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartInstance } from '../../../src/BlazorECharts/JavaScript/chart-instance.ts';
import { ReferenceRegistry } from '../../../src/BlazorECharts/JavaScript/reference-registry.ts';

function native(option: () => unknown) {
  const calls = { getOption: 0 };
  return {
    calls,
    chart: {
      setOption() {},
      dispose() {},
      getOption: () => {
        calls.getOption++;
        return option();
      },
    } as any,
  };
}

describe('binding leases after setOption', () => {
  afterEach(() => vi.restoreAllMocks());

  it('SetOption_WithoutLeases_ReadsTheOptionOnce', () => {
    // Arrange
    const { calls, chart } = native(() => ({ series: [{ type: 'line', data: [[1, 2], [3, 4]] }] }));
    const instance = new ChartInstance(chart);

    // Act
    instance.setOption({ series: [{ type: 'line', data: [[1, 2], [3, 4]] }] }, { notMerge: true });
    instance.setOption({ series: [{ data: [[5, 6]] }] }, {});

    // Assert
    expect(calls.getOption).toBe(2);
  });

  it('SetOption_WithBindings_ReadsTheOptionOnceAndPrunesOnce', async () => {
    // Arrange
    const formatter = () => 'label';
    let current: unknown = { series: [{ type: 'line', label: { formatter } }] };
    const { calls, chart } = native(() => current);
    const registry = new ReferenceRegistry('page', 'chart');
    const instance = new ChartInstance(chart);
    const lease = registry.register(formatter);
    instance.setOption(current, { notMerge: true }, null, null, null, [lease.retain()]);

    // Act
    await lease.dispose();

    // Assert
    expect(calls.getOption).toBe(1);
    expect(registry.count).toBe(1);

    // Act
    current = { series: [{ type: 'line', label: {} }] };
    instance.setOption(current, { notMerge: true });

    // Assert
    expect(calls.getOption).toBe(2);

    // Act
    await Promise.resolve();

    // Assert
    expect(registry.count).toBe(0);
  });

  it('Prune_DoesNotEnumerateArraysOfPrimitives', () => {
    // Arrange
    const formatter = () => 'label';
    const data = Array.from({ length: 10_000 }, (_, i) => i);
    const pairs = Array.from({ length: 1_000 }, (_, i) => [i, i]);
    const { chart } = native(() => ({ series: [{ type: 'line', data, label: { formatter } }, { type: 'scatter', data: pairs }] }));
    const registry = new ReferenceRegistry('page', 'chart');
    const instance = new ChartInstance(chart);
    const descriptors = vi.spyOn(Object, 'getOwnPropertyDescriptors');

    // Act
    instance.setOption({}, {}, null, null, null, [registry.register(formatter)]);

    // Assert
    expect(descriptors.mock.calls.filter(([value]) => Array.isArray(value)).length).toBe(0);
    expect(registry.count).toBe(1);
  });
});
