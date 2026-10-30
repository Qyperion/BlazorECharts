import { getECharts } from '../_content/BlazorECharts/js/blazor-echarts.js';
export const state = { renders: [], colors: [], tooltips: 0, intrinsic: [] };
export function intrinsicRenderItem(params, api) {
  const result = renderItem(params, api);
  state.intrinsic.push({ index: params.dataIndex, text: api.value(2), values: [api.value(0), api.value(1)], result: result.type });
  return result;
}
export function formatter(value) { return `module:${value}`; }
export function canvasWidth() { return this.width; }
export function position(point, params, dom, rect, size) { state.position = { point, dom: dom instanceof HTMLElement, size }; return [17, 23]; }
export function color(params) { state.colors.push(params); return params.dataIndex ? '#0000ff' : '#ff0000'; }
export function tooltipDom(params) {
  state.tooltips++;
  const element = document.createElement('div'); element.dataset.testid = 'native-tooltip'; element.textContent = `DOM:${params.dataIndex}`;
  return element;
}
export function tooltipAsync(params, ticket, callback) {
  setTimeout(() => { const dom = document.createElement('div'); dom.textContent = `async:${params.dataIndex}`; callback(ticket, dom); }, 10);
  return 'loading';
}
export function renderItem(params, api) {
  const point = api.coord([api.value(0), api.value(1)]);
  const shape = getECharts().graphic.clipRectByRect({ x: point[0] - 12, y: point[1] - 8, width: 24, height: 16 }, params.coordSys);
  state.renders.push({ index: params.dataIndex, point, width: api.getWidth(), height: api.getHeight(), series: api.currentSeriesIndices(), ratio: api.getDevicePixelRatio() });
  return shape && { type: 'rect', shape, style: { fill: '#4f46e5' } };
}
