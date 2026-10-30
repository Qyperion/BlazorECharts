export function format(params) {
  window.seriesCallbackCalls = (window.seriesCallbackCalls ?? 0) + 1;
  return `${params.seriesType}:${params.value}`;
}
export function color(params) {
  window.seriesCallbackCalls = (window.seriesCallbackCalls ?? 0) + 1;
  return params.dataIndex === 0 ? '#2480cc' : '#cc6824';
}
export function funnelSort(a, b) {
  window.funnelSortCalls = (window.funnelSortCalls ?? 0) + 1;
  return b - a;
}
