import { validateBindings } from './binding-validation.ts';
import type { BindingPolicy, PreparedOptionTransport } from './binding-contracts.ts';
import type { ModuleImporter } from './runtime-provider.ts';
import { moduleUrl } from './runtime-provider.ts';
import type { ReferenceRegistry, ReferenceLease } from './reference-registry.ts';
import { waitForLifetime } from './async-lifetime.ts';

/** Only this explicit descriptor path can import/compile code. Ordinary JSON is cloned as data. */
export async function hydrateBindings(
  prepared: PreparedOptionTransport,
  policy: BindingPolicy,
  registry: ReferenceRegistry,
  importer: ModuleImporter,
  baseURI: string,
  active: () => void,
  signal?: AbortSignal
): Promise<{ value: Record<string, unknown>; leases: ReferenceLease[] }> {
  validateBindings(prepared.json, prepared.bindings, policy);
  const value = structuredClone(prepared.json);
  const leases = new Map<string, ReferenceLease>();
  try {
    for (const binding of prepared.bindings) {
      active();
      let resolved: unknown;
      try {
        if (binding.kind === 'object') {
          const key = `${binding.ownerId}/${binding.token}`;
          let lease = leases.get(key);
          if (!lease) {
            lease = registry.acquire(binding);
            leases.set(key, lease);
          }

          resolved = lease.value;
        } else if (binding.kind === 'module') {
          const module = await waitForLifetime(importer(moduleUrl(binding.moduleUrl, baseURI)), signal);
          active();
          resolved = Object.hasOwn(module, binding.exportName) ? module[binding.exportName] : undefined;
          if (typeof resolved !== 'function')
            throw Error('Export must be a browser function.');
        } else {
          // Deliberate, isolated opt-in. No data strings or marker-shaped JSON reach this branch.
          resolved = Function(`"use strict"; return (${binding.source}\n);`)();
          if (typeof resolved !== 'function')
            throw Error('Inline source must evaluate to a function.');
        }
      } catch (cause) {
        throw new Error(`Binding ${JSON.stringify(binding.path)}${binding.kind === 'module' ? ` module=${binding.moduleUrl} export=${binding.exportName}` : ''}: ${String(cause)}`, { cause });
      }

      active();
      let target: any = value;
      for (const key of binding.path.slice(0, -1))
        target = target[key];

      Object.defineProperty(target, binding.path.at(-1)!, { value: resolved, writable: true, enumerable: true, configurable: true });
    }

    active();
    return { value, leases: [...leases.values()] };
  } catch (error) {
    await Promise.all([...leases.values()].map(lease => lease.dispose()));
    throw error;
  }
}
