// getOption() snapshots of the pinned ECharts runtime (server-side rendering in Node), the input of the .NET read tests.
// node tools/Snapshots/echarts-snapshots.mjs [--check]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ECharts reads date strings such as '2026-01-01' in local time: the snapshots must not depend on the machine.
process.env.TZ = 'UTC';

const root = join(import.meta.dirname, '..', '..');
const runtime = join(root, 'src/BlazorECharts/wwwroot/js/echarts-6.1.0.js');
const output = join(root, 'tests/BlazorECharts.Tests/Fixtures/echarts-6.1.0-snapshots');
const check = process.argv.includes('--check');
const echarts = await import(pathToFileURL(runtime).href);
if (echarts.version !== '6.1.0') throw new Error(`Expected ECharts 6.1.0, found ${echarts.version}`);

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const square = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Square' },
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } }] };
echarts.registerMap('square', square);

/** Each scenario covers components and series as an author writes them; getOption() adds every default. */
const scenarios = {
  cartesian: {
    title: { text: 'Cartesian', subtext: 'bars and lines' }, legend: {}, tooltip: { trigger: 'axis' }, grid: { left: 40, right: 40 },
    toolbox: { feature: { saveAsImage: {}, dataView: {}, restore: {}, dataZoom: {}, magicType: { type: ['line', 'bar', 'stack'] }, brush: {} } },
    brush: { toolbox: ['rect', 'polygon', 'keep', 'clear'], xAxisIndex: 0 },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    xAxis: { type: 'category', data: days }, yAxis: [{ type: 'value' }, { type: 'value', position: 'right' }],
    aria: { enabled: true },
    series: [
      { type: 'bar', name: 'Sent', data: [5, 20, 36, 10, 10], label: { show: true }, itemStyle: { borderRadius: [4, 4, 0, 0] },
        markPoint: { data: [{ type: 'max' }, { type: 'min' }] }, markLine: { data: [{ type: 'average' }] },
        markArea: { data: [[{ xAxis: 'Mon' }, { xAxis: 'Tue' }]] } },
      { type: 'line', name: 'Read', yAxisIndex: 1, smooth: true, areaStyle: {}, data: [3, 12, 30, 8, 9], emphasis: { focus: 'series' } },
      { type: 'scatter', name: 'Points', data: [[0, 4], [2, 15], [4, 8]], symbolSize: 12 },
      { type: 'effectScatter', name: 'Effect', data: [[1, 10]] },
      { type: 'pictorialBar', name: 'Icons', symbol: 'circle', data: [2, 4, 6, 8, 10] },
    ],
  },
  financial: {
    xAxis: { type: 'category', data: days }, yAxis: { scale: true }, tooltip: {},
    visualMap: { type: 'piecewise', dimension: 1, pieces: [{ min: 0, max: 20 }, { min: 20 }], seriesIndex: 0 },
    series: [
      { type: 'candlestick', data: [[20, 34, 10, 38], [40, 35, 30, 50], [31, 38, 33, 44], [38, 15, 5, 42], [10, 20, 5, 25]] },
      { type: 'boxplot', data: [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6], [1, 3, 5, 7, 9], [2, 4, 6, 8, 10], [3, 4, 5, 6, 7]] },
    ],
  },
  time: {
    xAxis: { type: 'time' }, yAxis: { type: 'log' }, tooltip: { trigger: 'axis' }, dataZoom: [{ type: 'slider', xAxisIndex: 0 }],
    series: [{ type: 'line', data: [['2026-01-01', 10], ['2026-02-01', 100], ['2026-03-01', 1000]], showSymbol: false }],
  },
  polar: {
    legend: { type: 'scroll' }, polar: {}, angleAxis: { type: 'category', data: days }, radiusAxis: {},
    series: [{ type: 'bar', coordinateSystem: 'polar', name: 'Polar', data: [1, 2, 3, 4, 5] }],
  },
  shapes: {
    legend: { orient: 'vertical', left: 0 }, tooltip: { trigger: 'item' },
    radar: { indicator: [{ name: 'A', max: 10 }, { name: 'B', max: 10 }, { name: 'C', max: 10 }] },
    series: [
      { type: 'radar', data: [{ name: 'One', value: [4, 5, 6] }, { name: 'Two', value: [7, 3, 2] }] },
      { type: 'pie', radius: ['30%', '50%'], center: ['30%', '70%'], data: [{ name: 'X', value: 3 }, { name: 'Y', value: 5 }], roseType: 'radius' },
      { type: 'funnel', left: '60%', top: '50%', width: '30%', data: [{ name: 'Seen', value: 100 }, { name: 'Clicked', value: 40 }] },
      { type: 'gauge', center: ['80%', '25%'], radius: '30%', data: [{ name: 'Load', value: 42 }], progress: { show: true } },
    ],
  },
  hierarchy: {
    tooltip: {},
    series: [
      { type: 'tree', left: '2%', right: '70%', data: [{ name: 'root', children: [{ name: 'a', value: 1 }, { name: 'b', value: 2, children: [{ name: 'c', value: 3 }] }] }] },
      { type: 'treemap', left: '35%', right: '35%', data: [{ name: 'a', value: 4 }, { name: 'b', value: 6, children: [{ name: 'c', value: 6 }] }], levels: [{ itemStyle: { gapWidth: 2 } }] },
      { type: 'sunburst', center: ['85%', '50%'], radius: [0, '30%'], data: [{ name: 'a', value: 3, children: [{ name: 'a1', value: 1 }] }, { name: 'b', value: 5 }] },
    ],
  },
  networks: {
    tooltip: {}, legend: { data: ['Group'] },
    series: [
      { type: 'graph', layout: 'force', force: { repulsion: 50 }, roam: true, categories: [{ name: 'Group' }], left: 0, width: '30%',
        data: [{ name: 'n1', category: 0, symbolSize: 20 }, { name: 'n2', category: 0 }], links: [{ source: 'n1', target: 'n2' }], edgeSymbol: ['none', 'arrow'] },
      { type: 'sankey', left: '35%', width: '30%', data: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], links: [{ source: 'a', target: 'b', value: 3 }, { source: 'b', target: 'c', value: 2 }] },
      { type: 'chord', center: ['85%', '50%'], radius: ['20%', '30%'], data: [{ name: 'p' }, { name: 'q' }], links: [{ source: 'p', target: 'q', value: 4 }] },
    ],
  },
  parallel: {
    parallel: { left: 40, right: 40, bottom: '55%' },
    parallelAxis: [{ dim: 0, name: 'Price' }, { dim: 1, name: 'Size' }, { dim: 2, name: 'Grade', type: 'category', data: ['A', 'B'] }],
    singleAxis: { type: 'time', top: '55%', bottom: 30 },
    series: [
      { type: 'parallel', data: [[1, 2, 'A'], [3, 4, 'B']], lineStyle: { width: 2 } },
      { type: 'themeRiver', data: [['2026-01-01', 10, 'x'], ['2026-01-02', 15, 'x'], ['2026-01-01', 5, 'y'], ['2026-01-02', 8, 'y']] },
    ],
  },
  calendar: {
    visualMap: { min: 0, max: 10, calculable: true, orient: 'horizontal', left: 'center' },
    calendar: { range: '2026-01', cellSize: ['auto', 20] },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: [['2026-01-01', 3], ['2026-01-02', 7]] }],
  },
  dataset: {
    dataset: [{ source: [['product', '2025', '2026'], ['Tea', 43.3, 85.8], ['Coffee', 83.1, 73.4]] },
      { transform: { type: 'filter', config: { dimension: '2026', '>': 80 } } },
      { transform: { type: 'sort', config: { dimension: '2025', order: 'desc' } } }],
    xAxis: { type: 'category' }, yAxis: {},
    series: [{ type: 'bar', datasetIndex: 0, encode: { x: 'product', y: '2025' } }, { type: 'bar', datasetIndex: 2, seriesLayoutBy: 'column' }],
  },
  graphic: {
    timeline: { data: ['2025', '2026'], autoPlay: false },
    graphic: [{ type: 'group', left: 10, top: 10, children: [
      // textContent and patterns take an optional type that ECharts does not select them by: both forms.
      { type: 'rect', shape: { width: 40, height: 20, r: 4 }, style: { fill: '#5470c6' }, textContent: { style: { text: 'untyped' } } },
      { type: 'circle', shape: { r: 10 }, left: 50, textContent: { type: 'text', style: { text: 'typed' } } },
      { type: 'text', style: { text: 'Label', fontSize: 12 }, left: 80 },
      { type: 'line', shape: { x1: 0, y1: 0, x2: 30, y2: 30 } },
      { type: 'polyline', shape: { points: [[0, 0], [10, 10], [20, 0]] } },
      { type: 'polygon', shape: { points: [[0, 0], [10, 10], [20, 0]] } },
      { type: 'ring', shape: { r: 10, r0: 5 } },
      { type: 'sector', shape: { r: 10, startAngle: 0, endAngle: 1 } },
      { type: 'arc', shape: { r: 10, startAngle: 0, endAngle: 1 } },
      { type: 'bezierCurve', shape: { x1: 0, y1: 0, x2: 10, y2: 10, cpx1: 5, cpy1: 0 } },
      { type: 'ellipse', shape: { rx: 10, ry: 5 } },
    ] }],
    xAxis: { type: 'category', data: ['A', 'B'] }, yAxis: {},
    matrix: { x: { data: ['A', 'B'] }, y: { type: 'category', data: ['C'] }, left: '60%' },
    series: [{ type: 'lines', coordinateSystem: 'cartesian2d', data: [{ coords: [[0, 1], [1, 2]] }] }, { type: 'bar', data: [1, 2], itemStyle: { color: { image: pixel, repeat: 'repeat' } } },
      { type: 'bar', data: [2, 1], itemStyle: { color: { type: 'pattern', image: pixel, repeat: 'no-repeat' } } }],
  },
  geo: {
    geo: { map: 'square', roam: true, regions: [{ name: 'Square', itemStyle: { areaColor: '#eee' } }] },
    tooltip: {},
    series: [
      { type: 'map', map: 'square', left: '60%', data: [{ name: 'Square', value: 3 }] },
      { type: 'scatter', coordinateSystem: 'geo', data: [[5, 5, 1]] },
      { type: 'lines', coordinateSystem: 'geo', data: [{ coords: [[1, 1], [9, 9]] }] },
    ],
  },
};

const files = new Map();
for (const [name, option] of Object.entries(scenarios)) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 600 });
  chart.setOption({ animation: false, ...option });
  // Functions are not JSON; getOption() of these scenarios holds none.
  files.set(`${name}.json`, JSON.stringify(chart.getOption(), (key, value) => { if (typeof value === 'function') throw new Error(`${name}: function at ${key}`); return value; }) + '\n');
  chart.dispose();
}
const stale = (() => { try { return readdirSync(output).filter(f => !files.has(f)); } catch { return []; } })();
if (check) {
  const drift = [...files].filter(([file, text]) => { try { return readFileSync(join(output, file), 'utf8') !== text; } catch { return true; } }).map(([file]) => file);
  if (drift.length || stale.length) { console.error(`Snapshot drift: ${[...drift, ...stale].join(', ')}. Run node tools/Snapshots/echarts-snapshots.mjs.`); process.exit(1); }
} else {
  mkdirSync(output, { recursive: true });
  for (const file of stale) rmSync(join(output, file));
  for (const [file, text] of files) writeFileSync(join(output, file), text);
}
console.log(JSON.stringify({ snapshots: files.size, bytes: [...files.values()].reduce((n, t) => n + t.length, 0), check }));
