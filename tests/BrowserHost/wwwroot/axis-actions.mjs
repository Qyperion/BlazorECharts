import * as echarts from './_content/BlazorECharts/js/echarts-6.1.0.js';

export function dispatch(payload, options) {
  (window.axisDispatched ??= []).push(payload.type);
  echarts.getInstanceByDom(document.querySelector('.events-chart')).dispatchAction(payload, options);
}
