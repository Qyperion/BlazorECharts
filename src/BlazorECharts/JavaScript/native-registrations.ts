import type { ReferenceLease } from './reference-registry.ts';

interface Retention {
  keys: Set<string>;
  leases: ReferenceLease[];
}

/** Pinned echarts/core/echarts, locale, extension and zrender/core/platform ownership semantics. */
export class NativeRegistrations {
  readonly #slots = new Map<string, Retention>();
  readonly #actions = new Set<string>();
  #next = 0;

  async adopt(path: string, args: unknown[], leases: ReferenceLease[]): Promise<boolean> {
    if (!/^(register|extend)/.test(path) && !['graphic.registerShape', 'setCanvasCreator', 'setPlatformAPI'].includes(path))
      return false;

    if (path === 'registerAction') {
      const type = typeof args[0] === 'string' ? args[0] : (args[0] as { type: string }).type;
      if (this.#actions.has(type)) {
        await release(leases);
        return true;
      }

      this.#actions.add(type);
      await this.#replace([`action/${type}`], leases);
      return true;
    }

    if (path === 'setPlatformAPI' || path === 'setCanvasCreator') {
      const options = path === 'setCanvasCreator' ? { createCanvas: args[0] } : args[0] as Record<string, unknown>;

      // setPlatformAPI changes only supplied truthy properties; aliases share the same slots.
      const keys = ['createCanvas', 'measureText', 'loadImage', 'getTime'].filter(k => options?.[k]).map(k => `platform/${k}`);
      if (keys.length)
        await this.#replace(keys, leases);
      else
        await release(leases);

      return true;
    }

    const named = [
      'registerMap', 'registerTheme', 'registerLocale', 'registerCoordinateSystem', 'registerCustomSeries', 'registerLoading',
      'graphic.registerShape',
    ];
    if (named.includes(path)) {
      const key = path === 'registerLocale' ? String(args[0]).toUpperCase() : String(args[0]);
      await this.#replace([`${path}/${key}`], leases);
      return true;
    }

    if (path === 'registerTransform') {
      await this.#replace([`${path}/${(args[0] as { type: string }).type}`], leases);
      return true;
    }

    // Processor/layout/visual/preprocessor/lifecycle registrations append. Extensions may
    // retain old class instances too; these registrations have no native removal operation.
    if (leases.length)
      await this.#replace([`append/${++this.#next}`], leases);

    return true;
  }

  async #replace(keys: string[], leases: ReferenceLease[]): Promise<void> {
    const next = { keys: new Set(keys), leases };
    const retired = new Set<Retention>();
    for (const key of keys) {
      const previous = this.#slots.get(key);
      this.#slots.set(key, next);
      if (previous) {
        previous.keys.delete(key);
        if (!previous.keys.size)
          retired.add(previous);
      }
    }

    await Promise.all([...retired].map(r => release(r.leases)));
  }
}

const release = (leases: ReferenceLease[]) => Promise.all(leases.map(l => l.dispose())).then(() => undefined);
