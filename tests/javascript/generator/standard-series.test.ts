import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { validateCoverage } from '../../../tools/BindingGenerator/src/coverage.ts';
import { optionGroup } from '../../../tools/BindingGenerator/src/option-partition.ts';
import { unresolvedInScope } from './scope-helpers.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
const baseline = baselineGeneration;

it('StandardSeries_AllAssignedRecordsMapped', () => {
  // Arrange
  const result = baseline();

  // Act & Assert
  expect(validateCoverage(schema, result.manifest).errors).toEqual([]);
  expect(unresolvedInScope(schema, result, 'standard-series')).toEqual([]);
});

it('StandardSeries_PartitionMatchesTheWholePinnedRegistry', () => {
  // Arrange
  const standard = schema.series.filter(s => optionGroup(`option.series.${s.name}`).group === 'standard');

  // Act
  const advanced = schema.series.filter(s => optionGroup(`option.series.${s.name}`).group === 'advanced');

  // Assert
  expect(standard.map(s => s.name).sort()).toEqual([
    'bar', 'boxplot', 'candlestick', 'effectScatter', 'funnel', 'gauge', 'heatmap', 'line', 'lines', 'map', 'parallel', 'pictorialBar', 'pie',
    'radar', 'scatter', 'themeRiver',
  ].sort());
  expect(advanced.map(s => s.name).sort()).toEqual(['chord', 'custom', 'graph', 'sankey', 'sunburst', 'tree', 'treemap']);
  expect(standard.length + advanced.length).toBe(schema.series.length);
});

it('StandardSeries_NewPathMissingUnionAndStaleAliasFail', () => {
  // Arrange
  const result = baseline();
  const changed = structuredClone(result.manifest);

  // Act
  changed.entries.find(e => e.sourceId === 'public:option.series.line.step')!.alternatives.pop();

  // Assert
  expect(validateCoverage(schema, changed).errors.join('\n')).toMatch(/Missing\/changed union/);

  // Act
  const future = structuredClone(schema);
  const template = future.records.find(r => r.id === 'public:option.series.line.step');
  future.records.push({
    ...template,
    id: 'public:option.series.line.futureStyle',
    publicPath: 'option.series.line.futureStyle',
    name: 'futureStyle',
  });

  // Assert
  expect(unresolvedInScope(future, generate(future, overrides), 'standard-series')).toEqual(['public:option.series.line.futureStyle']);

  // Arrange
  const stale = structuredClone(overrides);
  stale.csharp.optionRouteAliases[0].target = 'option.series.themeRiver.data.9';

  // Act & Assert
  expect(() => generate(schema, stale)).toThrow(/Stale option route alias/);
});
