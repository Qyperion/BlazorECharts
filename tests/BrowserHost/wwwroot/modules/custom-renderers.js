import * as echarts from '/_content/BlazorECharts/js/echarts-6.1.0.js';

// This function runs synchronously in the selected page runtime on both hosting models.
export function renderItem(params, api) {
    const evidence = window.customRenderEvidence ??= { calls: 0 };
    evidence.calls++;
    evidence.zr = api.getZr() === echarts.getInstanceByDom(document.querySelector('.advanced-chart')).getZr();
    evidence.params = [params.seriesId, params.seriesIndex, params.dataInsideLength, params.coordSys.type];
    const point = api.coord([api.value(0), api.value(1)]);
    const shape = echarts.graphic.clipRectByRect({ x: point[0] - 14, y: point[1] - 10, width: 28, height: 20 }, params.coordSys);
    const result = { type: 'group', children: [
        { type: 'rect', shape, style: { fill: '#2480cc' }, name: `item-${params.dataIndex}` },
        { type: 'text', x: point[0], y: point[1] - 20, style: { text: `Value ${api.value(1)}`, fill: '#123' } }
    ] };
    evidence.sync = !(result instanceof Promise);
    evidence.result = [result.type, ...result.children.map(child => child.type)];
    return result;
}
