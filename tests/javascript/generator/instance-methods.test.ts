import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createInstanceMethodReport } from '../../../tools/BindingGenerator/src/instance-methods.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';

it('Instance_inventory_has_explicit_owners_and_source_pinned_export_evidence', () => {
  // Arrange
  const schema = loadSchema();
  const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));

  // Act
  const report = createInstanceMethodReport(schema, overrides.instanceMethods);

  // Assert
  expect(report.records).toHaveLength(38);
  expect(report.records.find(r => r.name === 'getOption')).toMatchObject({
    owner: 'instance',
    status: 'implemented',
    pending: 'Function/DOM reapplication:native',
  });
  expect(report.records.find(r => r.name === 'getDataURL')).toMatchObject({ owner: 'exports', status: 'implemented', symbol: 'GetDataUrlAsync' });
  expect(report.records.filter(r => r.owner === 'exports').every(r => r.status === 'implemented' && r.pending === '')).toBe(true);
  expect(report.note).toContain('Owners name the delivering capability');
  expect(report.records.find(r => r.name === 'group')).toMatchObject({ owner: 'globals', status: 'implemented' });

  // Arrange
  const stale = structuredClone(overrides.instanceMethods);
  stale[0].expectedSignature = 'stale';

  // Act & Assert
  expect(() => createInstanceMethodReport(schema, stale)).toThrow(/Stale instance mapping/);
  expect(() => createInstanceMethodReport(schema, overrides.instanceMethods.slice(1))).toThrow(/Missing instance owner/);
});
