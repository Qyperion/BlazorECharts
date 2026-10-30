import type { JsBindingPath } from './binding-contracts.ts';
import { ReferenceRegistry, type ReferenceLease } from './reference-registry.ts';
import type { ReferenceHandle } from './binding-contracts.ts';

export interface SnapshotBinding extends ReferenceHandle {
  path: JsBindingPath;
  kind: 'object';
}

/** Copy only ordinary own data; functions, browser objects and cycles use the binding registry. */
export function extractSnapshot(
  value: unknown,
  registry: ReferenceRegistry,
  nativeRoot = false,
  preserveNumbers = false,
  registerNative: (value: object) => ReferenceLease = value => registry.register(value)
): { json: unknown; bindings: SnapshotBinding[]; leases: ReferenceLease[] } {
  const bindings: SnapshotBinding[] = [];
  const leases: ReferenceLease[] = [];
  const ancestors = new Set<object>();
  const references = new WeakMap<object, ReferenceLease>();

  function copy(v: unknown, path: JsBindingPath): unknown {
    if (v == null || typeof v === 'string' || typeof v === 'boolean')
      return v ?? null;

    if (typeof v === 'number')
      return Number.isFinite(v) ? v : preserveNumbers ? { $number: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity' } : null;

    if (typeof v !== 'object' && typeof v !== 'function')
      return null;

    const proto = Object.getPrototypeOf(v);
    if ((nativeRoot && path.length === 0)
      || typeof v === 'function'
      || ancestors.has(v)
      || (!Array.isArray(v) && proto !== Object.prototype && proto !== null)) {
      let lease = references.get(v);
      if (!lease) {
        lease = registerNative(v);
        references.set(v, lease);
        leases.push(lease);
      }

      bindings.push({ path, kind: 'object', ...lease.handle });
      return null;
    }

    ancestors.add(v);
    try {
      if (Array.isArray(v))
        return v.map((item, i) => copy(item, [...path, i]));

      const result: Record<string, unknown> = Object.create(null);
      for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v)))
        if (d.enumerable && 'value' in d && d.value !== undefined)
          result[key] = copy(d.value, [...path, key]);

      return result;
    } finally {
      ancestors.delete(v);
    }
  }

  try {
    return { json: copy(value, []), bindings, leases };
  } catch (error) {
    for (const lease of leases)
      void lease.dispose();

    throw error;
  }
}
