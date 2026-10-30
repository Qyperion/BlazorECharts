import type { ApiSchema } from './schema.ts';
import type { GeneratedManifest, ManifestEntry, Shape } from './generation-model.ts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSignatureHasher } from './validate-overrides.ts';
import { validateSchema } from './schema.ts';
import { compareScopeCategories, scopeSets, scopeSummary, type ScopeResult, type ScopeStatus } from './scope-categories.ts';

/**
 * The manifest lists the alternatives of a union; this reads the emitted C# itself: every alternative has its
 * From overload, and every literal of a literal-only overload its validation, so no alternative is lost in emission.
 */
export function validateEmittedUnions(unions: Iterable<Shape>, files: Map<string, string>): string[] {
  const errors: string[] = [];
  for (const shape of unions) {
    if (shape.kind !== 'union' || !shape.file || !shape.alternatives?.length)
      continue;

    const text = files.get(shape.file);
    if (text === undefined) {
      errors.push(`UNION_ALTERNATIVE_NOT_EMITTED ${shape.name}: ${shape.file} was not emitted`);
      continue;
    }

    const groups = new Map<string, Shape[]>();
    for (const alternative of shape.alternatives)
      groups.set(alternative.cs, [...groups.get(alternative.cs) ?? [], alternative]);

    for (const [cs, group] of groups) {
      if (!text.includes(`public static ${shape.name} From(${cs} value)`))
        errors.push(`UNION_ALTERNATIVE_NOT_EMITTED ${shape.name}: no From(${cs})`);

      if (!group.every(a => a.literal !== undefined))
        continue;

      // The whole literal: value == 10 does not validate 1, nor value == 1.5.
      const compared = (literal: unknown) =>
        new RegExp(`value == ${JSON.stringify(literal).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`).test(text);
      for (const alternative of group)
        if (!compared(alternative.literal))
          errors.push(`UNION_ALTERNATIVE_NOT_EMITTED ${shape.name}: no literal ${JSON.stringify(alternative.literal)}`);
    }
  }

  return errors;
}

/** A generated mapping is complete only with its full union, symbol, serializer and reader. */
export function validateCoverage(schema: ApiSchema, manifest: GeneratedManifest): { errors: string[] } {
  const errors: string[] = [];
  const entries = new Map<string, ManifestEntry>();
  const fileSet = new Map(manifest.files.map(f => [f.path, f]));
  const sourceRecords = new Map(schema.records.map(r => [r.id, r]));
  const types = new Map(schema.types.map(t => [t.id, t]));
  if (manifest.sourceHash !== createHash('sha256').update(JSON.stringify(schema)).digest('hex'))
    errors.push('Stale generated manifest: source hash mismatch');

  const symbols = new Set(manifest.files.flatMap(f => f.symbols));
  for (const entry of manifest.entries) {
    if (entries.has(entry.sourceId))
      errors.push(`Duplicate mapping ${entry.sourceId}`);

    entries.set(entry.sourceId, entry);
    const record = sourceRecords.get(entry.sourceId);
    if (!record) {
      errors.push(`Unknown source ID ${entry.sourceId}`);
      continue;
    }

    if (!['generated', 'unresolved'].includes(entry.status))
      errors.push(`INVALID_MAPPING_STATUS ${entry.sourceId}: ${entry.status}`);

    if (entry.status !== 'generated')
      continue;

    const t = types.get(record.type)!;
    const alternatives = t.kind === 'union' ? t.alternatives! : [t.id];
    if (entry.typeId !== record.type || JSON.stringify([...entry.alternatives].sort()) !== JSON.stringify([...alternatives].sort()))
      errors.push(`Missing/changed union alternative ${entry.sourceId}`);

    if (!symbols.has(entry.symbol) || !entry.file || !fileSet.get(entry.file)?.sha256 || !symbols.has(entry.serializer) || !symbols.has(entry.reader))
      errors.push(`Missing symbol/serializer/reader ${entry.sourceId}`);

    for (const target of entry.targets ?? [])
      if (!symbols.has(target.symbol) || !symbols.has(target.serializer) || !symbols.has(target.reader) || !fileSet.has(target.file))
        errors.push(`Missing component alternative ${entry.sourceId}: ${target.symbol}`);
  }

  // A DTO family is its full reachable source graph, not a convenient subset of emitted fields.
  const families = new Set<string>();
  for (const f of manifest.families) {
    if (families.has(f.id) || !f.sourceIds.length)
      errors.push(`Invalid/duplicate family ${f.id}`);

    families.add(f.id);
    for (const id of f.sourceIds)
      if (!sourceRecords.has(id))
        errors.push(`Unknown source ID in family ${f.id}: ${id}`);

    const root = sourceRecords.get(f.rootSourceId);
    const reachable = new Set<string>();
    const visit = (id: string): void => {
      if (reachable.has(id))
        return;

      reachable.add(id);
      const t = types.get(id);
      if (!t)
        return;

      for (const p of t.properties ?? [])
        visit(p.type);

      for (const a of t.alternatives ?? [])
        visit(a);

      if (t.element)
        visit(t.element);
    };
    if (root)
      visit(root.type);

    const expected = schema.records
      .filter(r => r.id === f.rootSourceId || (r.kind === 'property' && reachable.has(r.id.slice(9, r.id.lastIndexOf('/')))))
      .map(r => r.id);
    if (!root || JSON.stringify([...f.sourceIds].sort()) !== JSON.stringify(expected.sort()))
      errors.push(`Incomplete family membership ${f.id}`);

    for (const id of f.sourceIds)
      if (entries.get(id)?.status !== 'generated')
        errors.push(`Incomplete family ${f.id}: ${id}`);
  }

  return { errors };
}

/** Verify the actual emitted artifacts before accepting manifest claims in a CLI gate. */
export async function verifyManifestFiles(manifest: GeneratedManifest, root: string): Promise<void> {
  for (const file of manifest.files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(root, file.path));
    } catch (error) {
      throw new Error(`Missing emitted file ${file.path}; source IDs: ${manifest.entries.filter(e => e.file === file.path || file.symbols.includes(e.serializer)).map(e => e.sourceId).join(', ')}`, { cause: error });
    }

    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error(`Emitted file hash mismatch: ${file.path}`);
  }
}

/** Compare claims with a fresh source projection. In particular, a supplied closure
 * is not its own denominator: removing a whole model or overload must fail too. */
export function publicContractDiff(actual: GeneratedManifest, expected: GeneratedManifest): string[] {
  const errors: string[] = [];
  const signatures = new Map(actual.signatures.map(s => [s.typeId, s]));
  if (signatures.size !== actual.signatures.length)
    errors.push('DUPLICATE_SIGNATURE');

  for (const signature of expected.signatures) {
    if (JSON.stringify(signatures.get(signature.typeId)) !== JSON.stringify(signature))
      errors.push(`SIGNATURE_DRIFT ${signature.typeId}`);

    signatures.delete(signature.typeId);
  }

  for (const id of signatures.keys())
    errors.push(`VANISHED_SIGNATURE ${id}`);

  const entries = new Map(actual.entries.map(e => [e.sourceId, e]));
  for (const entry of expected.entries) {
    if (JSON.stringify(entries.get(entry.sourceId)) !== JSON.stringify(entry))
      errors.push(`MAPPING_DRIFT ${entry.sourceId}`);

    entries.delete(entry.sourceId);
  }

  for (const id of entries.keys())
    errors.push(`VANISHED_MAPPING ${id}`);

  // Symbols must belong to their source-projected file; a same-named symbol in
  // an unrelated file is not evidence that the serializer/reader was emitted.
  const files = new Map(actual.files.map(f => [f.path, f]));
  if (files.size !== actual.files.length)
    errors.push('DUPLICATE_EMITTED_FILE');

  for (const file of expected.files) {
    const supplied = files.get(file.path);
    if (!supplied || file.symbols.some(s => !supplied.symbols.includes(s)))
      errors.push(`SYMBOL_FILE_MISMATCH ${file.path}`);

    if (JSON.stringify(supplied) !== JSON.stringify(file))
      errors.push(`EMITTED_FILE_DRIFT ${file.path}`);

    files.delete(file.path);
  }

  for (const path of files.keys())
    errors.push(`VANISHED_EMITTED_FILE ${path}`);

  if (JSON.stringify(actual.families) !== JSON.stringify(expected.families))
    errors.push('FAMILY_MEMBERSHIP_DRIFT');

  if (JSON.stringify(actual.scopeCategories) !== JSON.stringify(expected.scopeCategories))
    errors.push('SCOPE_SUMMARY_DRIFT');

  return errors;
}

export interface ManualCoverageMapping {
  sourceId: string;
  expectedSignature: string;
  symbols: string[];
  implementation: string[];
  tests: string[];
}

/** Manual mappings count only while pinned to the current signature and naming their implementation and tests. */
export function validateManualMappings(schema: ApiSchema, manual: ManualCoverageMapping[]): { ids: string[]; errors: string[] } {
  const hash = createSignatureHasher(schema);
  const records = new Map(schema.records.map(r => [r.id, r]));
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const mapping of manual) {
    if (ids.has(mapping.sourceId)) {
      errors.push(`DUPLICATE_MANUAL_MAPPING ${mapping.sourceId}`);
      continue;
    }

    const record = records.get(mapping.sourceId);
    const pinned = !!record && hash(record) === mapping.expectedSignature;
    const evidence = mapping.symbols.length
      && mapping.implementation.length
      && mapping.tests.length
      && [...mapping.symbols, ...mapping.implementation, ...mapping.tests].every(s => s.trim());
    if (!pinned)
      errors.push(`STALE_MANUAL_MAPPING ${mapping.sourceId}`);

    if (!evidence)
      errors.push(`MISSING_MANUAL_EVIDENCE ${mapping.sourceId}`);

    if (pinned && evidence)
      ids.add(mapping.sourceId);
  }

  return { ids: [...ids], errors };
}

export interface ScopedCoverageInput {
  schema: ApiSchema;
  manifest: GeneratedManifest;

  /** MUST be freshly generated from the schema and validated overrides, never the audited manifest. */
  expected: GeneratedManifest;

  scope: ScopeResult;
  manual: Iterable<string>;
  committedCategories: string | undefined;
  expectedCategories: string;
}

/** Release gate: every S record is mapped, every other record is in a mechanical category, and nothing drifted. */
export function validateScopedCoverage(input: ScopedCoverageInput) {
  const { schema, manifest, expected, scope } = input;
  try {
    validateSchema(schema);
  } catch (error) {
    const spans = new Set(schema.provenance.map(p => p.id));
    const sourceErrors = schema.records
      .filter(r => !r.provenance.length || r.provenance.some(p => !spans.has(p)))
      .map(r => `DANGLING_SOURCE_REFERENCE ${r.id}`);
    return {
      formatVersion: 1 as const,
      inputValid: false,
      summary: undefined,
      unresolved: [],
      residual: [],
      loose: [],
      drift: [],
      errors: [`INVALID_SOURCE_SCHEMA ${error}`, ...sourceErrors],
    };
  }

  const errors = [...validateCoverage(schema, manifest).errors, ...publicContractDiff(manifest, expected), ...scope.errors];
  const manual = new Set(input.manual);
  const entries = new Map(manifest.entries.map(e => [e.sourceId, e]));
  const status = (id: string): ScopeStatus => entries.get(id)?.status === 'generated' ? 'generated' : manual.has(id) ? 'manual-mapped' : 'unresolved';
  const records = new Map(schema.records.map(r => [r.id, r]));
  const unresolved: { set: string; id: string; path: string }[] = [];
  const residual: string[] = [];
  for (const r of schema.records) {
    const a = scope.assignments.get(r.id);
    if (!a) {
      errors.push(`UNCLASSIFIED_RECORD ${r.id}`);
      continue;
    }

    if ((scopeSets as readonly string[]).includes(a.set) && status(r.id) === 'unresolved')
      unresolved.push({ set: a.set, id: r.id, path: r.publicPath });

    if (a.set === 'RESIDUAL' || a.set === 'BONUS' && status(r.id) === 'unresolved')
      residual.push(r.id);
  }

  errors.push(
    ...unresolved.map(u => `UNRESOLVED_SCOPE_RECORD ${u.set} ${u.id}`),
    ...residual.map(id => `RESIDUAL_RECORD ${id}`),
    ...scope.loose.map(id => `LOOSE_DOCUMENTED_VALUE ${id}`)
  );
  const drift = compareScopeCategories(input.committedCategories, input.expectedCategories);
  errors.push(...drift);
  for (const change of schema.apiChanges ?? [])
    if (change.requiresDecision)
      errors.push(`UNDECIDED_API_CHANGE ${change.recordId}`);

  return {
    formatVersion: 1 as const,
    inputValid: true,
    summary: scopeSummary(scope.assignments, status),
    unresolved,
    residual,
    loose: scope.loose.map(id => ({ id, path: records.get(id)?.publicPath })),
    drift,
    errors,
  };
}
