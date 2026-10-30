import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCoverage } from '../../../tools/BindingGenerator/src/coverage.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
const baseline = baselineGeneration;

it('Coverage_MissingUnionOrSerializer_ErrorsWithSourceId', () => {
  // Arrange
  const result = baseline();

  // Act
  const entry = result.manifest.entries.find(e => e.sourceId.endsWith('/replaceMerge') && e.status === 'generated')!;

  // Assert
  expect(entry).toBeDefined();

  // Act
  const broken = structuredClone(result.manifest);
  broken.entries.find(e => e.sourceId === entry.sourceId)!.alternatives.pop();

  // Assert
  expect(validateCoverage(schema, broken).errors.join('\n')).toContain(entry.sourceId);

  // Act
  const missing = structuredClone(result.manifest);
  missing.entries.find(e => e.sourceId === entry.sourceId)!.serializer = '';

  // Assert
  expect(validateCoverage(schema, missing).errors.join('\n')).toContain(entry.sourceId);

  // Act
  const absentWriter = structuredClone(result.manifest);
  absentWriter.files = absentWriter.files.filter(f => !f.path.endsWith('SetOptionOptions.Serializer.g.cs'));

  // Assert
  expect(validateCoverage(schema, absentWriter).errors.join('\n')).toContain(entry.sourceId);
});

it('Coverage_DtoFamilyMustBeCompleteAndExact', () => {
  // Arrange
  const result = baseline();

  // Act & Assert
  expect(validateCoverage(schema, result.manifest).errors).toEqual([]);

  // Act
  const broken = structuredClone(result.manifest);
  const entry = broken.entries.find(e => e.families.includes('dto:update') && e.status === 'generated')!;
  entry.status = 'unresolved';

  // Assert
  expect(validateCoverage(schema, broken).errors.join('\n')).toContain(`Incomplete family dto:update: ${entry.sourceId}`);

  // Act
  const narrowed = structuredClone(result.manifest);
  narrowed.families.find(f => f.id === 'dto:update')!.sourceIds.pop();

  // Assert
  expect(validateCoverage(schema, narrowed).errors.join('\n')).toContain('Incomplete family membership dto:update');
});
