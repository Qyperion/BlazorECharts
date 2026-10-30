// Browser functions of the CSP fixture: imported as modules, never evaluated from strings.
export const state = { labels: 0, renders: 0 };
export function label(params) { state.labels++; return `csp:${params.value}`; }
export function renderItem(params, api) {
  state.renders++;
  const point = api.coord([api.value(0), api.value(1)]);
  return { type: 'circle', shape: { cx: point[0], cy: point[1], r: 6 }, style: { fill: '#e8590c' } };
}
