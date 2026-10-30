import { readFileSync } from 'node:fs';
import type { ApiSchema, ApiRecord, Provenance, TypeNode } from './schema.ts';
import { hash } from './resolve-types.ts';
import { createSignatureHasher } from './validate-overrides.ts';

export interface DocumentationEntry {
  path: string;
  category: string;
  types: string[];
  source: Provenance;
  defaultValue?: unknown;
  examples?: string[];
  descriptionHash?: string;
  sourceUrl?: string;
}

export interface DocumentationSnapshot {
  formatVersion: 1;
  commit: string;
  entries: DocumentationEntry[];
}

export interface ReconciliationReport {
  matched: string[];
  docsOnly: string[];
  declarationsOnly: string[];
  conflicting: { path: string; docsTypes: string[]; declarationTypes: string[]; provenance: string[] }[];
}

export function exportRecord(schema: ApiSchema, name: string): ApiRecord | undefined {
  return schema.records.find(r => r.kind === 'export' && r.name === name && r.publicPath.startsWith('echarts/types/dist/all.d.ts::'))
    ?? schema.records.find(r => r.kind === 'export' && r.name === name);
}

/** Finite graph traversal. Array/union/generic edges are transparent to option paths. */
export function graphView(schema: ApiSchema) {
  const types = new Map(schema.types.map(t => [t.id, t]));
  const records = new Map(schema.records.map(r => [r.id, r]));
  const exports = new Map<string, ApiRecord>();
  for (const r of schema.records.filter(r => r.kind === 'export')) {
    if (!exports.has(r.name) || r.publicPath.startsWith('echarts/types/dist/all.d.ts::'))
      exports.set(r.name, r);
  }

  const expand = (ids: string[], seen = new Set<string>()): TypeNode[] => ids.flatMap(id => {
    if (seen.has(id))
      return [];

    seen.add(id);
    const t = types.get(id)!;
    if (!t)
      return [];

    const children = t.alternatives ?? t.constituents ?? (t.kind === 'array' ? [t.element!] : t.kind === 'generic-reference' ? [t.target!] : []);
    return [t, ...expand(children, seen)];
  });
  const propertyCache = new Map<string, ReturnType<typeof properties>>();
  const properties = (ids: string[], name: string) =>
    expand(ids).flatMap(t => (t.properties ?? []).filter(p => p.name === name).map(p => ({ parent: t.id, ...p })));
  const property = (ids: string[], name: string) => {
    const key = JSON.stringify([ids, name]);
    if (!propertyCache.has(key))
      propertyCache.set(key, properties(ids, name));

    return propertyCache.get(key)!;
  };
  const shapes = (ids: string[]): string[] => [
    ...new Set(ids.flatMap((id): string[] => {
      const t = types.get(id)!;
      if (t.kind === 'union')
        return shapes(t.alternatives!);

      if (t.kind === 'literal')
        return [typeof t.value];

      if (t.signatures?.length || t.constructSignatures?.length)
        return ['Function'];

      if (t.kind === 'array' || t.kind === 'tuple')
        return ['Array'];

      if (['object', 'intersection', 'generic-reference', 'non-primitive', 'external'].includes(t.kind))
        return ['Object'];

      return [t.kind];
    })),
  ].filter(k => !['undefined', 'never'].includes(k)).sort();
  return { types, records, exports, expand, property, shapes };
}

export function findDeclaration(schema: ApiSchema, entry: DocumentationEntry, graph = graphView(schema)): ApiRecord[] {
  const segments = entry.path.split('.');
  const root = segments.shift()!;
  let ids: string[] = [];
  let result: ApiRecord[] = [];
  if (root === 'option') {
    ids = [graph.exports.get('EChartsOption')?.type ?? ''];
    if (segments[0] === 'series' && segments.length > 1) {
      const series = schema.series.find(s => s.name === segments[1]);
      if (series) {
        ids = [series.type];
        segments.splice(0, 2);
        const registry = graph.records.get(series.registry)!;
        const member = graph.records.get(`property:${registry.type}/${encodeURIComponent(series.name)}`);
        if (member)
          result = [member];
      }
    }
  } else if (root === 'echartsInstance')
    ids = [graph.exports.get('ECharts')?.type ?? ''];
  else if (root === 'echarts') {
    const record = graph.exports.get(segments.shift()!);
    if (!record)
      return [];

    if (!segments.length)
      return [record];

    ids = [record.type];
  } else
    return [];

  for (const segment of segments) {
    let properties = graph.property(ids, segment);

    // Docs use discriminated sections such as visualMap.piecewise and dataZoom.inside.
    if (!properties.length) {
      const variants = graph.expand(ids).filter(
        t => (t.properties ?? []).some(p => p.name === 'type' && graph.expand([p.type]).some(n => n.value === segment))
      );
      if (variants.length) {
        ids = variants.map(t => t.id);
        continue;
      }
    }

    result = properties.flatMap(p => {
      const r = graph.records.get(`property:${p.parent}/${encodeURIComponent(p.name)}`);
      return r ? [r] : [];
    });
    ids = properties.map(p => p.type);
    if (!ids.length)
      return [];
  }

  return [...new Map(result.map(r => [r.id, r])).values()];
}

export function reconcileDocumentation(schema: ApiSchema, docsSnapshotPath: string): ReconciliationReport {
  const snapshot: DocumentationSnapshot = JSON.parse(readFileSync(docsSnapshotPath, 'utf8'));
  if (snapshot.formatVersion !== 1 || !snapshot.commit || !snapshot.entries.length)
    throw new Error('Invalid documentation snapshot');

  const report: ReconciliationReport = { matched: [], conflicting: [], docsOnly: [], declarationsOnly: [] };
  const graph = graphView(schema);
  const matched = new Set<string>();
  const recordIds = new Set(schema.records.map(r => r.id));
  const spans = new Set(schema.provenance.map(p => p.id));
  const unknownId = 'type:documentation-unknown';
  if (!graph.types.has(unknownId))
    schema.types.push({ id: unknownId, kind: 'unknown', display: 'unknown (documentation has no semantic declaration)', provenance: [] });

  for (const entry of snapshot.entries) {
    const id = `public:${entry.path}`;
    const declarations = findDeclaration(schema, entry, graph);
    declarations.forEach(r => matched.add(r.id));
    const declarationTypes = declarations.length ? graph.shapes(declarations.map(r => r.type)) : [];
    const docsTypes = entry.types.map(t => ({ String: 'string', Boolean: 'boolean', Number: 'number' }[t] ?? t)).sort();
    const conflict = declarations.length > 0 && docsTypes.some(t => !['*', 'Event', 'Action', 'any', 'unknown'].includes(t)
      && !declarationTypes.includes(t)
      && !declarationTypes.some(k => ['any', 'unknown', 'unsupported'].includes(k)));
    const sourceId = `source:${hash(JSON.stringify(entry.source)).slice(0, 24)}`;
    if (!spans.has(sourceId)) {
      schema.provenance.push({ id: sourceId, ...entry.source });
      spans.add(sourceId);
    }

    const provenance = [...new Set([sourceId, ...declarations.flatMap(r => r.provenance)])];
    const alternatives = [...new Set(declarations.map(r => r.type))].sort();
    let resolvedType = alternatives[0] ?? unknownId;
    if (alternatives.length > 1) {
      resolvedType = `type:reconciled-union:${hash(JSON.stringify(alternatives)).slice(0, 24)}`;
      let union = graph.types.get(resolvedType);
      if (!union) {
        union = {
          id: resolvedType,
          kind: 'union',
          display: alternatives.map(id => graph.types.get(id)!.display).join(' | '),
          alternatives,
          provenance: [],
        };
        schema.types.push(union);
        graph.types.set(resolvedType, union);
      }

      union.provenance = [...new Set([...union.provenance, ...provenance])].sort();
    }

    const state = !declarations.length ? 'docs-only' : conflict ? 'conflicting' : 'matched';
    if (state === 'docs-only')
      report.docsOnly.push(entry.path);
    else if (state === 'matched')
      report.matched.push(entry.path);
    else
      report.conflicting.push({ path: entry.path, docsTypes, declarationTypes, provenance });

    const kind = entry.category === 'event' || entry.category === 'action'
      ? entry.category
      : entry.category.endsWith('method') ? 'method' : entry.category === 'graphic' ? 'graphic' : 'documented';
    const family = familyFor(entry.path, entry.category);
    const requirements = entry.category === 'event' ? ['event-payload'] : entry.category === 'action' ? ['action-payload'] : [];
    const record: ApiRecord = {
      id,
      kind,
      name: entry.path.split('.').at(-1)!,
      publicPath: entry.path,
      canonicalId: id,
      type: resolvedType,
      provenance,
      family,
      status: 'unresolved',
      implementationReferences: [],
      testReferences: [],
      inventory: {
        category: entry.category,
        requirements,
        declarationIds: declarations.map(r => r.id),
        reconciliation: state,
        docsTypes,
        declarationTypes,
        ...(entry.defaultValue !== undefined ? { defaultValue: entry.defaultValue } : {}),
        ...(entry.examples ? { examples: entry.examples } : {}),
        ...(entry.descriptionHash ? { descriptionHash: entry.descriptionHash } : {}),
        ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
      },
    };
    if (recordIds.has(id)) {
      const existing = schema.records.find(r => r.id === id)!;
      Object.assign(existing, {
        ...record,
        status: existing.status,
        implementationReferences: existing.implementationReferences,
        testReferences: existing.testReferences,
      });
    } else {
      schema.records.push(record);
      recordIds.add(id);
    }
  }

  report.declarationsOnly = schema.records.filter(r => !r.inventory && !matched.has(r.id)).map(r => r.id).sort();
  return report;
}

export function familyFor(path: string, category: string): string {
  if (category === 'event' || category === 'action')
    return 'events-actions';

  if (category === 'instance-method')
    return 'instance-methods';

  if (category === 'global-method')
    return 'global-methods';

  if (path.startsWith('echarts.graphic') || path.startsWith('option.graphic') || path.startsWith('option.series.custom.renderItem'))
    return 'graphic-custom';

  if (path.startsWith('option.series.'))
    return ['tree', 'treemap', 'sunburst', 'graph', 'chord', 'custom'].includes(path.split('.')[2]) ? 'advanced-series' : 'standard-series';

  return 'components-coordinate';
}

export function compareApi(before: ApiSchema, after: ApiSchema) {
  const old = new Map(before.records.map(r => [r.id, r]));
  const current = new Map(after.records.map(r => [r.id, r]));
  const changes: { code: string; recordId: string; requiresDecision: boolean }[] = [];
  const clean = (value: unknown): string => JSON.stringify(value, (key, v) => key === 'provenance' ? undefined : v);
  const beforeTypes = new Map(before.types.map(t => [t.id, clean(t)]));
  const afterIds = new Set(after.types.map(t => t.id));
  const changed = new Set(after.types.filter(t => beforeTypes.get(t.id) !== clean(t)).map(t => t.id));
  for (const t of before.types)
    if (!afterIds.has(t.id))
      changed.add(t.id);

  const parents = new Map<string, Set<string>>();
  const visit = (value: unknown, parent: string): void => {
    if (typeof value === 'string' && beforeTypes.has(value) && value !== parent) {
      if (!parents.has(value))
        parents.set(value, new Set());

      parents.get(value)!.add(parent);
    } else if (Array.isArray(value))
      value.forEach(v => visit(v, parent));
    else if (value && typeof value === 'object')
      Object.entries(value).filter(([k]) => k !== 'provenance').forEach(([, v]) => visit(v, parent));
  };
  for (const t of [...before.types, ...after.types])
    visit(t, t.id);

  const queue = [...changed];
  for (let i = 0; i < queue.length; i++)
    for (const parent of parents.get(queue[i]) ?? [])
      if (!changed.has(parent)) {
        changed.add(parent);
        queue.push(parent);
      }

  const docsContract = (record: ApiRecord) => clean({ docsTypes: record.inventory?.docsTypes, examples: record.inventory?.examples });
  for (const record of before.records) {
    const next = current.get(record.id);
    if (!next)
      changes.push({ code: 'API_REMOVED', recordId: record.id, requiresDecision: true });
    else if (record.type !== next.type
      || changed.has(record.type)
      || record.exportSpace !== next.exportSpace
      || docsContract(record) !== docsContract(next))
      changes.push({ code: 'SIGNATURE_CHANGED', recordId: record.id, requiresDecision: true });
  }

  for (const record of after.records)
    if (!old.has(record.id))
      changes.push({ code: 'API_ADDED', recordId: record.id, requiresDecision: true });

  return changes;
}

/** Pending removals/signature changes survive a second extraction until explicitly reviewed. */
export function preserveApiChanges(before: ApiSchema, after: ApiSchema): void {
  const pending = new Map((before.apiChanges ?? []).map(c => [`${c.code}:${c.recordId}:${c.previousSignature}:${c.currentSignature}`, c]));
  const old = new Map(before.records.map(r => [r.id, r]));
  const current = new Map(after.records.map(r => [r.id, r]));
  const beforeHash = createSignatureHasher(before);
  const afterHash = createSignatureHasher(after);
  for (const change of compareApi(before, after).filter(c => c.code !== 'API_ADDED')) {
    const previousSignature = beforeHash(old.get(change.recordId)!);
    const next = current.get(change.recordId);
    const currentSignature = next ? afterHash(next) : undefined;
    const key = `${change.code}:${change.recordId}:${previousSignature}:${currentSignature}`;
    if (!pending.has(key))
      pending.set(key, { ...change, previousSignature, ...(currentSignature ? { currentSignature } : {}) });
  }

  after.apiChanges = [...pending.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}
