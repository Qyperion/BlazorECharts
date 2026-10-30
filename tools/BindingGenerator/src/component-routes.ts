import type { TypeNode } from './schema.ts';

export interface ComponentEdge {
  parent: string;
  name: string;
  type: string;
}

/** Resolve author-facing docs paths, including variant headings and typed index placeholders. */
export function componentRoute(
  types: Map<string, TypeNode>,
  root: string,
  path: string,
  variants: Record<string, string[]> = {},
  aliases: { path: string; target: string }[] = []
): ComponentEdge[] {
  const alias = aliases.filter(a => path === a.path || path.startsWith(a.path + '.')).sort((a, b) => b.path.length - a.path.length)[0];
  if (alias)
    path = alias.target + path.slice(alias.path.length);

  const expand = (ids: string[], seen = new Set<string>()): TypeNode[] => ids.flatMap(id => {
    if (seen.has(id))
      return [];

    seen.add(id);
    const t = types.get(id);
    if (!t)
      return [];

    const next = t.kind === 'union' ? t.alternatives : t.kind === 'array' ? [t.element!]
      : t.kind === 'generic-reference' ? [t.target!] : [];
    return [t, ...expand(next ?? [], seen)];
  });
  let ids = [root];
  let edges: ComponentEdge[] = [];
  let prefix = 'option';
  for (const segment of path.replace(/^option\./, '').split('.')) {
    prefix += '.' + segment;
    if (variants[prefix]) {
      ids = variants[prefix];
      edges = ids.map(id => ({ parent: id, name: '@', type: id }));
      continue;
    }

    const nodes = expand(ids);

    // A discriminator wins over a same-named property on a different series (notably map).
    const discriminated = nodes.filter(t => t.properties?.some(p => p.name === 'type' && expand([p.type]).some(a => a.value === segment)));
    if (prefix.split('.').length === 3 && prefix.startsWith('option.series.') && discriminated.length) {
      ids = discriminated.map(t => t.id);
      edges = ids.map(id => ({ parent: id, name: '@', type: id }));
      continue;
    }

    edges = nodes.flatMap(t => t.properties?.filter(p => p.name === segment).map(p => ({ parent: t.id, name: p.name, type: p.type })) ?? []);
    if (!edges.length && /^\d+$/.test(segment))
      edges = nodes.flatMap(
        t => t.kind === 'tuple' && t.elements?.[Number(segment)] ? [{ parent: t.id, name: segment, type: t.elements[Number(segment)].type }] : []
      );

    if (!edges.length && /^<.+>$/.test(segment))
      edges = nodes.flatMap(t => t.indexes?.map(i => ({ parent: t.id, name: '*', type: i.value })) ?? []);

    if (!edges.length) {
      const variants = nodes.filter(t => t.properties?.some(p => p.name === 'type' && expand([p.type]).some(a => a.value === segment)));
      if (variants.length) {
        ids = variants.map(t => t.id);
        edges = variants.map(t => ({ parent: t.id, name: '@', type: t.id }));
        continue;
      }

      return [];
    }

    ids = edges.map(p => p.type);
  }

  return [...new Map(edges.map(e => [e.parent + '/' + e.name, e])).values()];
}
