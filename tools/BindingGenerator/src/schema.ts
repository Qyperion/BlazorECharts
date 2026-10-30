import { readFileSync, statSync } from 'node:fs';
import { readShardedJson, shardJson, writeShardedJson } from './sharded-json.ts';

export interface Provenance {
  package: string;
  version: string;
  file: string;
  sha256: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export interface Source {
  name: string;
  version: string;
  sha256: string;
  integrityKind: 'archive' | 'file-set';
  url?: string;
  integrity?: string;
  upstreamCommit?: string;
  files: { path: string; sha256: string }[];
}

export interface PublicRoot {
  package: string;
  exportPath: string;
  conditions: string[];
  target: string;
  declaration?: string;
  status: 'declaration' | 'declaration-gap' | 'internal-projection';
  reason?: string;
}

export interface Parameter {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
}

export interface TypeParameter {
  name: string;
  type: string;
  constraint?: string;
  default?: string;
}

export interface Signature {
  parameters: Parameter[];
  returnType: string;
  typeParameters: TypeParameter[];
  thisType?: string;
  provenance: string[];
}

export interface Property {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  provenance: string[];
}

export interface TypeNode {
  id: string;
  kind: string;
  display: string;
  provenance: string[];
  value?: string | number | boolean;
  name?: string;
  element?: string;
  alternatives?: string[];
  constituents?: string[];
  typeArguments?: string[];
  properties?: Property[];
  signatures?: Signature[];
  constructSignatures?: Signature[];
  indexes?: { key: string; value: string; readonly: boolean }[];
  elements?: { type: string; label?: string; optional: boolean; rest: boolean }[];
  readonly?: boolean;
  minLength?: number;
  fixedLength?: number;
  constraint?: string;
  default?: string;
  checkType?: string;
  extendsType?: string;
  trueType?: string;
  falseType?: string;
  objectType?: string;
  indexType?: string;
  typeParameters?: TypeParameter[];
  target?: string;
  baseType?: string;
}

export type MappingStatus = 'generated' | 'manual-mapped' | 'browser-reference' | 'unresolved' | 'out-of-scope';

export interface InventoryMetadata {
  category: string;
  requirements: string[];
  declarationIds: string[];
  reconciliation?: 'matched' | 'conflicting' | 'docs-only' | 'declarations-only';
  docsTypes?: string[];
  declarationTypes?: string[];
  defaultValue?: unknown;
  examples?: string[];
  descriptionHash?: string;
  sourceUrl?: string;
  runtimeName?: string;
  exclusion?: { boundary: string; reason: string };
}

export interface ApiRecord {
  id: string;
  kind: 'export' | 'definition' | 'property' | 'documented' | 'event' | 'action' | 'method' | 'graphic' | 'contract' | 'series';
  name: string;
  publicPath: string;
  canonicalId: string;
  type: string;
  provenance: string[];
  family: string;
  status: MappingStatus;
  implementationReferences: string[];
  testReferences: string[];
  inventory?: InventoryMetadata;
  exportSpace?: 'type' | 'value' | 'namespace';
}

export interface Diagnostic {
  code: string;
  message: string;
  type?: string;
  provenance: string[];
}

export interface ApiChange {
  code: string;
  recordId: string;
  requiresDecision: boolean;
  previousSignature: string;
  currentSignature?: string;
  decision?: string;
}

export interface ApiSchema {
  formatVersion: 1;
  compilerVersion: string;
  sources: Source[];
  roots: PublicRoot[];
  records: ApiRecord[];
  types: TypeNode[];
  provenance: (Provenance & { id: string })[];
  series: { name: string; type: string; discriminator: string[]; registry: string }[];
  diagnostics: Diagnostic[];
  apiChanges?: ApiChange[];
}

/** Whether a record is described by the pinned echarts-doc snapshot, the documented API boundary. */
export function documentedRecords(schema: ApiSchema): (record: ApiRecord) => boolean {
  const docs = new Set(schema.provenance.filter(p => p.package === 'echarts-doc').map(p => p.id));
  return record => record.provenance.some(id => docs.has(id));
}

const compare = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function normalizeSchema(schema: ApiSchema): ApiSchema {
  schema.records.sort(compare);
  schema.types.sort(compare);
  schema.provenance.sort(compare);
  schema.roots.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  schema.sources.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const source of schema.sources)
    source.files.sort((a, b) => a.path.localeCompare(b.path, 'en'));

  schema.series.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  schema.diagnostics.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  return schema;
}

export function validateSchema(schema: ApiSchema): void {
  if (schema.formatVersion !== 1 || !schema.compilerVersion || !schema.records.length)
    throw new Error('Invalid ApiSchema header/empty inventory');

  const types = new Set(schema.types.map(t => t.id));
  const records = new Set(schema.records.map(r => r.id));
  const provenance = new Set(schema.provenance.map(p => p.id));
  if (types.size !== schema.types.length || records.size !== schema.records.length || provenance.size !== schema.provenance.length)
    throw new Error('Duplicate stable ID');

  const referenceFields = new Set([
    'type', 'element', 'returnType', 'target', 'constraint', 'default', 'checkType', 'extendsType', 'trueType', 'falseType', 'objectType',
    'indexType', 'baseType', 'thisType', 'alternatives', 'constituents', 'typeArguments', 'key',
  ]);
  const visit = (value: unknown, key = ''): void => {
    if (referenceFields.has(key) && typeof value === 'string' && !types.has(value))
      throw new Error(`Dangling type reference: ${value}`);

    if (key === 'provenance' && typeof value === 'string' && !provenance.has(value))
      throw new Error(`Dangling provenance reference: ${value}`);

    if (Array.isArray(value))
      value.forEach(item => visit(item, key));
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([childKey, child]) => visit(child, key === 'indexes' && childKey === 'value' ? 'type' : childKey));
  };
  for (const graph of [schema.records, schema.types, schema.series, schema.diagnostics])
    visit(graph);

  const kinds = new Set([
    'any', 'unknown', 'literal', 'boolean', 'union', 'intersection', 'type-parameter', 'conditional', 'indexed-access', 'keyof', 'substitution',
    'generic-reference', 'tuple', 'array', 'external', 'object', 'string', 'number', 'null', 'undefined', 'void', 'never', 'bigint', 'symbol',
    'non-primitive', 'unsupported',
  ]);
  for (const type of schema.types) {
    if (!kinds.has(type.kind))
      throw new Error(`Unknown type kind: ${type.id}`);

    const require = (...fields: (keyof TypeNode)[]) => {
      for (const key of fields)
        if (type[key] === undefined)
          throw new Error(`Missing ${key}: ${type.id}`);
    };
    if (type.kind === 'union') {
      require('alternatives');
      if (!type.alternatives!.length)
        throw new Error(`Empty union: ${type.id}`);
    }

    if (type.kind === 'object' || type.kind === 'intersection')
      require('properties', 'signatures', 'constructSignatures', 'indexes');

    if (type.kind === 'intersection')
      require('constituents');

    if (type.kind === 'array')
      require('element', 'readonly');

    if (type.kind === 'tuple')
      require('elements', 'readonly', 'minLength');

    if (type.kind === 'literal')
      require('value');

    if (type.kind === 'generic-reference')
      require('target', 'typeArguments');

    if (type.kind === 'conditional')
      require('checkType', 'extendsType', 'trueType', 'falseType');

    if (type.kind === 'indexed-access')
      require('objectType', 'indexType');

    if (type.kind === 'keyof')
      require('objectType');

    if (type.kind === 'substitution')
      require('baseType', 'constraint');

    if (type.kind === 'unsupported' && !schema.diagnostics.some(d => d.code === 'UNSUPPORTED_TYPE' && d.type === type.id))
      throw new Error(`Unsupported type lacks diagnostic: ${type.id}`);
  }

  for (const record of schema.records) {
    if (!records.has(record.canonicalId) || !record.publicPath || !record.provenance.length)
      throw new Error(`Invalid record: ${record.id}`);

    if (!['generated', 'manual-mapped', 'browser-reference', 'unresolved', 'out-of-scope'].includes(record.status))
      throw new Error(`Invalid mapping status: ${record.id}`);

    for (const id of record.inventory?.declarationIds ?? [])
      if (!records.has(id))
        throw new Error(`Dangling declaration record: ${id}`);
  }

  for (const series of schema.series)
    if (!records.has(series.registry))
      throw new Error(`Dangling registry: ${series.registry}`);
}

/** The committed ECharts schema: a directory of index.json and shards under the GitHub file size limit. */
export const schemaPath = 'schemas/upstream/echarts-6.1.0.api';

/** The large arrays of a schema, stored as shards; every other member stays in index.json. */
export const schemaShards = ['records', 'types', 'provenance'] as const;

/** Reads a sharded schema directory, or a single-file `.api.json` such as an older schema kept for api:diff. */
export function loadSchema(path = schemaPath): ApiSchema {
  return statSync(path).isDirectory() ? readShardedJson<ApiSchema>(path) : JSON.parse(readFileSync(path, 'utf8'));
}

/** The files of a sharded schema directory, validated and normalized as serializeSchema does. */
export function serializeSchemaShards(schema: ApiSchema): Map<string, string> {
  validateSchema(schema);
  return shardJson(normalizeSchema(schema), schemaShards);
}

export function writeSchema(schema: ApiSchema, path = schemaPath): void {
  writeShardedJson(path, serializeSchemaShards(schema));
}

/** A single-file schema, as older versions were committed and as api:diff fixtures write them. */
export function serializeSchema(schema: ApiSchema): string {
  validateSchema(schema);

  // One graph item per line keeps large inventories diffable without repeating indentation.
  normalizeSchema(schema);
  return '{\n' + Object.entries(schema).map(([key, value]) => `  ${JSON.stringify(key)}: ` + (Array.isArray(value)
    ? '[\n' + value.map(item => '    ' + JSON.stringify(item)).join(',\n') + '\n  ]' : JSON.stringify(value))).join(',\n') + '\n}\n';
}
