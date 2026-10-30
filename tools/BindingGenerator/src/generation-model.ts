import type { Signature } from './schema.ts';
import { existsSync, readFileSync } from 'node:fs';
import { readShardedJson } from './sharded-json.ts';

export interface CSharpConfiguration {
  roots: { recordId: string; name: string; family?: string }[];

  /** Explicit names; `reason` explains why the derived name does not fit. */
  names: { typeId: string; name: string; reason: string }[];

  defaults: { typeId: string; property: string; value: boolean }[];
  pins?: { typeId: string; sha256: string }[];
  normalizedArrays?: { typeId: string; property: string; expectedTypeId: string; reason: string }[];
  runtimePropertyTypes?: { typeId: string; property: string; expectedTypeId: string; replacementTypeId: string; reason: string }[];
  specializeGenerics?: string[];
  valueTypes?: { typeId: string; kind: 'date' | 'reference' | 'data'; reason: string; sha256: string }[];
  componentVariants?: Record<string, string[]>;

  /** Source-backed members missing from a pinned declaration; `summary` replaces the generic XML doc. */
  componentProperties?: { parent: string; name: string; type: string; sha256: string; docs: string[]; reason: string; summary?: string }[];

  projectedRoots?: { typeId: string; name: string }[];
  componentNodes?: import('./schema.ts').TypeNode[];
  componentReplacements?: { parent: string; name: string; expected: string; type: string; reason: string }[];

  /** A pinned member whose name is not the field ECharts reads: the C# member reads and writes `jsonName` instead. */
  memberRenames?: { typeId: string; property: string; jsonName: string; reason: string }[];

  optionRouteAliases?: { path: string; target: string; reason: string }[];
  graphicVariants?: import('./graphic-options.ts').GraphicVariantMapping[];

  /** Variants whose upstream type member is a plain string; their constructor writes this type (one-literal variants need no entry). */
  variantTypes?: { typeId: string; type: string; reason: string }[];

  /** The variant ECharts picks for an option without type; any other variant needs its own type in JSON. */
  variantDefaults?: { typeId: string; when: VariantDefault; reason: string }[];

  /** A union that duplicates another from a different bundle declaration whose alternatives are copies too: one C# type. */
  unionTwins?: { typeId: string; canonicalTypeId: string; reason: string }[];

  /** A global helper type that duplicates a generated option model from another bundle declaration. */
  globalTypeTwins?: GlobalTypeTwin[];
}

export interface GlobalTypeTwin {
  typeId: string;
  canonicalTypeId: string;
  reason: string;
}

export interface Shape {
  id: string;
  cs: string;

  kind: 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'reference'
  | 'never'
  | 'dictionary'
  | 'dynamic'
  | 'model'
  | 'union'
  | 'array'
  | 'arraylike'
  | 'many'
  | 'tuple'
  | 'function'
  | 'series';

  name?: string;
  file?: string;
  element?: Shape;
  alternatives?: Shape[];
  literal?: string | number | boolean;
  properties?: Member[];
  signatures?: Signature[];
  elements?: Shape[];
  discriminator?: string;
  index?: Shape;

  /** The struct of `X | X[]` whose union element X has a scalar alternative: it converts each alternative, X and X?[] in one step. */
  struct?: string;

  initialValues?: Record<string, string>;

  /** When JSON has no type, whether ECharts' subtype defaulter picks this variant (see VariantDefault). */
  absentType?: VariantDefault;

  required?: string[];
  requiredNonNull?: string[];
}

export interface Member {
  name: string;
  csName: string;
  shape: Shape;
  sourceId: string;
  defaultValue?: boolean;
  summary?: string;

  /** The text of an upstream @deprecated tag, possibly empty: the member becomes [Obsolete]. */
  deprecated?: string;
}

export interface GenerationDiagnostic {
  code: string;
  sourceId: string;
  typeId: string;
  message: string;
}

export interface ManifestEntry {
  sourceId: string;
  typeId: string;
  family: string;
  families: string[];
  status: 'generated' | 'unresolved';
  symbol: string;
  file: string;
  serializer: string;
  reader: string;
  alternatives: string[];
  reason?: string;
  targets?: { typeId: string; symbol: string; file: string; serializer: string; reader: string }[];
  runtimeName?: string;
}

/** always: the component default (slider dataZoom, plain legend); has-data / no-data: category / value axes; continuous / piecewise: the visualMap
 * defaulter. */
export const variantDefaultCases = ['always', 'has-data', 'no-data', 'continuous', 'piecewise'] as const;
export type VariantDefault = typeof variantDefaultCases[number];

export interface GeneratedManifest {
  formatVersion: 1;
  sourceHash: string;
  entries: ManifestEntry[];
  files: { path: string; sha256: string; symbols: string[] }[];
  signatures: { typeId: string; symbol: string; signatures: Signature[]; genericTarget?: string; typeArguments?: string[] }[];
  families: { id: string; rootSourceId: string; sourceIds: string[] }[];

  /** Per scope set: totals split by mapping status (see scope-categories.ts). */
  scopeCategories?: Record<string, { total: number; generated: number; manualMapped: number; unresolved: number }>;
}

/** The committed generator manifest: index.json plus shards of its entries, under the GitHub file size limit. */
export const manifestPath = 'schemas/generated/csharp-manifest';
export const manifestShards = ['entries'] as const;
export const loadManifest = (path = manifestPath) => readShardedJson<GeneratedManifest>(path);

/** Published C# type name -> the route that identifies its type (type-names.ts routeKey). */
export type TypeNameLock = Record<string, string>;
export const typeNameLockPath = 'schemas/generated/type-names.lock.json';

export const loadTypeNameLock = (path = typeNameLockPath): TypeNameLock | undefined =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;

/** `warnings` name configuration that took no effect: unused csharp.names, defaults and K9 paths. */
export interface GenerationResult {
  files: Map<string, string>;
  manifest: GeneratedManifest;
  diagnostics: GenerationDiagnostic[];
  scope?: import('./scope-categories.ts').ScopeResult;
  warnings?: string[]

  /** The emitted union value types and the alternatives their C# misses (see validateEmittedUnions). */
  unions?: Shape[];

  emissionErrors?: string[];
}

export const header = '// <auto-generated />\n#nullable enable\n';
export const quote = (value: string) => JSON.stringify(value);

export function identifier(value: string): string {
  const operators: Record<string, string> = {
    '!=': 'NotEqual',
    '<': 'LessThan',
    '<=': 'LessThanOrEqual',
    '<>': 'NotEqualAlias',
    '=': 'Equal',
    '>': 'GreaterThan',
    '>=': 'GreaterThanOrEqual',
  };
  if (operators[value])
    return operators[value];

  let name = value.replace(/[^a-zA-Z0-9_]+(.)?/g, (_, c: string | undefined) => c?.toUpperCase() ?? '');
  name = name ? name[0].toUpperCase() + name.slice(1) : 'Value';
  if (!/^[A-Za-z_]/.test(name))
    name = 'Value' + name;

  if (['Type', 'GetType', 'IsAssigned', 'SetProperty', 'AdditionalProperties', 'Equals', 'ToString', 'GetHashCode'].includes(name))
    name += 'Value';

  return name || 'Value';
}

export const nullable = (shape: Shape) => `${shape.cs}?`;

export const manyElement = (shape: Shape) =>
  ['number', 'boolean', 'date', 'never', 'union', 'tuple', 'arraylike'].includes(shape.kind) ? nullable(shape) : shape.cs;

export const usings = 'using System.Text.Json;\nusing BlazorECharts.Options;\nusing BlazorECharts.Runtime;\nusing BlazorECharts.Serialization;\nusing BlazorECharts.Values;\nusing BlazorECharts.Values.Signatures;\n';

/** One item per line keeps large generated inventories reviewable in Git. */
export function generatedJson(value: object): string {
  return '{\n' + Object.entries(value).map(([key, item]) => `  ${JSON.stringify(key)}: ` + (Array.isArray(item)
    ? '[\n' + item.map(v => '    ' + JSON.stringify(v)).join(',\n') + '\n  ]' : JSON.stringify(item))).join(',\n') + '\n}\n';
}
