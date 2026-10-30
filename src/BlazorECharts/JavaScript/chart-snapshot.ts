import type { ChartObject } from './runtime-provider.ts';
import { EChartsError } from './errors.ts';

/** Internal only: retain the normalized native clone in JS, with unknown fields and array shapes intact. */
export function captureSnapshot(native: ChartObject): unknown {
  if (!native.getOption)
    throw new EChartsError('ChartCapabilityMissing', 'The native instance lacks getOption().');

  return native.getOption();
}

type ObjectValue = Record<string, unknown>;
type Selector = { index: number; id?: string; name?: string };
type Mask = true | { kind: 'object'; keys: Map<string, Mask> } | { kind: 'array'; items: (Selector & { mask: Mask })[] };

// Browser values are atomic. Enumerating a canvas/image/DOM node would replace it with ordinary {}.
const object = (value: unknown): value is ObjectValue => typeof value === 'object' && value !== null && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function selector(value: unknown, index: number): Selector {
  return {
    index,
    ...(object(value) && value.id != null ? { id: String(value.id) }
      : object(value) && value.name != null ? { name: String(value.name) } : {}),
  };
}

function locate(values: unknown[], key: Selector): number {
  return key.id != null ? values.findIndex(v => object(v) && String(v.id) === key.id)
    : key.name != null ? values.findIndex(v => object(v) && String(v.name) === key.name) : key.index;
}

function childMask(mask: Mask | undefined, values: unknown[], index: number): Mask | undefined {
  return mask !== true && mask?.kind === 'array' ? mask.items.find(item => locate(values, item) === index)?.mask : undefined;
}

function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b))
    return true;

  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));

  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

// Track authored shape, not an unbounded patch journal. Root component arrays match native IDs/names/indexes.
function mark(current: unknown, previous: Mask | undefined, input: unknown, root = false, component = false): Mask {
  if (Array.isArray(current) && component && (object(input) || Array.isArray(input))) {
    const incoming = Array.isArray(input) ? input : [input];
    const masks = current.map((_, index) => childMask(previous, current, index));
    incoming.forEach((value, index) => {
      const target = locate(current, selector(value, index));
      if (target >= 0 && target < current.length)
        masks[target] = mark(current[target], masks[target], value);
    });
    return { kind: 'array', items: masks.flatMap((mask, index) => mask ? [{ ...selector(current[index], index), mask }] : []) };
  }

  if (object(current) && object(input)) {
    const keys = previous !== true && previous?.kind === 'object' ? new Map(previous.keys) : new Map<string, Mask>();
    for (const [key, value] of Object.entries(input)) {
      if (Object.hasOwn(current, key))
        keys.set(key, mark(current[key], keys.get(key), value, false, root));
    }

    return { kind: 'object', keys };
  }

  return true;
}

// Omit only inherited values that still equal their normalized baseline. Explicit equal-to-default values survive.
function prune(current: unknown, baseline: unknown, authored: Mask | undefined, root = false, component = false): unknown {
  if (authored === true)
    return current;

  if (!authored && equal(current, baseline))
    return undefined;

  if (object(current)) {
    const result: ObjectValue = {};
    for (const [key, value] of Object.entries(current)) {
      const mask = authored?.kind === 'object' ? authored.keys.get(key) : undefined;
      const retained = prune(value, object(baseline) ? baseline[key] : undefined, mask, false, root);
      if (retained !== undefined)
        Object.defineProperty(result, key, { value: retained, enumerable: true, configurable: true, writable: true });
    }

    return root || authored || Object.keys(result).length ? result : undefined;
  }

  if (Array.isArray(current) && component) {
    const before = Array.isArray(baseline) ? baseline : [];
    const retained = current.map((value, index) => {
      const baseIndex = locate(before, selector(value, index));
      return prune(value, before[baseIndex], childMask(authored, current, index));
    });
    if (current.every(value => object(value) || value == null))
      return retained.map(value => value ?? {});

    // Native top-level array merging can append theme palette entries beyond the authored prefix.
    // A palette is a value array, not an indexed component array: trim only its inherited suffix.
    while (retained.length && retained.at(-1) === undefined)
      retained.pop();

    return retained.map((value, index) => value === undefined ? current[index] : value);
  }

  return current;
}

/** Keep theme-derived defaults out of the replacement's initial backup, while retaining authored/runtime state. */
export class ChartSnapshot {
  #baseline: unknown;
  #authored?: Mask;
  #initialAuthored?: Mask;

  applied(native: ChartObject, input: unknown, update: unknown, current = native.getOption?.()): void {
    // Primitive providers can still apply options without snapshot capability; recreation validates it explicitly.
    if (!native.getOption)
      return;

    const replacement = object(update) && update.notMerge === true;
    let source = object(input) && object(input.baseOption) ? { ...input, ...input.baseOption } : input;

    // Match the pinned graphic preprocessor's shorthand normalization before recording authored paths.
    if (object(source) && source.graphic) {
      const graphic = source.graphic;
      source = {
        ...source,
        graphic: Array.isArray(graphic)
          ? object(graphic[0]) && graphic[0].elements ? [graphic[0]] : [{ elements: graphic }]
          : object(graphic) && !graphic.elements ? [{ elements: [graphic] }] : graphic,
      };
    }

    this.#authored = mark(current, replacement ? undefined : this.#authored, source, true);
    if (this.#baseline === undefined || replacement) {
      this.#baseline = current;
      this.#initialAuthored = this.#authored;
    }
  }

  themeChanged(native: ChartObject): void {
    this.#baseline = native.getOption?.();

    // Native setTheme replays the current native instance's initial backup.
    this.#authored = this.#initialAuthored;
  }

  forRecreation(native: ChartObject): unknown {
    const current = captureSnapshot(native);
    return this.#baseline === undefined ? current : prune(current, this.#baseline, this.#authored, true);
  }

  recreated(native: ChartObject, snapshot: unknown): void {
    this.#baseline = captureSnapshot(native);

    // Retained runtime changes become explicit in the new initial backup and survive subsequent recreations.
    this.#authored = mark(this.#baseline, undefined, snapshot, true);
    this.#initialAuthored = this.#authored;
  }
}
