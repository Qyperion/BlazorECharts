import { EChartsError } from './errors.ts';

/** A bounded owner's image probes. Chart probes live for a revision; export probes live for one operation. */
export class ImageReadiness {
  readonly #images = new Map<string, HTMLImageElement>();
  readonly #decodes = new WeakMap<object, { ready: boolean; error?: unknown }>();

  backgroundReady(value: any): boolean {
    return this.ready(value?.image);
  }

  captureBackground(value: any): any {
    return value && typeof value.image === 'string' && this.#images.has(value.image)
      ? { ...value, image: this.#images.get(value.image) } : value;
  }

  ready(value: any, fallback?: any): boolean {
    let image = value;
    if (typeof value === 'string') {
      image = fallback ?? this.#images.get(value);

      // SVG with explicit dimensions does not populate ZRImage.__image; decode the href explicitly.
      if (!image && typeof Image !== 'undefined') {
        image = new Image();
        image.src = value;
        this.#images.set(value, image);
      }

      if (!image)
        return false;
    }

    if (image && (image.tagName === 'IMG' || typeof image.decode === 'function')) {
      if (!image.complete)
        return false;

      if (!image.naturalWidth)
        throw new EChartsError('ImageLoadFailed', 'An image required by the chart failed to load.');

      if (typeof image.decode === 'function') {
        let decode = this.#decodes.get(image);
        if (!decode) {
          decode = { ready: false };
          this.#decodes.set(image, decode);
          const state = decode;
          Promise.resolve(image.decode()).then(() => state.ready = true, error => state.error = error);
        }

        if (decode.error !== undefined)
          throw new EChartsError('ImageDecodeFailed', String(decode.error));

        if (!decode.ready)
          return false;
      }
    }

    return true;
  }

  clear(): void {
    for (const image of this.#images.values())
      image.removeAttribute('src');

    this.#images.clear();
  }
}
