import { EChartsError } from './errors.ts';
import { globalHelperNames, globalNumericArguments, globalBooleanResults } from './global-helpers.generated.ts';

const methods = new Set(['registerMap', 'getMap', 'registerTheme', 'registerLocale', 'getCoordinateSystemDimensions', ...globalHelperNames]);

export function invokeGlobal(runtime: object, method: string, args: unknown[], numbers: readonly number[] = []): unknown {
  if (!methods.has(method))
    throw new EChartsError('GlobalMethodNotSupported', `Unsupported global method ${method}.`);

  let receiver = runtime as Record<string, unknown>;
  const parts = method.split('.');
  for (const part of parts.slice(0, -1))
    receiver = receiver[part] as Record<string, unknown>;

  const fn = receiver?.[parts.at(-1)!];
  if (typeof fn !== 'function')
    throw new EChartsError('RuntimeCapabilityMissing', `Runtime lacks ${method}().`);

  const decoders = globalNumericArguments[method] ?? [];
  const supplied = args.map((a, index) => decode(a, numbers.includes(index) ? 'number' : decoders[index]));
  const result = fn.apply(receiver, supplied);

  // getMap returns the same GeoJSON as geoJson and geoJSON; .NET reads geoJSON, so send it once.
  if (method === 'getMap' && result && typeof result === 'object') {
    const { geoJson: _alias, ...map } = result as Record<string, unknown>;
    return copy(map);
  }

  return copy(globalBooleanResults.includes(method) ? !!result : result);
}

function decode(value: unknown, shape: unknown): unknown {
  if (!shape || value == null)
    return value;

  if (shape === 'number' && typeof value === 'object' && Object.keys(value).length === 1 && '$number' in value) {
    const tag = (value as { $number: string }).$number;
    if (['NaN', 'Infinity', '-Infinity'].includes(tag))
      return Number(tag);
  }

  if (Array.isArray(shape))
    return shape.reduce((current, branch) => decode(current, branch), value);

  if (typeof shape === 'object') {
    const node = shape as { array?: unknown; properties?: Record<string, unknown> };
    if (node.array && Array.isArray(value))
      return value.map(v => decode(v, node.array));

    if (node.properties && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v, node.properties![k])]));
  }

  return value;
}

function copy(value: unknown): unknown {
  if (value == null)
    return null;

  if (value instanceof Date)
    return Number.isFinite(+value) ? value.toISOString() : null;

  if (typeof value === 'number' && !Number.isFinite(value))
    return { $number: String(value) };

  if (Array.isArray(value) || ArrayBuffer.isView(value))
    return Array.from(value as number[]).map(copy);

  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));

  return value;
}
