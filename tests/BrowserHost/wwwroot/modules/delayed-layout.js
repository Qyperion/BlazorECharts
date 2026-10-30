import { getECharts, stabilityParticipant } from '../_content/BlazorECharts/js/blazor-echarts.js';
import { referenceStatistics } from '../_content/BlazorECharts/js/runtime-loader.js';
// The group coordinator is internal: the fixture reads it from the page runtime, as blockMemberRead reads the runtime.
const groupMembership = () => window[Symbol.for('BlazorECharts.page-runtime.v3')].groups;
const states = new Map();
function chart(selector) { return getECharts().getInstanceByDom(document.querySelector(selector)); }
function state(selector) { let value = states.get(selector); if (!value) { value = { captures: 0 }; states.set(selector, value); } return value; }
export function begin(selector) {
  const native = chart(selector), value = state(selector);
  if (!native.group) native.group = 'exports-fixture';
  if (!value.wrapped) {
    const original = native.getDataURL;
    native.getDataURL = function (...args) { value.captures++; return original.apply(this, args); }; value.wrapped = true;
  }
  value.current = stabilityParticipant(native).begin('synthetic delayed layout', 'revision');
}
export function updateAndBegin(selector) {
  const native = chart(selector), value = state(selector); value.old = value.current;
  const member = groupMembership().members(native.group).find(c => c.native === native);
  member.setOption({ title: { text: 'Latest synthetic revision' } }, {});
  value.current = stabilityParticipant(native).begin('latest synthetic layout', 'revision');
}
export function completeOld(selector) { state(selector).old.complete(); }
export function complete(selector) { state(selector).current.complete(); }
export function fail(selector) { state(selector).current.fail(Error('synthetic failure')); }
export function leave(selector) { const c = chart(selector); state(selector).group = c.group; c.group = ''; }
export function join(selector) { chart(selector).group = state(selector).group; }
export function image(selector) {
  const native = chart(selector); if (!native.group) native.group = 'exports-fixture';
  groupMembership().members(native.group).find(c => c.native === native).setOption({ animation: false,
    graphic: [{ type: 'image', style: { image: new URL('slow-export.svg', document.baseURI).href, x: 0, y: 0, width: 20, height: 20 } }] }, {});
}
export function captureCount(selector) { return state(selector).captures; }
export function statistics(selector) {
  const native = chart(selector), zr = native.getZr();
  return { ...referenceStatistics(), handlers: Object.values(zr._$handlers ?? {}).reduce((n, list) => n + list.length, 0) };
}
export function blockMemberRead(selector) {
  const runtime = window[Symbol.for('BlazorECharts.page-runtime.v3')], native = chart(selector), value = state(selector);
  const id = groupMembership().members(native.group).find(c => c.native === native).events.chartId;
  const original = runtime.invokeMethod.bind(runtime);
  runtime.invokeMethod = function (owner, chartId, method, ...rest) {
    const result = original(owner, chartId, method, ...rest);
    if (chartId === id && method === 'getWidth') { runtime.invokeMethod = original; return new Promise(resolve => value.releaseRead = () => resolve(result)); }
    return result;
  };
}
export function unblockMemberRead(selector) { state(selector).releaseRead(); }
export function seriesData(selector) { return chart(selector).getOption().series[0].data; }
let firstRenderer;
export function rendererCheckpoint() { firstRenderer = getECharts().zrUtil.guid(); }
export function liveRenderersSinceCheckpoint() {
  const runtime = getECharts(), end = runtime.zrUtil.guid(), live = [];
  for (let id = firstRenderer + 1; id < end; id++) if (runtime.zrender.getInstance(id)) live.push(id);
  return live;
}
export function background(selector, kind) {
  const native = chart(selector); if (!native.group) native.group = 'exports-fixture';
  groupMembership().members(native.group).find(c => c.native === native).setOption({ animation: false,
    backgroundColor: kind === 'chart' ? { image: new URL(`slow-background-${kind}.png`, document.baseURI).href, repeat: 'repeat' } : 'transparent' }, {});
}
