// A consumer extension installing the "progress" series type.
// It receives the page's ECharts runtime and never imports or bundles a second ECharts copy.

export function register(runtime) {
  runtime.extendSeriesModel({
    type: 'series.progress',
    getInitialData(option) {
      const data = new runtime.List(['value'], this);
      data.initData(option.data);
      return data;
    },
    defaultOption: { coordinateSystem: 'none', trackColor: '#e8eefc', barHeight: 18, left: 120, right: 60, top: 60 },
  });

  runtime.extendChartView({
    type: 'progress',
    render(seriesModel, ecModel, api) {
      this.group.removeAll();
      const data = seriesModel.getData();
      const left = seriesModel.get('left');
      const width = Math.max(api.getWidth() - left - seriesModel.get('right'), 40);
      const height = seriesModel.get('barHeight');
      const color = seriesModel.get('color') || '#2f5fd0';
      data.each(index => {
        const value = Math.max(0, Math.min(100, data.get('value', index)));
        const y = seriesModel.get('top') + index * (height + 16);
        this.group.add(new runtime.graphic.Text({
          style: { text: data.getName(index), x: left - 12, y: y + height / 2, align: 'right', verticalAlign: 'middle', fill: '#1d2330' },
        }));
        this.group.add(new runtime.graphic.Rect({
          shape: { x: left, y, width, height, r: height / 2 }, style: { fill: seriesModel.get('trackColor') },
        }));
        const bar = new runtime.graphic.Rect({
          shape: { x: left, y, width: width * value / 100, height, r: height / 2 }, style: { fill: color },
        });
        this.group.add(bar);
        this.group.add(new runtime.graphic.Text({
          style: { text: `${value}%`, x: left + width + 8, y: y + height / 2, verticalAlign: 'middle', fill: '#5b6475' },
        }));
        data.setItemGraphicEl(index, bar);
      });
    },
    dispose() {},
  });
}
