import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createInstanceMethodReport } from '../../../tools/BindingGenerator/src/instance-methods.ts';
import { emitGlobalMethods } from '../../../tools/BindingGenerator/src/global-methods.ts';
import { evidenceErrors } from '../../../tools/BindingGenerator/src/evidence.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';

const schema = loadSchema();
const overrides = () => JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));

const delivered = (o: any): { recordId: string; tests: string[] }[] => [
  ...o.instanceMethods.filter((m: any) => m.status === 'implemented'),
  ...o.globalMethods.filter((m: any) => ['managed', 'native'].includes(m.owner)),
];

it('ManualEvidence_EveryDeliveredMappingNamesAnExistingTestOrProbe', () => {
  // Act
  const mappings = delivered(overrides());

  // Assert
  expect(mappings.length).toBeGreaterThan(250);
  expect(mappings.flatMap(m => evidenceErrors(m.recordId, m.tests))).toEqual([]);
});

it('ManualEvidence_DeletedOrUnnamedTestFailsTheGeneration', () => {
  // Act & Assert
  expect(evidenceErrors('fixture', ['tests/browser/methods.spec.ts'])).toEqual(['fixture names no test or probe in its evidence']);
  expect(evidenceErrors('fixture', ['tests/browser/methods.spec.ts#DeletedTest'])).toEqual([
    'fixture: tests/browser/methods.spec.ts declares no test DeletedTest',
  ]);
  expect(evidenceErrors('fixture', ['tests/browser/missing.spec.ts#Anything'])).toEqual(['fixture: tests/browser/missing.spec.ts does not exist']);

  // A test name must not match only as the prefix of a longer name.
  expect(evidenceErrors('fixture', ['tests/browser/methods.spec.ts#InstanceMethods_UseCorrect'])).toHaveLength(1);
});

it('ManualEvidence_NamesATestDeclarationInAGatedFile', () => {
  // Words of the file that are no test: a name prefix, a comment, a helper function, a variable and a fixture argument.

  // Act & Assert
  for (const entry of [
    'tests/browser/methods.spec.ts#InstanceMethods', 'tests/browser/interaction-events.spec.ts#LegendActions', 'tests/browser/exports.spec.ts#Two',
    'tests/browser/exports.spec.ts#stillWaiting', 'tests/browser/exports.spec.ts#expect', 'tests/browser/exports.spec.ts#page',
  ]) {
    expect(evidenceErrors('fixture', [entry]), entry).toEqual([`fixture: ${entry.split('#')[0]} declares no test ${entry.split('#')[1]}`]);
  }

  // A [Fact] method and a Vitest test are declarations; a helper method is not.
  expect(evidenceErrors('fixture', ['tests/BlazorECharts.Tests/Api/ExportContractTests.cs#Write'])).toHaveLength(1);

  // Act
  const fact = readFileSync('tests/BlazorECharts.Tests/Api/InstanceMethodContractTests.cs', 'utf8').match(
    /\[Fact\]\s*public\s+(?:async\s+)?\w+\s+(\w+)\(/
  )![1];

  // Assert
  expect(evidenceErrors('fixture', [`tests/BlazorECharts.Tests/Api/InstanceMethodContractTests.cs#${fact}`])).toEqual([]);

  // Act
  // A spec outside every gate stage proves nothing to the release gate.
  const performance = readFileSync('tests/browser/performance/performance.spec.ts', 'utf8');

  // Assert
  expect(performance).toMatch(/test\(/);
  expect(evidenceErrors('fixture', ['tests/browser/performance/performance.spec.ts#id'])).toEqual([
    'fixture: tests/browser/performance/performance.spec.ts is not run by the release gate',
  ]);
});

it('ManualEvidence_DeletedOrUnnamedTestFailsTheGeneratedReports', () => {
  // Arrange
  const instance = overrides();
  const containPixel = instance.instanceMethods.find((m: any) => m.recordId === 'public:echartsInstance.containPixel');
  containPixel.tests = containPixel.tests.map((t: string) => t.replace(/#.*/, '#DeletedTest'));

  // Act & Assert
  expect(() => createInstanceMethodReport(schema, instance.instanceMethods)).toThrow(/DeletedTest/);

  // Arrange
  const global = overrides();
  const native = global.globalMethods.find((m: any) => m.owner === 'native');
  native.tests = native.tests.map((t: string) => t.replace(/#.*/, ''));

  // Act & Assert
  expect(() => emitGlobalMethods(schema, global.globalMethods)).toThrow(/names no test or probe/);
});
