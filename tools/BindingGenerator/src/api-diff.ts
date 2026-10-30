import type { ApiSchema, ApiRecord, TypeNode, Signature } from './schema.ts';
import { createSignatureHasher } from './validate-overrides.ts';
import { prepareComponentTypes } from './component-types.ts';
import { csharpConfigurationErrors, dynamicActionErrors, runtimeTriggerErrors, triggerSources } from './validate-mappings.ts';
import type { CSharpConfiguration } from './generation-model.ts';
import type { MappingOverrides } from './validate-overrides.ts';

export type ApiDiffCode =
  | 'ADDED_MEMBER' | 'REMOVED_MEMBER'
  | 'UNION_ALTERNATIVE_ADDED' | 'UNION_ALTERNATIVE_REMOVED'
  | 'OVERLOAD_ADDED' | 'OVERLOAD_REMOVED'
  | 'SIGNATURE_CHANGED' | 'DOCS_TYPE_CHANGED'
  | 'STALE_OVERRIDE' | 'STALE_API_DECISION';

export type ApiDiffResolution = 'unresolved' | 'requires-mapping' | 'requires-review' | 'rejected';
export type SemVerImpact = 'major' | 'minor' | 'patch';

export interface ApiDiffEntry {
  code: ApiDiffCode;
  recordId: string;
  publicPath?: string;
  detail: string;
  resolution: ApiDiffResolution;
  semver: SemVerImpact;
}

export interface ApiDiffReport {
  formatVersion: 1;
  before: ApiDiffSide;
  after: ApiDiffSide;
  summary: { entries: number; rejected: number; byCode: Partial<Record<ApiDiffCode, number>>; nested: number; semver: SemVerImpact };
  entries: ApiDiffEntry[];

  /** Records whose own contract is unchanged; their change is explained by the entries of nested records. */
  nested: string[];
}

interface ApiDiffSide {
  sources: { name: string; version: string }[];
  records: number;
  types: number;
}

const impact: Record<ApiDiffCode, [ApiDiffResolution, SemVerImpact]> = {
  ADDED_MEMBER: ['unresolved', 'minor'],
  REMOVED_MEMBER: ['requires-review', 'major'],
  UNION_ALTERNATIVE_ADDED: ['requires-mapping', 'minor'],
  UNION_ALTERNATIVE_REMOVED: ['requires-review', 'major'],
  OVERLOAD_ADDED: ['requires-mapping', 'minor'],
  OVERLOAD_REMOVED: ['requires-review', 'major'],
  SIGNATURE_CHANGED: ['requires-review', 'major'],
  DOCS_TYPE_CHANGED: ['requires-review', 'patch'],
  STALE_OVERRIDE: ['rejected', 'patch'],
  STALE_API_DECISION: ['rejected', 'patch'],
};

const rank: Record<SemVerImpact, number> = { patch: 0, minor: 1, major: 2 };

class Side {
  readonly types: Map<string, TypeNode>;
  readonly records: Map<string, ApiRecord>;
  readonly hash: (record: ApiRecord) => string;
  readonly schema: ApiSchema;

  constructor(schema: ApiSchema) {
    this.schema = schema;
    this.types = new Map(schema.types.map(t => [t.id, t]));
    this.records = new Map(schema.records.map(r => [r.id, r]));
    this.hash = createSignatureHasher(schema);
  }

  /** Property records of anonymous owners change ID with their content; the parent record reports them. */
  stable(record: ApiRecord): boolean {
    if (record.kind !== 'property')
      return true;

    const owner = this.types.get(record.id.slice('property:'.length, record.id.lastIndexOf('/')));
    return !!owner && named(owner);
  }

  /** Version-independent identity of a type: kinds, literals and names, never content-hash IDs. */
  key(id: string, depth = 0): string {
    const t = this.types.get(id);
    if (!t)
      return `missing:${id}`;

    if (depth > 3)
      return t.kind;

    switch (t.kind) {
      case 'literal':
        return `literal:${JSON.stringify(t.value)}`;
      case 'union':
        return `union{${t.alternatives!.map(a => this.key(a, depth + 1)).sort().join('|')}}`;
      case 'array':
        return `${t.readonly ? 'readonly ' : ''}array<${this.key(t.element!, depth + 1)}>`;
      case 'tuple':
        return `tuple[${t.elements!.map(e => `${e.rest ? '...' : ''}${this.key(e.type, depth + 1)}${e.optional ? '?' : ''}`).join(',')}]`;
      case 'object':
      case 'intersection':
        if (named(t))
          return `${t.kind}:${t.display}`;

        return `${t.kind}:{${members(t).join(',')}}${(t.signatures ?? []).map(s => this.signature(s, depth + 1)).sort().join('&')}`;
      default:
        return `${t.kind}:${t.display}`;
    }
  }

  signature(s: Signature, depth = 0): string {
    return `(${s.parameters.map(p => `${p.rest ? '...' : ''}${this.key(p.type, depth + 1)}${p.optional ? '?' : ''}`).join(',')})=>${this.key(s.returnType, depth + 1)}`;
  }

  /** Readable form for reports; matching always uses key(). */
  display(s: Signature): string {
    return `(${s.parameters.map(p => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${describe(this, p.type)}`).join(', ')}) => ${describe(this, s.returnType)}`;
  }

  alternatives(id: string): string[] {
    const t = this.types.get(id);
    return t?.kind === 'union' ? t.alternatives! : [id];
  }
}

const named = (t: TypeNode) => /^[A-Za-z_$][\w$.]*(?:<.*>)?$/.test(t.display);
const members = (t: TypeNode) => (t.properties ?? []).map(p => `${p.name}${p.optional ? '?' : ''}`).sort();
const describe = (side: Side, id: string) => side.types.get(id)?.display ?? id;

/**
 * Semantic diff of two extracted schemas. It classifies every change of the public contract
 * for review; `npm run api:check` remains the gate that proves the new schema is mapped.
 */
export function diffApi(beforeSchema: ApiSchema, afterSchema: ApiSchema, overrides?: unknown): ApiDiffReport {
  const before = new Side(beforeSchema);
  const after = new Side(afterSchema);
  const entries: ApiDiffEntry[] = [];
  const nested: string[] = [];
  const add = (code: ApiDiffCode, record: ApiRecord | string, detail: string) => {
    const [resolution, semver] = impact[code];
    const id = typeof record === 'string' ? record : record.id;
    entries.push({ code, recordId: id, ...(typeof record === 'string' ? {} : { publicPath: record.publicPath }), detail, resolution, semver });
  };

  for (const record of beforeSchema.records) {
    if (!before.stable(record))
      continue;

    const next = after.records.get(record.id);
    if (!next) {
      add('REMOVED_MEMBER', record, `${record.kind} ${record.name}: ${describe(before, record.type)}`);
      continue;
    }

    if (before.hash(record) === after.hash(next))
      continue;

    const count = entries.length;
    compareTypes(before, after, record, next, add);
    const docsBefore = JSON.stringify(record.inventory?.docsTypes ?? []);
    const docsAfter = JSON.stringify(next.inventory?.docsTypes ?? []);
    if (docsBefore !== docsAfter)
      add('DOCS_TYPE_CHANGED', next, `docs types ${docsBefore} -> ${docsAfter}`);

    if (entries.length === count) {
      if (before.key(record.type) === after.key(next.type) && edges(before, record) === edges(after, next))
        nested.push(record.id);
      else
        add('SIGNATURE_CHANGED', next, `${describe(before, record.type)} -> ${describe(after, next.type)}`);
    }
  }

  for (const record of afterSchema.records) {
    if (after.stable(record) && !before.records.has(record.id))
      add('ADDED_MEMBER', record, `${record.kind} ${record.name}: ${describe(after, record.type)}`);
  }

  if (overrides)
    staleOverrides(after, overrides, add);

  entries.sort((a, b) => `${a.code}\u0000${a.recordId}\u0000${a.detail}`.localeCompare(`${b.code}\u0000${b.recordId}\u0000${b.detail}`, 'en'));
  nested.sort();
  const byCode: Partial<Record<ApiDiffCode, number>> = {};
  for (const e of entries)
    byCode[e.code] = (byCode[e.code] ?? 0) + 1;

  const semver = entries.reduce<SemVerImpact>((max, e) => rank[e.semver] > rank[max] ? e.semver : max, 'patch');
  const side = (s: ApiSchema): ApiDiffSide =>
    ({ sources: s.sources.map(x => ({ name: x.name, version: x.version })), records: s.records.length, types: s.types.length });
  return {
    formatVersion: 1,
    before: side(beforeSchema),
    after: side(afterSchema),
    summary: { entries: entries.length, rejected: entries.filter(e => e.resolution === 'rejected').length, byCode, nested: nested.length, semver },
    entries,
    nested,
  };
}

function edges(side: Side, record: ApiRecord): string {
  if (record.kind !== 'property')
    return '';

  const owner = side.types.get(record.id.slice('property:'.length, record.id.lastIndexOf('/')));
  const property = owner?.properties?.find(p => p.name === record.name);
  return `${property?.optional}|${property?.readonly}`;
}

function compareTypes(
  before: Side,
  after: Side,
  record: ApiRecord,
  next: ApiRecord,
  add: (code: ApiDiffCode, record: ApiRecord, detail: string) => void
): void {
  const b = before.types.get(record.type);
  const a = after.types.get(next.type);
  if (!b || !a)
    return;

  if (b.kind === 'union' || a.kind === 'union') {
    const keysBefore = new Map(before.alternatives(record.type).map(id => [before.key(id), id]));
    const keysAfter = new Map(after.alternatives(next.type).map(id => [after.key(id), id]));
    const removed = [...keysBefore].filter(([k]) => !keysAfter.has(k));
    const added = [...keysAfter].filter(([k]) => !keysBefore.has(k));

    // An anonymous object alternative that only changed members is the same alternative.
    for (const [k, id] of [...removed]) {
      const t = before.types.get(id)!;
      if (named(t) || !['object', 'intersection'].includes(t.kind))
        continue;

      const match = added.findIndex(([, other]) => {
        const o = after.types.get(other)!;
        return o.kind === t.kind && !named(o);
      });
      if (match < 0)
        continue;

      compareMembers(before, after, t, after.types.get(added[match][1])!, next, add);
      removed.splice(removed.findIndex(([key]) => key === k), 1);
      added.splice(match, 1);
    }

    for (const [, id] of added)
      add('UNION_ALTERNATIVE_ADDED', next, describe(after, id));

    for (const [, id] of removed)
      add('UNION_ALTERNATIVE_REMOVED', next, describe(before, id));

    return;
  }

  const overloadsBefore = new Map((b.signatures ?? []).map(s => [before.signature(s), before.display(s)]));
  const overloadsAfter = new Map((a.signatures ?? []).map(s => [after.signature(s), after.display(s)]));
  if (overloadsBefore.size && overloadsAfter.size) {
    for (const [k, text] of overloadsAfter)
      if (!overloadsBefore.has(k))
        add('OVERLOAD_ADDED', next, text);

    for (const [k, text] of overloadsBefore)
      if (!overloadsAfter.has(k))
        add('OVERLOAD_REMOVED', next, text);
  }

  if (['object', 'intersection'].includes(b.kind) && b.kind === a.kind && !named(b) && !named(a))
    compareMembers(before, after, b, a, next, add);
}

function compareMembers(
  before: Side,
  after: Side,
  b: TypeNode,
  a: TypeNode,
  record: ApiRecord,
  add: (code: ApiDiffCode, record: ApiRecord, detail: string) => void
): void {
  const old = new Map((b.properties ?? []).map(p => [p.name, p]));
  const current = new Map((a.properties ?? []).map(p => [p.name, p]));
  for (const [name, p] of current)
    if (!old.has(name))
      add('ADDED_MEMBER', record, `${name}: ${describe(after, p.type)}`);

  for (const [name, p] of old)
    if (!current.has(name))
      add('REMOVED_MEMBER', record, `${name}: ${describe(before, p.type)}`);

  for (const [name, p] of current) {
    const q = old.get(name);
    if (q && (before.key(q.type) !== after.key(p.type) || q.optional !== p.optional || q.readonly !== p.readonly)) {
      add('SIGNATURE_CHANGED', record, `${name}: ${describe(before, q.type)} -> ${describe(after, p.type)}`);
    }
  }
}

/** Every override pinned to a record, signature or type must still match the new schema. */
function staleOverrides(after: Side, overrides: unknown, add: (code: ApiDiffCode, record: string, detail: string) => void): void {
  const root = overrides as { apiDecisions?: { recordId: string; previousSignature: string; currentSignature?: string }[] };
  const decisions = new Set(root.apiDecisions ?? []);
  for (const decision of decisions) {
    const change = after.schema.apiChanges?.find(
      c => c.recordId === decision.recordId && c.previousSignature === decision.previousSignature && c.currentSignature === decision.currentSignature
    );
    if (!change)
      add('STALE_API_DECISION', decision.recordId, 'apiDecisions entry does not match a pending change of the new schema');
  }

  const provenance = new Set(after.schema.provenance.map(p => `${p.package}|${p.version}|${p.file}|${p.sha256}`));

  // Component and graphic projections define synthetic types; their pins are verified while projecting.
  let types: Map<string, TypeNode> = after.types;
  const csharp = (overrides as { csharp?: CSharpConfiguration }).csharp;
  if (csharp) {
    try {
      types = prepareComponentTypes(after.schema, csharp);
    } catch (error) {
      add('STALE_OVERRIDE', 'csharp', `component projection: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Content pins (sha256, expectedTypeId) and names change without a record ID changing.
    for (const error of csharpConfigurationErrors(after.schema, csharp))
      add('STALE_OVERRIDE', 'csharp', error);

    for (const error of dynamicActionErrors(after.schema, overrides as MappingOverrides))
      add('STALE_OVERRIDE', 'dynamicActions', error);

    // The extracted upstream sources belong to the new release; a schema without the pinned core source has no triggers to decide.
    if (after.schema.sources.some(s => s.name === 'echarts' && s.files.some(f => triggerSources.includes(f.path))))
      for (const error of runtimeTriggerErrors(after.schema, overrides as MappingOverrides))
        add('STALE_OVERRIDE', 'runtimeTriggers', error);
  }

  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }

    if (!value || typeof value !== 'object' || decisions.has(value as never))
      return;

    const o = value as Record<string, unknown>;
    if (typeof o.recordId === 'string' && o.recordId) {
      const record = after.records.get(o.recordId);
      if (!record)
        add('STALE_OVERRIDE', o.recordId, `${path}: record is absent from the new schema`);
      else if (typeof o.expectedSignature === 'string' && after.hash(record) !== o.expectedSignature)
        add('STALE_OVERRIDE', o.recordId, `${path}: pinned signature changed`);

      const source = o.source as Record<string, string> | undefined;
      if (record
        && source
        && typeof source === 'object'
        && 'sha256' in source
        && !provenance.has(`${source.package}|${source.version}|${source.file}|${source.sha256}`)) {
        add('STALE_OVERRIDE', o.recordId, `${path}: pinned source ${source.package}@${source.version} ${source.file} is not in the new schema`);
      }
    }

    if (typeof o.typeId === 'string' && o.typeId.startsWith('type:') && !types.has(o.typeId))
      add('STALE_OVERRIDE', o.typeId, `${path}: type is absent from the new schema`);

    for (const [k, v] of Object.entries(o))
      if (v && typeof v === 'object')
        visit(v, path ? `${path}.${k}` : k);
  };
  visit(overrides, '');
}
