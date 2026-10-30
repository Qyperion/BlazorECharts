import { createHash } from 'node:crypto';
import type { ApiSchema, Provenance, TypeNode } from './schema.ts';

type SourceReader = (pkg: string, file: string) => string | undefined;
const declaration = /^(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/;
const cache = new WeakMap<ApiSchema, { provenance: Map<string, Provenance>; lines: Map<string, string[] | undefined> }>();

/** The upstream type alias whose declaration span is the provenance of this type, if any. */
export function upstreamAlias(schema: ApiSchema, type: TypeNode, read: SourceReader): string | undefined {
  let state = cache.get(schema);
  if (!state) {
    state = { provenance: new Map(schema.provenance.map(p => [p.id, p])), lines: new Map() };
    cache.set(schema, state);
  }

  for (const id of type.provenance) {
    const source = state.provenance.get(id);
    if (!source)
      continue;

    const key = `${source.package}/${source.file}`;
    if (!state.lines.has(key)) {
      const text = read(source.package, source.file);
      if (text !== undefined && createHash('sha256').update(text).digest('hex') !== source.sha256)
        throw new Error(`Pinned declaration hash mismatch: ${key}`);

      state.lines.set(key, text?.split(/\r?\n/));
    }

    const match = declaration.exec(state.lines.get(key)?.[source.start.line - 1]?.trim() ?? '');
    if (match)
      return match[1].replace(/\$\d+$/, '');
  }

  return undefined;
}
