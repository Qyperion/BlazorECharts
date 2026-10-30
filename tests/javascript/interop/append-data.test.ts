import { describe, expect, it } from 'vitest';
import * as echarts from '../../../src/BlazorECharts/wwwroot/js/echarts-6.1.0.js';
import { ChartInstance } from '../../../src/BlazorECharts/JavaScript/chart-instance.ts';

type Native = { getOption(): unknown; getModel(): { getSeriesByIndex(i: number): { getData(): { count(): number } } } };

function chart(series: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const native = (echarts as unknown as { init(dom: null, theme: null, opts: Record<string, unknown>): Native })
    .init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
  let reads = 0;
  const getOption = native.getOption.bind(native);
  native.getOption = () => {
    reads++;
    return getOption();
  };
  const instance = new ChartInstance(native as never);
  instance.setOption({ animation: false, xAxis: { type: 'value' }, yAxis: { type: 'value' }, series, ...extra }, {});
  return { instance, native, reads: () => reads };
}

const points = (n: number) => Array.from({ length: n }, (_, i) => [i, i % 10]);

describe('appendData', () => {
  it('AppendData_ChecksTheSeriesModel_WithoutCopyingTheOption', () => {
    // Arrange
    const { instance, native, reads } = chart([{ type: 'scatter', large: true, data: points(20_000) }]);
    const before = reads();

    // Act
    instance.invokeMethod('appendData', [{ seriesIndex: 0, data: points(1_000) }]);

    // Assert
    expect(reads()).toBe(before);
    expect(native.getModel().getSeriesByIndex(0).getData().count()).toBe(21_000);
    instance.dispose();
  });

  it('AppendData_KeepsTheUpstreamSeriesSupport', () => {
    // Arrange
    const { instance } = chart(
      [
        { type: 'scatter', data: points(3) },
        { type: 'lines', coordinateSystem: 'cartesian2d', data: [{ coords: [[0, 0], [1, 1]] }] },
        { type: 'bar', data: [1, 2] },
        { type: 'scatter', datasetIndex: 0 },
      ],
      { dataset: { source: [[0, 1], [1, 2]] } }
    );
    instance.invokeMethod('appendData', [{ seriesIndex: 0, data: points(2) }]);
    instance.invokeMethod('appendData', [{ seriesIndex: 1, data: [{ coords: [[1, 1], [2, 2]] }] }]);

    // Act & Assert
    for (const seriesIndex of [2, 3, 4, -1, 0.5])
      expect(() => instance.invokeMethod('appendData', [{ seriesIndex, data: [] }])).toThrow(/AppendDataUnsupported/);

    instance.dispose();
  });
});
