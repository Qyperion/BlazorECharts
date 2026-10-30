import { existsSync } from 'node:fs';
import type { ApiSchema, ApiRecord, Provenance } from './schema.ts';
import { hash } from './resolve-types.ts';
import type { CSharpConfiguration } from './generation-model.ts';
import type { EventActionMapping, EventActionObject } from './emit-events-actions.ts';
import type { InstanceMethodMapping } from './instance-methods.ts';

export interface MappingOverride {
  recordId: string;
  expectedSignature: string;
  reason: string;
  source: Provenance;
  sourceUrl: string;
  regressionFixture: string;
  requirements: string[];
  exclusion?: { boundary: string; reason: string };
  runtimeName?: string;
}

export interface MappingOverrides {
  formatVersion: 1;
  mappings: MappingOverride[];
  apiDecisions?: { recordId: string; previousSignature: string; currentSignature?: string; reason: string }[];
  csharp?: CSharpConfiguration;
  eventActions?: EventActionMapping[];
  eventActionObjects?: EventActionObject[];
  instanceMethods?: InstanceMethodMapping[];
  scope?: import('./scope-categories.ts').ScopeOverrides;
  globalMethods?: import('./global-methods.ts').GlobalMapping[];

  /** One decision per dynamic registerAction site of the pinned runtime: the actions it registers that are typed, and those excluded with the reason.
   * */
  dynamicActions?: { source: string; site: string; typed: string[]; excluded: string[]; reason: string }[];

  /** Chart events that the pinned core triggers by name (validate-mappings.ts runtimeTriggerErrors) and that are not typed, with the reason. */
  runtimeTriggers?: { event: string; reason: string }[];
}

/** Hash the reachable semantic graph, including overloads and union alternatives, without source offsets. */
export function signatureHash(schema: ApiSchema, record: ApiRecord): string {
  return createSignatureHasher(schema)(record);
}

/** Reuse graph indexes during a batch without caching contracts across mutable schemas. */
export function createSignatureHasher(schema: ApiSchema): (record: ApiRecord) => string {
  const types = new Map(schema.types.map(t => [t.id, t]));
  const records = new Map(schema.records.map(r => [r.id, r]));
  return record => {
    const seen = new Set<string>();
    const visit = (value: unknown, key = ''): unknown => {
      if (key === 'provenance' || key === 'id')
        return undefined;

      if (typeof value === 'string' && types.has(value)) {
        if (seen.has(value))
          return { reference: value };

        seen.add(value);
        return visit(types.get(value));
      }

      if (Array.isArray(value))
        return value.map(v => visit(v));

      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'provenance' && k !== 'id').map(([k, v]) => [k, visit(v, k)]));

      return value;
    };
    const edges = [record, ...(record.inventory?.declarationIds ?? []).map(id => records.get(id)!)].filter(r => r.kind === 'property').map(r => {
      const parentId = r.id.slice('property:'.length, r.id.lastIndexOf('/'));
      const property = types.get(parentId)?.properties?.find(p => p.name === r.name);
      return { id: r.id, optional: property?.optional, readonly: property?.readonly };
    });
    return hash(JSON.stringify({
      contract: visit(record.type),
      docsTypes: record.inventory?.docsTypes,
      examples: record.inventory?.examples,
      ...(edges.length ? { edges } : {}),
    }));
  };
}

export function validateExclusion(exclusion: { boundary: string; reason: string }, record?: ApiRecord): void {
  if (!['R8', 'R9', 'R10', 'internal/non-public'].includes(exclusion.boundary) || !exclusion.reason.trim())
    throw new Error('Exclusion needs an allowed boundary and reason');

  if (record) {
    const path = record.publicPath;
    const allowed = exclusion.boundary === 'R8'
      ? /(?:^|\/)ssr\//.test(path)
      : exclusion.boundary === 'R9' ? /(?:^|\/)extension\//.test(path) && !path.includes('wordcloud')
        : exclusion.boundary === 'R10' ? /^(?:echarts\.zrender(?:\.|$)|zrender\/)/.test(path) : path.startsWith('internal:');
    if (!allowed)
      throw new Error(`Exclusion boundary does not cover public contract: ${path}`);
  }
}

/**
 * Validates and applies signature-pinned overrides. `onStale` is only for the first extraction of an
 * upstream upgrade: stale entries are reported and skipped, so the new schema can be diffed and re-pinned.
 */
export function validateOverrides(schema: ApiSchema, overrides: MappingOverrides, apply = true, onStale?: (message: string) => void): void {
  if (overrides.formatVersion !== 1)
    throw new Error('Invalid overrides version');

  const stale = (message: string) => {
    if (!onStale)
      throw new Error(message);

    onStale(message);
  };
  const seen = new Set<string>();
  const hash = createSignatureHasher(schema);
  const records = new Map(schema.records.map(r => [r.id, r]));
  for (const mapping of overrides.mappings) {
    if (seen.has(mapping.recordId))
      throw new Error(`Duplicate override: ${mapping.recordId}`);

    seen.add(mapping.recordId);
    const record = records.get(mapping.recordId);
    if (!record || hash(record) !== mapping.expectedSignature) {
      stale(`Stale override: ${mapping.recordId}`);
      continue;
    }

    if (!mapping.reason.trim()
      || !mapping.source.version
      || !mapping.source.file
      || !mapping.source.sha256
      || !mapping.sourceUrl
      || !existsSync(mapping.regressionFixture))
      throw new Error(`Override lacks source/version/rationale/regression fixture: ${mapping.recordId}`);

    if (!schema.provenance.some(p => p.package === mapping.source.package
      && p.version === mapping.source.version
      && p.file === mapping.source.file
      && p.sha256 === mapping.source.sha256)) {
      stale(`Override source is not verified: ${mapping.recordId}`);
      continue;
    }

    if (mapping.exclusion)
      validateExclusion(mapping.exclusion, record);

    if (!apply)
      continue;

    if (mapping.exclusion)
      record.status = 'out-of-scope';

    record.inventory ??= { category: 'manual-contract', declarationIds: [], requirements: [] };
    record.inventory.requirements = [...new Set([...record.inventory.requirements, ...mapping.requirements])].sort();
    if (mapping.exclusion)
      record.inventory.exclusion = mapping.exclusion;

    if (mapping.runtimeName)
      record.inventory.runtimeName = mapping.runtimeName;
  }

  for (const decision of overrides.apiDecisions ?? []) {
    const change = schema.apiChanges?.find(
      c => c.recordId === decision.recordId && c.previousSignature === decision.previousSignature && c.currentSignature === decision.currentSignature
    );
    if (!decision.reason.trim())
      throw new Error(`Stale or unexplained API decision: ${decision.recordId}`);

    if (!change) {
      stale(`Stale or unexplained API decision: ${decision.recordId}`);
      continue;
    }

    if (apply) {
      change.requiresDecision = false;
      change.decision = decision.reason;
    }
  }
}
