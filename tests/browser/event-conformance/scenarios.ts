// Runs in the browser: each scenario renders a real ECharts 6.1.0 chart, subscribes through the bridge's
// ChartEvents (the encoding .NET receives) and triggers its events by actions. Mouse events need real
// pointer input, so the spec drives them on the mounted pointer chart.
import { ChartEvents } from '../../../src/BlazorECharts/JavaScript/events.ts';

type Chart = {
  setOption(option: unknown, notMerge?: boolean): void;
  dispatchAction(payload: unknown): void;
  dispose(): void;
  convertToPixel(finder: unknown, value: unknown): number[];
  getModel(): unknown;
};

type ECharts = { init(element: HTMLElement, theme: null, options: Record<string, unknown>): Chart; registerMap(name: string, map: unknown): void };

interface Scenario {
  name: string;
  events: string[];
  option: Record<string, unknown>;
  act(chart: Chart): void;
  width?: number;
  height?: number;
}

const square = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'West' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
    { type: 'Feature', properties: { name: 'East' }, geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] } },
  ],
};

const bars = (extra: Record<string, unknown> = {}) => ({
  animation: false,
  legend: { data: ['A', 'B'] },
  tooltip: { trigger: 'item' },
  xAxis: { type: 'category', data: ['x', 'y', 'z'] },
  yAxis: { type: 'value' },
  series: [{ id: 'a', name: 'A', type: 'bar', selectedMode: 'multiple', data: [1, 2, 3] }, { id: 'b', name: 'B', type: 'bar', data: [3, 2, 1] }],
  ...extra,
});

const tree = { name: 'Root', children: [{ name: 'Branch', children: [{ name: 'Leaf', value: 1 }] }, { name: 'Other', value: 2 }] };

const nested = [
  { id: 'branch', name: 'Branch', children: [{ id: 'leaf', name: 'Leaf', value: 2 }, { id: 'leaf2', name: 'Leaf 2', value: 1 }] },
  { id: 'other', name: 'Other', value: 2 },
];

/** Every action-driven event, triggered once alone and once in a dispatchAction batch. */
export const scenarios: Scenario[] = [
  {
    name: 'legend',
    events: ['legendselectchanged', 'legendselected', 'legendunselected', 'legendselectall', 'legendinverseselect'],
    option: bars(),
    act(chart) {
      chart.dispatchAction({ type: 'legendToggleSelect', name: 'A' });
      chart.dispatchAction({ type: 'legendSelect', name: 'A' });
      chart.dispatchAction({ type: 'legendUnSelect', name: 'A' });
      chart.dispatchAction({ type: 'legendAllSelect' });
      chart.dispatchAction({ type: 'legendInverseSelect' });
      chart.dispatchAction({ type: 'legendToggleSelect', batch: [{ name: 'A' }, { name: 'B' }] });
      chart.dispatchAction({ type: 'legendAllSelect', batch: [{}, {}] });
    },
  },
  {
    name: 'legend-scroll',
    events: ['legendscroll'],
    option: {
      animation: false,
      legend: { id: 'l', type: 'scroll', width: 120 },
      series: [{ type: 'pie', data: Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i}`, value: i + 1 })) }],
    },
    act(chart) {
      chart.dispatchAction({ type: 'legendScroll', scrollDataIndex: 6, legendId: 'l' });
      chart.dispatchAction({ type: 'legendScroll', batch: [{ scrollDataIndex: 3, legendId: 'l' }] });
    },
  },
  {
    name: 'data-zoom',
    events: ['datazoom'],
    option: bars({ dataZoom: [{ id: 'inside', type: 'inside' }, { id: 'slider', type: 'slider' }] }),
    act(chart) {
      chart.dispatchAction({ type: 'dataZoom', start: 10, end: 60 });
      chart.dispatchAction({
        type: 'dataZoom',
        batch: [{ dataZoomId: 'inside', start: 0, end: 50 }, { dataZoomId: 'slider', startValue: 0, endValue: 1 }],
      });
    },
  },
  {
    name: 'brush',
    events: ['brush', 'brushselected', 'brushend', 'globalcursortaken'],
    option: bars({ brush: { xAxisIndex: 0 } }),
    act(chart) {
      chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX' } });
      chart.dispatchAction({ type: 'brush', areas: [{ brushType: 'lineX', xAxisIndex: 0, coordRange: ['x', 'y'] }] });
      chart.dispatchAction({ type: 'brushEnd', areas: [{ brushType: 'lineX', xAxisIndex: 0, coordRange: ['x', 'y'] }] });
      chart.dispatchAction({ type: 'brush', batch: [{ areas: [{ brushType: 'lineX', xAxisIndex: 0, coordRange: ['y', 'z'] }] }] });
    },
  },
  {
    name: 'highlight-select',
    events: ['highlight', 'downplay', 'selectchanged'],
    option: bars(),
    act(chart) {
      chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: 1 });
      chart.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: 1 });
      chart.dispatchAction({ type: 'highlight', batch: [{ seriesIndex: 0, dataIndex: 0 }, { seriesIndex: 1, dataIndex: 2 }] });
      chart.dispatchAction({ type: 'downplay', batch: [{ seriesIndex: 0, dataIndex: 0 }] });
      chart.dispatchAction({ type: 'select', seriesIndex: 0, dataIndex: 1 });
      chart.dispatchAction({ type: 'toggleSelect', seriesIndex: 0, dataIndex: [0, 2] });
      chart.dispatchAction({ type: 'unselect', seriesIndex: 0, dataIndex: 1 });
    },
  },
  // ECharts accepts numeric ids and names in selectors and echoes them in the event.
  {
    name: 'numeric-ids',
    events: ['highlight', 'downplay', 'datazoom'],
    option: {
      animation: false,
      xAxis: { type: 'category', data: ['x', 'y'] },
      yAxis: { type: 'value' },
      dataZoom: [{ id: 7, type: 'inside' }],
      geo: { id: 3, name: 3, map: 'conformance', left: '60%' },
      series: [{ id: 1, name: 2026, type: 'bar', data: [1, 2] }, { id: 'b', name: 'B', type: 'bar', data: [2, 1] }],
    },
    act(chart) {
      chart.dispatchAction({ type: 'highlight', seriesId: 1, dataIndex: 0 });
      chart.dispatchAction({ type: 'downplay', seriesId: ['b', 1], seriesName: [2026, 'B'], dataIndex: 0 });
      chart.dispatchAction({ type: 'highlight', geoId: 3, geoName: [3], name: 'West' });
      chart.dispatchAction({ type: 'dataZoom', dataZoomId: 7, start: 0, end: 50 });
      chart.dispatchAction({ type: 'dataZoom', dataZoomId: [7], start: 10, end: 60 });
    },
  },
  {
    name: 'tooltip',
    events: ['showtip', 'hidetip'],
    option: bars(),
    act(chart) {
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 1 });
      chart.dispatchAction({ type: 'hideTip' });
      const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, ['y', 1]);
      chart.dispatchAction({ type: 'showTip', x, y });
    },
  },
  {
    name: 'axis-pointer',
    events: ['updateaxispointer', 'showtip', 'highlight', 'downplay'],
    option: bars({ tooltip: { trigger: 'axis' } }),
    act(chart) {
      const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, ['y', 1]);
      chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'mousemove', x, y });
      const [x2, y2] = chart.convertToPixel({ seriesIndex: 0 }, ['z', 1]);
      chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'mousemove', x: x2, y: y2 });
    },
  },
  {
    name: 'toolbox',
    events: ['restore', 'magictypechanged', 'dataviewchanged'],
    option: bars({ toolbox: { feature: { restore: {}, dataView: {}, magicType: { type: ['line', 'bar'] } } } }),
    act(chart) {
      chart.dispatchAction({
        type: 'changeMagicType',
        currentType: 'line',
        newOption: { series: [{ id: 'a', type: 'line' }] },
        featureName: 'magicType',
      });
      chart.dispatchAction({ type: 'changeDataView', newOption: { series: [{ id: 'a', data: [7, 3, 4] }] } });
      chart.dispatchAction({ type: 'restore' });
    },
  },
  {
    name: 'render',
    events: ['rendered', 'finished'],
    option: bars(),
    act(chart) {
      chart.setOption(bars({ title: { text: 'again' } }), true);
    },
  },
  {
    name: 'timeline',
    events: ['timelinechanged', 'timelineplaychanged'],
    option: {
      animation: false,
      baseOption: {
        timeline: { data: ['2025', '2026'], autoPlay: false },
        xAxis: { type: 'category', data: ['x'] },
        yAxis: {},
        series: [{ type: 'bar' }],
      },
      options: [{ series: [{ data: [1] }] }, { series: [{ data: [2] }] }],
    },
    act(chart) {
      chart.dispatchAction({ type: 'timelineChange', currentIndex: 1 });
      chart.dispatchAction({ type: 'timelinePlayChange', playState: false });
      chart.dispatchAction({ type: 'timelineChange', batch: [{ currentIndex: 0 }] });
    },
  },
  {
    name: 'visual-map',
    events: ['datarangeselected'],
    option: bars({
      visualMap: [
        { id: 'continuous', type: 'continuous', min: 0, max: 3, calculable: true },
        { id: 'piecewise', type: 'piecewise', pieces: [{ min: 0, max: 1 }, { min: 1, max: 3 }] },
      ],
    }),
    act(chart) {
      chart.dispatchAction({ type: 'selectDataRange', visualMapId: 'continuous', selected: [1, 2] });
      chart.dispatchAction({ type: 'selectDataRange', visualMapId: 'piecewise', selected: { 0: false, 1: true } });
    },
  },
  {
    name: 'parallel',
    events: ['axisareaselected', 'parallelaxisexpand'],
    option: {
      animation: false,
      parallel: { id: 'p', axisExpandable: true, axisExpandCount: 2, axisExpandWidth: 80 },
      parallelAxis: [{ id: 'p0', dim: 0 }, { id: 'p1', dim: 1 }, { id: 'p2', dim: 2 }],
      series: [{ type: 'parallel', data: [[1, 2, 3], [3, 2, 1]] }],
    },
    act(chart) {
      chart.dispatchAction({ type: 'axisAreaSelect', parallelAxisId: 'p0', intervals: [[1, 2]] });
      chart.dispatchAction({ type: 'parallelAxisExpand', parallelId: 'p', axisExpandWindow: [0, 100] });
    },
  },
  {
    name: 'axis-break',
    events: ['axisbreakchanged'],
    option: {
      animation: false,
      xAxis: { type: 'value', breaks: [{ start: 10, end: 90, gap: '5%' }] },
      yAxis: {},
      series: [{ type: 'scatter', data: [[0, 1], [100, 2]] }],
    },
    act(chart) {
      chart.dispatchAction({ type: 'expandAxisBreak', xAxisIndex: 0, breaks: [{ start: 10, end: 90 }] });
      chart.dispatchAction({ type: 'collapseAxisBreak', xAxisIndex: 0, breaks: [{ start: 10, end: 90 }] });
      chart.dispatchAction({ type: 'toggleAxisBreak', xAxisIndex: 0, breaks: [{ start: 10, end: 90 }] });
    },
  },
  {
    name: 'geo',
    events: ['geoselectchanged', 'geoselected', 'geounselected', 'georoam'],
    option: { animation: false, geo: { id: 'geo', map: 'conformance', roam: true, selectedMode: 'multiple' } },
    act(chart) {
      chart.dispatchAction({ type: 'geoToggleSelect', geoId: 'geo', name: 'West' });
      chart.dispatchAction({ type: 'geoSelect', geoId: 'geo', name: 'East' });
      chart.dispatchAction({ type: 'geoUnSelect', geoId: 'geo', name: 'East' });
      chart.dispatchAction({ type: 'geoRoam', geoId: 'geo', dx: 10, dy: 0 });
      chart.dispatchAction({ type: 'geoRoam', geoId: 'geo', zoom: 2, originX: 0, originY: 0 });
      chart.dispatchAction({ type: 'geoToggleSelect', batch: [{ geoId: 'geo', name: 'West' }] });
    },
  },
  {
    name: 'graph',
    events: ['graphroam', 'focusnodeadjacency', 'unfocusnodeadjacency'],
    option: {
      animation: false,
      series: [
        {
          id: 'g',
          type: 'graph',
          layout: 'none',
          roam: true,
          data: [{ name: 'G1', x: 0, y: 0 }, { name: 'G2', x: 1, y: 1 }],
          links: [{ source: 0, target: 1 }],
        },
      ],
    },
    act(chart) {
      chart.dispatchAction({ type: 'graphRoam', seriesId: 'g', dx: 5, dy: 5 });
      chart.dispatchAction({ type: 'graphRoam', seriesId: 'g', zoom: 2, originX: 10, originY: 10 });
      chart.dispatchAction({ type: 'focusNodeAdjacency', seriesId: 'g', dataIndex: 0 });
      chart.dispatchAction({ type: 'unfocusNodeAdjacency', seriesId: 'g' });
    },
  },
  {
    name: 'sankey',
    events: ['dragnode'],
    option: {
      animation: false,
      series: [
        {
          id: 's',
          type: 'sankey',
          draggable: true,
          data: [{ name: 'A' }, { name: 'B' }],
          links: [{ source: 'A', target: 'B', value: 1 }],
        },
      ],
    },
    act(chart) {
      chart.dispatchAction({ type: 'dragNode', seriesId: 's', dataIndex: 0, localX: 0.1, localY: 0.25 });
      chart.dispatchAction({ type: 'dragNode', seriesId: 's', batch: [{ dataIndex: 0, localX: 0, localY: 0.5 }] });
    },
  },
  {
    name: 'tree',
    events: ['treeroam', 'treeexpandandcollapse'],
    option: { animation: false, series: [{ id: 'tree', type: 'tree', roam: true, initialTreeDepth: -1, data: [tree] }] },
    act(chart) {
      chart.dispatchAction({ type: 'treeRoam', seriesId: 'tree', dx: 5, dy: 5 });
      chart.dispatchAction({ type: 'treeRoam', seriesId: 'tree', zoom: 2, originX: 10, originY: 10 });
      chart.dispatchAction({ type: 'treeExpandAndCollapse', seriesId: 'tree', dataIndex: 1 });
      chart.dispatchAction({ type: 'treeExpandAndCollapse', seriesId: 'tree', batch: [{ dataIndex: 1 }] });
    },
  },
  {
    name: 'treemap',
    events: ['treemaproottonode'],
    option: { animation: false, series: [{ id: 'map', type: 'treemap', data: nested }] },
    act(chart) {
      chart.dispatchAction({ type: 'treemapRootToNode', seriesId: 'map', targetNodeId: 'branch' });
      chart.dispatchAction({ type: 'treemapRootToNode', seriesId: 'map', batch: [{ targetNodeId: 'leaf' }] });
    },
  },
  {
    name: 'sunburst',
    events: ['sunbursthighlight', 'sunburstunhighlight', 'sunburstroottonode'],
    option: { animation: false, series: [{ id: 'sun', type: 'sunburst', data: nested }] },
    act(chart) {
      chart.dispatchAction({ type: 'sunburstHighlight', seriesId: 'sun', targetNodeId: 'leaf' });
      chart.dispatchAction({ type: 'sunburstUnhighlight', seriesId: 'sun' });
      chart.dispatchAction({ type: 'sunburstRootToNode', seriesId: 'sun', targetNodeId: 'branch' });
      chart.dispatchAction({ type: 'sunburstRootToNode', seriesId: 'sun', batch: [{ targetNodeId: 'leaf' }] });
    },
  },
  {
    name: 'axis-order',
    events: ['changeaxisorder'],
    option: {
      animation: false,
      xAxis: { id: 'x', type: 'category', data: ['A', 'B', 'C'] },
      yAxis: {},
      series: [{ type: 'bar', realtimeSort: true, data: [1, 3, 2] }],
    },
    act(chart) {
      // As BarView dispatches it: axisId is the axis index.
      chart.dispatchAction({ type: 'changeAxisOrder', componentType: 'xAxis', axisId: 0, sortInfo: { ordinalNumbers: [2, 0, 1] } });
    },
  },
];

type Captured = Record<string, { json: unknown; references: unknown }[]>;

const subscribe = (events: ChartEvents, prefix: string, names: string[], captured: Captured) => {
  for (const name of names)
    events.subscribe(`${prefix}:${name}`, name, null, {
      invokeMethodAsync: async (_method: string, ...args: unknown[]) => {
        (captured[name] ??= []).push({ json: args[2], references: args[3] });
        return undefined;
      },
    });
};

const mount = (echarts: ECharts, width = 600, height = 400) => {
  const element = document.createElement('div');
  element.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(element);
  return { element, chart: echarts.init(element, null, { renderer: 'canvas' }) };
};

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

/** Runs every scenario, then dispatches each of its actions again as a one-item batch. Returns the payloads and the batches ECharts rejected. */
export async function runActionScenarios(echarts: ECharts): Promise<{ captured: Captured; rejectedBatches: string[] }> {
  echarts.registerMap('conformance', square);
  const captured: Captured = {};
  const rejectedBatches: string[] = [];
  for (const scenario of scenarios) {
    const { element, chart } = mount(echarts, scenario.width, scenario.height);
    chart.setOption(scenario.option);
    const events = new ChartEvents(chart as never, 'conformance', scenario.name, element);
    subscribe(events, scenario.name, scenario.events, captured);
    const dispatched: Record<string, unknown>[] = [];
    const dispatch = chart.dispatchAction.bind(chart);
    chart.dispatchAction = (payload: unknown) => {
      dispatched.push(payload as Record<string, unknown>);
      dispatch(payload);
    };
    scenario.act(chart);
    for (const payload of dispatched.filter((p, i) => !p.batch && dispatched.findIndex(q => q.type === p.type) === i)) {
      const { type, ...item } = payload;
      try {
        dispatch({ type, batch: [item] });
      } catch (error) {
        rejectedBatches.push(`${String(type)}: ${error}`);
      }
    }

    await settle();
    events.dispose();
    chart.dispose();
    element.remove();
  }

  return { captured, rejectedBatches };
}

export const pointerEvents = ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'contextmenu', 'globalout'];
let pointer: { captured: Captured; events: ChartEvents; chart: Chart; element: HTMLElement } | undefined;

/** Mounts a bar chart for pointer input and returns the page coordinates of a bar and of a point outside the chart. */
export function mountPointerChart(echarts: ECharts) {
  const { element, chart } = mount(echarts);
  chart.setOption(bars());
  const captured: Captured = {};
  const events = new ChartEvents(chart as never, 'conformance', 'pointer', element);
  subscribe(events, 'pointer', pointerEvents, captured);
  pointer = { captured, events, chart, element };
  const box = element.getBoundingClientRect();

  // A category holds both series side by side: aim at the centre of the first series' bar.
  const layout = (chart.getModel() as {
    getSeriesByIndex(i: number): { getData(): { getItemLayout(i: number): { x: number; y: number; width: number; height: number } } };
  }).getSeriesByIndex(0).getData().getItemLayout(1);
  const x = layout.x + layout.width / 2;
  const y = layout.y + layout.height / 2;
  return { bar: { x: box.left + x, y: box.top + y }, outside: { x: box.right + 40, y: box.bottom + 40 } };
}

export async function collectPointerEvents(): Promise<Captured> {
  await settle();
  const result = pointer!.captured;
  pointer!.events.dispose();
  pointer!.chart.dispose();
  pointer!.element.remove();
  return result;
}
