import install from '../../../artifacts/compatibility/installer.js';

// Probe only. The WordCloud package owns the production runtime/provider contract.
export type EChartsRuntimeObject = {
  version: string;
  extendSeriesModel: Function;
  extendChartView: Function;
  registerLayout: Function;
  registerPreprocessor: Function;
  helper: object;
  graphic: object;
  number: object;
  util: object;
  format: object;
  List: Function;
};

const registered = new WeakSet<object>();

export function register(runtime: EChartsRuntimeObject): void {
  if (runtime.version !== '6.1.0')
    throw new Error('WordCloud probe requires ECharts 6.1.0');

  if (registered.has(runtime))
    return;

  install(runtime);
  registered.add(runtime);
}
