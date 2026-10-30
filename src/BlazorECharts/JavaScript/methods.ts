import type { ChartObject } from './runtime-provider.ts';
import { EChartsError } from './errors.ts';

export const instanceMethods = new Set([
  'getDom', 'getZr', 'getId', 'isSSR', 'getOption', 'getWidth', 'getHeight', 'getDevicePixelRatio', 'convertToPixel', 'convertFromPixel',
  'convertToLayout', 'containPixel', 'getVisual', 'clear', 'resize', 'showLoading', 'hideLoading', 'appendData', 'updateLabelLayout',
  'makeActionFromEvent', 'setTheme', 'isSilent', 'isDisposed', 'trigger', 'triggerWithContext', 'getGroup', 'setGroup',
]);

export const renderingMethods = new Set(['clear', 'resize', 'showLoading', 'hideLoading', 'appendData', 'updateLabelLayout', 'setTheme']);

export function invokeInstanceMethod(native: ChartObject, method: string, args: unknown[]): unknown {
  if (!instanceMethods.has(method))
    throw new EChartsError('MethodNotSupported', `Instance method ${method} is not supported by this bridge.`);

  if (method === 'getGroup')
    return native.group ?? null;

  if (method === 'setGroup') {
    native.group = args[0] as string;
    return null;
  }

  const fn = (native as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function')
    throw new EChartsError('ChartCapabilityMissing', `The native instance lacks ${method}().`);

  if (method === 'appendData') {
    const params = args[0] as { seriesIndex: number; data: unknown };
    if (typeof native.getModel !== 'function')
      throw new EChartsError('ChartCapabilityMissing', 'The native instance lacks getModel().');

    // The series model, not getOption(): getOption deep-copies every series' data on each call.
    const series = Number.isInteger(params.seriesIndex) && params.seriesIndex >= 0
      ? native.getModel().getSeriesByIndex(params.seriesIndex)
      : undefined;
    const option = series?.option;

    // Exact docs: only scatter/lines in core, with explicit series data; dataset is unsupported.
    if (!series
      || !option
      || !['scatter', 'lines'].includes(series.subType ?? '')
      || option.data == null
      || option.datasetId != null
      || (option.datasetIndex != null && option.datasetIndex !== 0))
      throw new EChartsError('AppendDataUnsupported', 'appendData requires an existing scatter/lines series using explicit data, not dataset.');
  }

  if (['convertToPixel', 'convertFromPixel', 'convertToLayout', 'containPixel'].includes(method))
    args = [args[0], coordinates(args[1]), ...args.slice(2)];

  const result = fn.apply(native, args);
  return method === 'trigger' || method === 'triggerWithContext' ? null : result;
}

function coordinates(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(coordinates);

  if (value && typeof value === 'object' && Object.keys(value).length === 1 && '$date' in value)
    return new Date((value as { $date: number }).$date);

  if (value && typeof value === 'object' && Object.keys(value).length === 1 && '$number' in value) {
    const tag = (value as { $number: string }).$number;
    if (tag === 'NaN')
      return NaN;

    if (tag === 'Infinity')
      return Infinity;

    if (tag === '-Infinity')
      return -Infinity;

    throw new EChartsError('CoordinateInvalid', 'Unknown numeric coordinate descriptor.');
  }

  return value;
}
