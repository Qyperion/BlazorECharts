import type { ApiSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import type { GenerationResult } from '../../../tools/BindingGenerator/src/generation-model.ts';
import { optionGroup } from '../../../tools/BindingGenerator/src/option-partition.ts';

/** In-scope records of a generation that still lack a typed mapping, optionally limited to one option family. */
export function unresolvedInScope(schema: ApiSchema, result: GenerationResult, family?: string): string[] {
  const generated = new Set(result.manifest.entries.filter(e => e.status === 'generated').map(e => e.sourceId));
  const paths = new Map(schema.records.map(r => [r.id, r.publicPath]));
  return [...result.scope!.assignments].filter(([id, a]) => a.set === 'S1' && !generated.has(id)
    && (!family || optionGroup(paths.get(id)!).family === family)).map(([id]) => id);
}
