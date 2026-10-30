import { describe, expect, it } from 'vitest';
import { ChartInstance } from '../../../src/BlazorECharts/JavaScript/chart-instance.ts';
import { extractSnapshot } from '../../../src/BlazorECharts/JavaScript/option-snapshot.ts';
import { ReferenceRegistry } from '../../../src/BlazorECharts/JavaScript/reference-registry.ts';

describe('instance methods and normalized snapshots', () => {
  it('CoordinateResults_PreserveNonFiniteNumbersSeparatelyFromMissingResults', () => {
    // Act
    const result = extractSnapshot([NaN, 12, Infinity, -Infinity], new ReferenceRegistry('page', 'chart'), false, true);

    // Assert
    expect(result.json).toEqual([{ $number: 'NaN' }, 12, { $number: 'Infinity' }, { $number: '-Infinity' }]);
    expect(result.bindings).toEqual([]);
  });

  it('GetOption_PreservesNormalizedArraysAndUnknownData', async () => {
    // Arrange
    const native = new (class Native {})();
    const formatter = () => 'value';
    const registry = new ReferenceRegistry('page', 'chart');

    // Act
    const result = extractSnapshot(
      { title: [{ text: 'A' }], series: [{ type: 'bar', data: [0, false, null, []] }], unknown: { native, formatter } },
      registry
    );

    // Assert
    expect(result.json).toEqual({
      title: [{ text: 'A' }],
      series: [{ type: 'bar', data: [0, false, null, []] }],
      unknown: { native: null, formatter: null },
    });
    expect(result.bindings.map(b => b.path)).toEqual([['unknown', 'native'], ['unknown', 'formatter']]);

    // Act
    const retained = registry.acquire(result.bindings[0]);

    // Assert
    expect(retained.value).toBe(native);

    // Act
    await retained.dispose();
    await Promise.all(result.leases.map(l => l.dispose()));

    // Assert
    expect(registry.count).toBe(0);
  });

  it('SnapshotDisposal_PreservesChartLease', async () => {
    // Arrange
    const registry = new ReferenceRegistry('page', 'chart');
    const native = new (class Native {})();
    const chart = registry.register(native);
    const snapshot = extractSnapshot({ native }, registry);

    // Act
    await Promise.all(snapshot.leases.map(l => l.dispose()));

    // Assert
    expect(chart.value).toBe(native);
    expect(registry.count).toBe(1);

    // Act
    await chart.dispose();

    // Assert
    expect(registry.count).toBe(0);
  });

  it('InstanceMethods_UseCorrectOverloadAndReturnShape', () => {
    // Arrange
    const calls: unknown[] = [];
    const dom = new (class Element {})();
    const chart = new ChartInstance({
      setOption() {},
      dispose() {},
      convertToPixel(f: unknown, v: unknown) {
        calls.push([f, v]);
        return Array.isArray(v) ? [12, 34] : 12;
      },
      getDom() {
        return dom;
      },
    } as any);

    // Act & Assert
    expect(chart.invokeMethod('convertToPixel', ['xAxis', 2])).toBe(12);
    expect(chart.invokeMethod('convertToPixel', [{ seriesIndex: 0 }, [2, 3]])).toEqual([12, 34]);
    expect(chart.invokeMethod('getDom', [])).toBe(dom);
    expect(calls).toEqual([['xAxis', 2], [{ seriesIndex: 0 }, [2, 3]]]);
  });

  it('AppendData_RespectsUpstreamSeriesSupport', () => {
    // Arrange
    let appended = 0;
    let series = { type: 'scatter', data: [[1, 2]] };
    const chart = new ChartInstance({
      setOption() {},
      dispose() {},
      getModel: () => ({ getSeriesByIndex: (i: number) => i === 0 ? { subType: series.type, option: series } : undefined }),
      appendData() {
        appended++;
      },
    } as any);

    // Act
    chart.invokeMethod('appendData', [{ seriesIndex: 0, data: [[2, 3]] }]);

    // Assert
    expect(appended).toBe(1);

    // Arrange
    series = { type: 'bar', data: [[1, 2]] };

    // Act & Assert
    expect(() => chart.invokeMethod('appendData', [{ seriesIndex: 0, data: [] }])).toThrow(/AppendDataUnsupported/);
    expect(appended).toBe(1);
  });

  it('Methods_RespectGenerationAndOrdering', () => {
    // Arrange
    const calls: string[] = [];
    const chart = new ChartInstance({
      setOption() {},
      dispose() {},
      showLoading() {
        calls.push('show');
      },
      hideLoading() {
        calls.push('hide');
      },
      clear() {
        throw new Error('native failure');
      },
    } as any);

    // Act
    chart.invokeMethod('showLoading', [], 1, 1, 1);
    chart.invokeMethod('hideLoading', [], 1, 2, 2);

    // Assert
    expect(calls).toEqual(['show', 'hide']);

    // Act & Assert
    expect(() => chart.invokeMethod('showLoading', [], 0, 3, 3)).toThrow(/obsolete/);
    expect(() => chart.invokeMethod('clear', [], 1, 4, 4)).toThrow(/native failure/);
    expect(() => chart.invokeMethod('notAPublicMethod', [])).toThrow(/MethodNotSupported/);

    // Arrange
    chart.dispose();

    // Act & Assert
    expect(() => chart.invokeMethod('getWidth', [])).toThrow(/ChartDisposed/);
  });

  it('InheritedEvents_AndDatesRetainNativeSemantics', () => {
    // Arrange
    let received: unknown;
    const context = { marker: 2 };
    const chart = new ChartInstance({
      setOption() {},
      dispose() {},
      isSilent: () => false,
      trigger: (name: string, payload: unknown) => { received = [name, payload]; },
      triggerWithContext: (...args: unknown[]) => { received = args; },
      convertToLayout: (_: unknown, value: Date) => {
        received = value;
        return { rect: { x: 1, y: 2, width: 3, height: 4 } };
      },
    } as any);

    // Act & Assert
    expect(chart.invokeMethod('isSilent', ['click'])).toBe(false);

    // Act
    chart.invokeMethod('trigger', ['custom', { value: 0 }]);

    // Assert
    expect(received).toEqual(['custom', { value: 0 }]);

    // Act
    chart.invokeMethod('triggerWithContext', ['custom', 0, context]);

    // Assert
    expect(received).toEqual(['custom', 0, context]);
    expect(chart.invokeMethod('convertToLayout', ['matrix', { $date: 0 }])).toEqual({ rect: { x: 1, y: 2, width: 3, height: 4 } });
    expect(received).toBeInstanceOf(Date);
    expect((received as Date).getTime()).toBe(0);
  });

  it('ExternallyDisposedNative_RejectsNoOpMutation', () => {
    // Arrange
    let calls = 0;
    const chart = new ChartInstance({
      setOption() {},
      dispose() {},
      isDisposed: () => true,
      clear() {
        calls++;
      },
    } as any);

    // Act & Assert
    expect(chart.invokeMethod('isDisposed', [])).toBe(true);
    expect(() => chart.invokeMethod('clear', [])).toThrow(/ChartDisposed/);
    expect(calls).toBe(0);
    expect(() => chart.invokeMethod('clear', [])).toThrow(/chart=test-chart; operation=clear; upstreamVersion=6.1.0/);
  });
});
