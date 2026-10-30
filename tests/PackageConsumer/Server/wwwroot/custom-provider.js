// Opt-in custom runtime provider: loads ECharts from a CDN instead of the packaged asset.
export async function load() {
  return import('https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.esm.min.mjs');
}
