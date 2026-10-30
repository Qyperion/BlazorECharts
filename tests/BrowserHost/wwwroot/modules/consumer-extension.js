// Synthetic consumer extension: this module imports no ECharts copy.
export function register(runtime) {
  globalThis.__consumerCount = (globalThis.__consumerCount ?? 0) + 1;
  globalThis.__consumerRuntime = runtime;
  runtime.extendSeriesModel({
    type: 'series.consumer',
    getInitialData(option) { const list = new runtime.List(['value'], this); list.initData(option.data); return list; },
    defaultOption: { coordinateSystem: null, animation: false }
  });
  runtime.extendChartView({
    type: 'consumer',
    dispose() {},
    render(series) { this.group.removeAll(); const data = series.getData(); data.each(index => {
      const shape = new runtime.graphic.Rect({ shape: { x: 30 + index * 65, y: 40, width: 45, height: data.get('value', index) * 15 }, style: { fill: '#346aab' } });
      this.group.add(shape); data.setItemGraphicEl(index, shape);
    }); }
  });
}
