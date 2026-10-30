// Browser callbacks used by the BlazorECharts examples.
// ECharts calls them synchronously; C# references them with JsFunction.Module<TSignature>(url, exportName).
import { getECharts } from '../../BlazorECharts/js/blazor-echarts.js';

// ECharts inserts the strings that tooltip formatters return as HTML: encode every data value in them.
const encode = text => getECharts().format.encodeHTML(String(text));
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const palette = ['#2f5fd0', '#2f9e44', '#e8590c', '#ae3ec9', '#1098ad', '#f08c00'];
const numbers = new Intl.NumberFormat('en-US');

/** Item color callback: weekend bars use the accent color. */
export function weekendColor(params) {
  return params.dataIndex >= 5 ? '#e8590c' : '#2f5fd0';
}

/** Label formatter: the value with its unit. */
export function messagesLabel(params) {
  return `${numbers.format(params.value)} msgs`;
}

/** Tooltip value formatter. */
export function messagesValue(value) {
  return `${numbers.format(Number(value))} messages`;
}

/** Axis label formatter for a mirrored axis: the magnitude without its sign. */
export function absoluteNumber(value) {
  return numbers.format(Math.abs(Number(value)));
}

/** Time axis label formatter: short month and year. */
export function monthLabel(value) {
  const date = new Date(value);
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Axis tooltip formatter for the mirrored area chart: absolute counts per series. */
export function mirroredTooltip(params) {
  if (!params || !params.length) return '';
  const date = new Date(params[0].axisValue);
  const lines = params.map(item => {
    const value = Array.isArray(item.value) ? item.value[1] : item.value;
    return `${item.marker}${encode(item.seriesName)}: ${numbers.format(Math.abs(Number(value)))}`;
  });
  return [`${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`, ...lines].join('<br/>');
}

/** Item tooltip formatter for calendar cells. */
export function calendarTooltip(params) {
  const [date, count] = params.data;
  return `${encode(date)}: ${numbers.format(count)} ${count === 1 ? 'message' : 'messages'}`;
}

/** WordCloud text color callback. */
export function wordColor(params) {
  return palette[params.dataIndex % palette.length];
}

/** Custom series renderItem: a horizontal range bar from value(1) to value(2) on category value(0). */
export function rangeBar(params, api) {
  const category = api.value(0);
  const start = api.coord([api.value(1), category]);
  const end = api.coord([api.value(2), category]);
  const height = api.size([0, 1])[1] * 0.5;
  return {
    type: 'rect',
    shape: { x: start[0], y: start[1] - height / 2, width: Math.max(end[0] - start[0], 1), height, r: 4 },
    style: { fill: api.visual('color') },
  };
}

/** Registered custom series renderItem: a progress ring at value(0), value(1) filled by value(2). */
export function progressRing(params, api) {
  const center = api.coord([api.value(0), api.value(1)]);
  const ratio = Math.max(0, Math.min(1, api.value(2)));
  const r = 22;
  const start = -Math.PI / 2;
  return {
    type: 'group',
    children: [
      { type: 'circle', shape: { cx: center[0], cy: center[1], r }, style: { fill: 'none', stroke: '#d9dee7', lineWidth: 6 } },
      {
        type: 'arc',
        shape: { cx: center[0], cy: center[1], r, startAngle: start, endAngle: start + Math.PI * 2 * ratio },
        style: { fill: 'none', stroke: api.visual('color'), lineWidth: 6, lineCap: 'round' },
      },
      {
        type: 'text',
        x: center[0], y: center[1],
        style: { text: `${Math.round(ratio * 100)}%`, align: 'center', verticalAlign: 'middle', fill: '#1d2330', fontSize: 11 },
      },
    ],
  };
}
