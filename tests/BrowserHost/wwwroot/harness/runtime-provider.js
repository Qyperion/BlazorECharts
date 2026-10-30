export async function load() {
  return import(new URL('_content/BlazorECharts/js/echarts-6.1.0.js', document.baseURI).href);
}
