import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';
import * as overrides from '../../../tools/BindingGenerator/src/validate-overrides.ts';
import { reconcileDocumentation } from '../../../tools/BindingGenerator/src/reconcile-docs.ts';

test('Override_StaleSourceSignature_IsRejected', () => {
  // Arrange
  const schema = extractDeclarations([resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts')]);
  const record = schema.records.find(r => r.kind === 'property' && r.name === 'formatter')!;
  const mapping = {
    recordId: record.id,
    expectedSignature: overrides.signatureHash(schema, record),
    reason: 'Fixture correction',
    source: schema.provenance.find(p => p.id === record.provenance[0])!,
    sourceUrl: 'https://example.test/pinned/source',
    regressionFixture: 'tests/javascript/generator/fixtures/upstream-added-removed.d.ts',
    requirements: ['function-binding'],
  };

  // Act & Assert
  expect(() => overrides.validateOverrides(schema, { formatVersion: 1, mappings: [mapping] })).not.toThrow();

  // Arrange
  record.type = schema.types.find(t => t.kind === 'number')!.id;

  // Act & Assert
  expect(() => overrides.validateOverrides(schema, { formatVersion: 1, mappings: [mapping] })).toThrow(/stale/i);
});

test('Override_StaleDuringUpgrade_IsCollectedAndSkippedOnlyWhenRequested', () => {
  // Arrange
  const schema = extractDeclarations([resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts')]);
  const pin = (name: string) => {
    const record = schema.records.find(r => r.kind === 'property' && r.name === name)!;
    return {
      recordId: record.id,
      expectedSignature: overrides.signatureHash(schema, record),
      reason: 'Fixture',
      source: schema.provenance.find(p => p.id === record.provenance[0])!,
      sourceUrl: 'https://example.test/pinned/source',
      regressionFixture: 'tests/javascript/generator/fixtures/upstream-added-removed.d.ts',
      requirements: [name],
    };
  };
  const mappings = [pin('formatter'), pin('obsolete')];
  const decision = { recordId: 'public:option.gone', previousSignature: 'a', currentSignature: 'b', reason: 'Fixture' };
  schema.records.find(r => r.id === mappings[0].recordId)!.type = schema.types.find(t => t.kind === 'number')!.id;

  // Act & Assert
  expect(() => overrides.validateOverrides(schema, { formatVersion: 1, mappings, apiDecisions: [decision] })).toThrow(/stale/i);

  // Act
  const stale: string[] = [];
  overrides.validateOverrides(schema, { formatVersion: 1, mappings, apiDecisions: [decision] }, true, message => stale.push(message));

  // Assert
  expect(stale).toEqual([`Stale override: ${mappings[0].recordId}`, 'Stale or unexplained API decision: public:option.gone']);
  expect(schema.records.find(r => r.id === mappings[1].recordId)!.inventory?.requirements).toEqual(['obsolete']);
  expect(schema.records.find(r => r.id === mappings[0].recordId)!.inventory?.requirements ?? []).not.toContain('formatter');
});

test('Inventory_ExclusionNeedsReasonAndAllowedBoundary', () => {
  // Act & Assert
  expect(() => overrides.validateExclusion({ boundary: 'standard-series', reason: 'too much work' })).toThrow();
  expect(() => overrides.validateExclusion({ boundary: 'R10', reason: '' })).toThrow();
  expect(
    () => overrides.validateExclusion({ boundary: 'R10', reason: 'Separate full ZRender facade is excluded; ECharts graphic is retained' })
  ).not.toThrow();

  // Arrange
  const s = extractDeclarations([resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts')]);
  const r = s.records.find(r => r.name === 'Series' && r.kind === 'export')!;
  r.family = 'standard-series';

  // Act & Assert
  expect(() => overrides.validateExclusion({ boundary: 'R10', reason: 'Pretend a standard series is ZRender' }, r)).toThrow();
});

test('Review_MultipleDeclarationMatches_PreserveEveryAlternativeAndRejectStaleOverride', () => {
  // Arrange
  const s = extractDeclarations([resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts')]);
  reconcileDocumentation(s, resolve('tests/javascript/generator/fixtures/docs-drift.json'));
  const r = s.records.find(r => r.publicPath === 'option.axis.boundaryGap')!;

  // Act
  const union = s.types.find(t => t.id === r.type)!;

  // Assert
  expect(union.kind).toBe('union');

  // Act
  const branches = union.alternatives!.map(id => s.types.find(t => t.id === id)!);

  // Assert
  expect(branches.some(t => t.kind === 'tuple')).toBe(true);
  expect(branches.flatMap(t => t.alternatives ?? []).map(id => s.types.find(t => t.id === id)!.value).sort()).toEqual([false, true]);

  // Arrange
  const mapping = {
    recordId: r.id,
    expectedSignature: overrides.signatureHash(s, r),
    reason: 'Both declaration alternatives are required',
    source: s.provenance.find(p => p.id === r.provenance[0])!,
    sourceUrl: 'https://example.test/pinned/contract',
    regressionFixture: 'tests/javascript/generator/fixtures/upstream-added-removed.d.ts',
    requirements: [],
  };

  // Act & Assert
  expect(() => overrides.validateOverrides(s, { formatVersion: 1, mappings: [mapping] })).not.toThrow();

  // Arrange
  const tuple = s.types.find(t => t.id === union.alternatives!.find(id => s.types.find(t => t.id === id)!.kind === 'tuple'))!;
  tuple.elements![0].type = s.types.find(t => t.kind === 'string')!.id;

  // Act & Assert
  expect(() => overrides.validateOverrides(s, { formatVersion: 1, mappings: [mapping] })).toThrow(/stale/i);
});

test('Override_PropertyPresenceChange_RejectsOldSignature', () => {
  // Arrange
  const s = extractDeclarations([resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts')]);
  const r = s.records.find(r => r.name === 'formatter' && r.kind === 'property')!;
  const before = overrides.signatureHash(s, r);
  const parent = s.types.find(t => t.properties?.some(p => p.name === 'formatter'))!;

  // Act
  parent.properties!.find(p => p.name === 'formatter')!.optional = false;

  // Assert
  expect(overrides.signatureHash(s, r)).not.toBe(before);
});
