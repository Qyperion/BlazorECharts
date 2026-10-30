import { expect, test } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';
import * as reconciliation from '../../../tools/BindingGenerator/src/reconcile-docs.ts';
import { serializeSchema } from '../../../tools/BindingGenerator/src/schema.ts';

const entry = resolve('tests/javascript/generator/fixtures/upstream-added-removed.d.ts');
const docs = resolve('tests/javascript/generator/fixtures/docs-drift.json');

test('Reconcile_DocsOnlyProperty_IsVisibleUnresolved', () => {
  // Arrange
  const schema = extractDeclarations([entry]);

  // Act
  const report = reconciliation.reconcileDocumentation(schema, docs);

  // Assert
  expect(report.docsOnly).toContain('option.newOption');
  expect(schema.records.find(r => r.publicPath === 'option.newOption')).toMatchObject({ status: 'unresolved' });

  // Act & Assert
  expect(() => serializeSchema(schema)).not.toThrow();
});

test('Reconcile_TypeConflict_PreservesBothSources', () => {
  // Arrange
  const schema = extractDeclarations([entry]);
  const report = reconciliation.reconcileDocumentation(schema, docs);

  // Act
  const conflict = report.conflicting.find(r => r.path === 'option.formatter')!;

  // Assert
  expect(conflict.docsTypes).toEqual(['Function']);
  expect(conflict.declarationTypes).toEqual(['string']);
  expect(conflict.provenance.map(id => schema.provenance.find(p => p.id === id)!.package)).toContain('echarts-doc');
  expect(conflict.provenance.map(id => schema.provenance.find(p => p.id === id)!.package)).toContain('fixture');
  expect(report.declarationsOnly.length).toBeGreaterThan(0);
});

test('Reconcile_SeriesRoot_ResolvesRegistryMember', () => {
  // Arrange
  const s = extractDeclarations([entry]);
  const registry = s.records.find(r => r.name === 'RegisteredSeriesOption' && r.kind === 'export')!;
  const series = s.records.find(r => r.name === 'Series' && r.kind === 'export')!;
  s.series.push({ name: 'line', type: series.type, discriminator: ['line'], registry: registry.id });

  // Act
  const source = JSON.parse(readFileSync(docs, 'utf8')).entries[0].source;

  // Assert
  expect(reconciliation.findDeclaration(s, { path: 'option.series.line', category: 'option', types: ['Object'], source }).map(r => r.type)).toContain(
    series.type
  );
});

test('ExtractAgain_PreservesReconciledPublicRecords', () => {
  // Arrange
  const run = () => {
    const s = extractDeclarations([entry]);
    reconciliation.reconcileDocumentation(s, docs);
    return serializeSchema(s);
  };

  // Act & Assert
  expect(run()).toBe(run());

  // Act
  const schema = extractDeclarations([entry]);
  reconciliation.reconcileDocumentation(schema, docs);
  const first = serializeSchema(schema);
  reconciliation.reconcileDocumentation(schema, docs);

  // Assert
  expect(serializeSchema(schema)).toBe(first);
  expect(schema.records.filter(r => ['event', 'action'].includes(r.kind))).toHaveLength(2);
});

test('Upstream_AddAlternative_RequiresMappingDecision', () => {
  // Arrange
  const before = extractDeclarations([entry]);
  const after = structuredClone(before);
  const prop = after.records.find(r => r.kind === 'property' && r.name === 'formatter')!;
  after.types.push(
    { id: 'type:new-union', kind: 'union', display: 'string | number', alternatives: [prop.type, 'type:new-number'], provenance: prop.provenance },
    { id: 'type:new-number', kind: 'number', display: 'number', provenance: prop.provenance }
  );
  prop.type = 'type:new-union';

  // Act
  const change = reconciliation.compareApi(before, after).find(d => d.recordId === prop.id)!;

  // Assert
  expect(change.code).toBe('SIGNATURE_CHANGED');
  expect(change.requiresDecision).toBe(true);
});

test('Upstream_RemoveMember_RequiresApiDecision', () => {
  // Arrange
  const before = extractDeclarations([entry]);
  const after = structuredClone(before);
  const record = after.records.find(r => r.name === 'obsolete' && r.kind === 'property')!;

  // Act
  after.records = after.records.filter(r => r.id !== record.id);

  // Assert
  expect(reconciliation.compareApi(before, after)).toContainEqual(
    expect.objectContaining({ recordId: record.id, code: 'API_REMOVED', requiresDecision: true })
  );

  // Act
  reconciliation.preserveApiChanges(before, after);
  const again = structuredClone(after);
  again.apiChanges = [];
  reconciliation.preserveApiChanges(after, again);

  // Assert
  expect(again.apiChanges).toContainEqual(expect.objectContaining({ recordId: record.id, code: 'API_REMOVED', requiresDecision: true }));
});
