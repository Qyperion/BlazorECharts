import { nativePublicPaths, graphicConstructors } from './native-graphics.generated.ts';

/** Public source inventory only. No prototype traversal, alternate runtime, or recursive result serialization. */
export function invokeNativeGraphic(runtime: object, path: string, args: unknown[], construct: boolean): unknown {
  if (!nativePublicPaths.includes(path))
    throw Error(`Native path is not in the public inventory: ${path}`);

  if (construct && !graphicConstructors.includes(path))
    throw Error(`Not a public graphic constructor: ${path}`);

  let receiver: any = runtime;
  const parts = path.split('.');
  for (const part of parts.slice(0, -1))
    receiver = receiver?.[part];

  const fn = receiver?.[parts.at(-1)!];
  if (typeof fn !== 'function')
    throw Error(`Selected ECharts runtime lacks public ${path}.`);

  return construct ? Reflect.construct(fn, args) : Reflect.apply(fn, receiver, args);
}
