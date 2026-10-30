import * as loader from '../_content/BlazorECharts/js/runtime-loader.js';
import { formatter } from '../modules/chart-functions.js';
await loader.openFacade(loader.runtimeProtocol, 'csp', {}, []);
const element = document.getElementById('chart');
const id = loader.createChart('csp', element, null, {});
// The .NET transport sends the options as UTF-8 bytes and the bindings separately.
const json = new TextEncoder().encode(JSON.stringify({ animation: false, series: [], formatter: null, ordinary: 'function() { throw 1; }' }));
await loader.setOption('csp', id, json, [
  { path: ['formatter'], kind: 'module', token: 'binding:0', signature: 'fixture:formatter', moduleUrl: './modules/chart-functions.js', exportName: 'formatter' }
], {});
const option = loader.getECharts().getInstanceByDom(element).getOption();
window.cspProof = { formatter: option.formatter(7), same: option.formatter === formatter, ordinary: option.ordinary, noExecution: true };
document.querySelector('[data-testid=status]').textContent = 'csp-ready';
