import { EChartsError } from './errors.ts';
import { moduleUrl, type ModuleImporter } from './runtime-provider.ts';

export interface ExtensionDescriptor {
  readonly id: string;
  readonly version: string;
  readonly dependencies: readonly string[];
  readonly moduleUrl: string;
}

interface Registration {
  descriptor: ExtensionDescriptor;
  promise?: Promise<void>;
  failed?: boolean;
}

/** Registrations belong to the page, and always receive the selected runtime object. */
export class ExtensionRegistry {
  readonly #registrations = new Map<string, Registration>();

  constructor(readonly runtime: () => Promise<object>, readonly importer: ModuleImporter, readonly baseURI: string) {}

  async registerAll(descriptors: readonly ExtensionDescriptor[], retry = false): Promise<void> {
    // Validate the complete graph before installing anything or changing persistent state.
    const graph = new Map(this.#registrations);
    for (const source of descriptors) {
      if (!source.id?.trim() || !source.version?.trim() || !source.moduleUrl?.trim()
        || !Array.isArray(source.dependencies) || source.dependencies.some(id => typeof id !== 'string' || !id.trim()))
        throw new EChartsError('ExtensionDescriptorInvalid', 'Extensions require id, version, moduleUrl and dependency IDs.');

      const descriptor = Object.freeze({
        id: source.id,
        version: source.version,
        dependencies: Object.freeze([...new Set(source.dependencies)].sort()),
        moduleUrl: moduleUrl(source.moduleUrl, this.baseURI),
      });
      const existing = graph.get(descriptor.id);
      if (existing && JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor))
        throw new EChartsError('ExtensionIdentityConflict', `Extension ${descriptor.id} has conflicting version, module or dependencies.`);

      if (!existing)
        graph.set(descriptor.id, { descriptor });
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id))
        throw new EChartsError('ExtensionDependencyCycle', `Extension dependency cycle at ${id}.`);

      if (visited.has(id))
        return;

      const entry = graph.get(id);
      if (!entry)
        throw new EChartsError('ExtensionDependencyMissing', `Missing extension dependency ${id}.`);

      visiting.add(id);
      for (const dependency of entry.descriptor.dependencies)
        visit(dependency);

      visiting.delete(id);
      visited.add(id);
    };
    for (const id of graph.keys())
      visit(id);

    for (const [id, entry] of graph)
      this.#registrations.set(id, entry);

    if (retry)
      for (const entry of graph.values())
        if (entry.failed) {
          entry.promise = undefined;
          entry.failed = false;
        }

    const install = (id: string): Promise<void> => {
      const entry = this.#registrations.get(id)!;
      return entry.promise ??= Promise.resolve().then(async () => {
        for (const dependency of entry.descriptor.dependencies)
          await install(dependency);

        const runtime = await this.runtime();
        const module = await this.importer(entry.descriptor.moduleUrl);
        if (typeof module.register !== 'function')
          throw new EChartsError('ExtensionCapabilityMissing', `Extension ${id} must export register(runtime).`);

        await module.register(runtime);
      }).catch(error => {
        entry.failed = true;
        throw error;
      });
    };
    await Promise.all(descriptors.map(descriptor => install(descriptor.id)));
  }
}
