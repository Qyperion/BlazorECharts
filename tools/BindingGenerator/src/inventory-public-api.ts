import type { ApiSchema, ApiRecord } from './schema.ts';
import { exportRecord, graphView } from './reconcile-docs.ts';

/** Inventory requirements do not imply implemented mapping coverage. */
export function inventoryPublicApi(schema: ApiSchema): void {
  const graph = graphView(schema);
  const records = new Map(schema.records.map(r => [r.id, r]));
  const add = (path: string, category: string, type: string, provenance: string[], declarationIds: string[], requirements: string[] = []) => {
    const id = `public:${path}`;
    const old = records.get(id);
    const kind = category.includes('method') ? 'method' : category === 'graphic' ? 'graphic' : category === 'series' ? 'series' : 'contract';
    if (!old) {
      const record: ApiRecord = {
        id,
        kind,
        name: path.split('.').at(-1)!,
        publicPath: path,
        canonicalId: id,
        type,
        provenance,
        family: category === 'instance-method'
          ? 'instance-methods'
          : category === 'global-method' ? 'global-methods' : category === 'graphic' || category === 'custom-renderItem'
            ? 'graphic-custom'
            : category === 'series' ? 'series' : 'function-browser-contracts',
        status: 'unresolved',
        implementationReferences: [],
        testReferences: [],
        inventory: { category, declarationIds, requirements, reconciliation: 'declarations-only' },
      };
      schema.records.push(record);
      records.set(id, record);
    } else {
      old.inventory!.requirements = [...new Set([...old.inventory!.requirements, ...requirements])].sort();
    }
  };
  const requirementsCache = new Map<string, string[]>();
  const requirements = (type: string) => {
    if (requirementsCache.has(type))
      return requirementsCache.get(type)!;

    const seen = new Set<string>();
    const found = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id))
        return;

      seen.add(id);
      const t = graph.types.get(id)!;
      if (t.kind === 'external')
        found.add('browser-reference');

      if (t.kind === 'any' || t.kind === 'unknown')
        found.add('open-value');

      if (t.signatures?.length || t.constructSignatures?.length)
        found.add('function-binding');

      for (const child of [
        ...(t.alternatives ?? []),
        ...(t.constituents ?? []),
        ...(t.typeArguments ?? []),
        ...(t.element ? [t.element] : []),
        ...(t.target ? [t.target] : []),
        ...(t.signatures ?? []).flatMap(s => [s.returnType, ...s.parameters.map(p => p.type)]),
      ])
        visit(child);
    };
    visit(type);
    const result = [...found].sort();
    requirementsCache.set(type, result);
    return result;
  };
  const instance = exportRecord(schema, 'ECharts');
  for (const property of graph.types.get(instance?.type ?? '')?.properties ?? []) {
    const t = graph.types.get(property.type)!;
    const path = `echartsInstance.${property.name}`;
    add(
      path,
      t.signatures?.length ? 'instance-method' : 'instance-property',
      property.type,
      property.provenance,
      [`property:${instance!.type}/${encodeURIComponent(property.name)}`],
      requirements(property.type)
    );
  }

  const exports = schema.records.filter(
    r => r.kind === 'export' && (r.publicPath.startsWith('echarts/types/dist/all.d.ts::') || !schema.sources.some(s => s.name === 'echarts'))
  );
  for (const r of exports) {
    const t = graph.types.get(r.type)!;
    const tail = r.publicPath.split('::').at(-1)!;
    if (t.signatures?.length && r.exportSpace === 'value')
      add(`echarts.${tail}`, tail.startsWith('graphic.') ? 'graphic' : 'global-method', r.type, r.provenance, [r.id], requirements(r.type));

    if (r.exportSpace === 'namespace' && tail !== 'zrender')
      for (const p of t.properties ?? []) {
        const child = graph.types.get(p.type)!;
        if (child.signatures?.length)
          add(
            `echarts.${tail}.${p.name}`,
            tail === 'graphic' ? 'graphic' : 'global-method',
            p.type,
            p.provenance,
            [`property:${r.type}/${encodeURIComponent(p.name)}`],
            requirements(p.type)
          );
      }
  }

  for (const [name, category, prefix] of [
    ['graphic', 'graphic', 'echarts.graphic'],
    ['CustomSeriesRenderItemAPI', 'custom-renderItem', 'custom.renderItem.api'],
  ] as const) {
    const r = exportRecord(schema, name);
    if (!r)
      continue;

    for (const p of graph.types.get(r.type)!.properties ?? [])
      add(
        `${prefix}.${p.name}`,
        category,
        p.type,
        p.provenance,
        [`property:${r.type}/${encodeURIComponent(p.name)}`],
        requirements(p.type)
      );
  }

  for (const series of schema.series) {
    const registry = schema.records.find(r => r.id === series.registry)!;
    add(`series.${series.name}`, 'series', series.type, registry.provenance, [registry.id], []);
  }

  // Every callable/native type is visible even when reached through a non-option public facade.
  for (const t of schema.types)
    if ((t.signatures?.length || t.constructSignatures?.length || t.kind === 'external') && t.provenance.length) {
      add(`contract.${t.id}`, 'function-browser-contract', t.id, t.provenance, [], requirements(t.id));
    }

  for (const record of schema.records.filter(r => r.inventory))
    record.inventory!.requirements = [...new Set([...record.inventory!.requirements, ...requirements(record.type)])].sort();
}
