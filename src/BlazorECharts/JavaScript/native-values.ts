import type { ModuleImporter } from './runtime-provider.ts';
import { moduleUrl } from './runtime-provider.ts';
import { waitForLifetime } from './async-lifetime.ts';

/** Explicit native factories. Module results are borrowed; library-created images/canvases are owned. */
export async function createNativeValue(
  kind: string,
  options: Record<string, unknown>,
  args: unknown[],
  importer: ModuleImporter,
  baseURI: string,
  signal?: AbortSignal
): Promise<{ value: object; release?: () => void }> {
  signal?.throwIfAborted();
  if (kind === 'image') {
    const image = new Image();
    if (options.crossOrigin != null)
      image.crossOrigin = String(options.crossOrigin);

    image.src = new URL(String(options.src), baseURI).href;
    try {
      await waitForLifetime(image.decode(), signal);
    } catch (cause) {
      image.removeAttribute('src');
      if (signal?.aborted)
        throw signal.reason;

      throw new Error(`Image decode/CORS failed: ${options.src}`, { cause });
    }

    return { value: image, release: () => { image.src = ''; } };
  }

  if (kind === 'canvas') {
    const width = options.width as number;
    const height = options.height as number;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0))
      throw Error('Canvas dimensions must be positive integers.');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { value: canvas, release: () => { canvas.width = canvas.height = 0; } };
  }

  if (kind === 'module') {
    const url = String(options.moduleUrl);
    const name = String(options.exportName);
    try {
      const module = await waitForLifetime(importer(moduleUrl(url, baseURI)), signal);
      signal?.throwIfAborted();
      const factory = Object.hasOwn(module, name) ? module[name] : undefined;
      if (typeof factory !== 'function')
        throw Error('Export must be a factory function.');

      const value = await waitForLifetime(Promise.resolve(factory(...args)), signal);
      if (value === null || !['object', 'function'].includes(typeof value))
        throw Error('Factory must return a native object or function.');

      return { value };
    } catch (cause) {
      throw new Error(`Native factory module=${url} export=${name}: ${String(cause)}`, { cause });
    }
  }

  throw Error(`Unknown native factory: ${kind}`);
}
