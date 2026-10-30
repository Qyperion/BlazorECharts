import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { validateCoverage } from '../../../tools/BindingGenerator/src/coverage.ts';
import { unresolvedInScope } from './scope-helpers.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
const baseline = baselineGeneration;

it('AdvancedSeries_AllRemainingRecordsMapped', () => {
  // Arrange
  const result = baseline();

  // Act & Assert
  expect(validateCoverage(schema, result.manifest).errors).toEqual([]);
  expect(unresolvedInScope(schema, result, 'advanced-series')).toEqual([]);
});

it('AdvancedSeries_MissingClosureUnionOrNewRouteFails', () => {
  // Arrange
  const result = baseline();
  const changed = structuredClone(result.manifest);

  // Act
  changed.entries.find(e => e.sourceId === 'public:option.series.graph.layout')!.alternatives.pop();

  // Assert
  expect(validateCoverage(schema, changed).errors.join('\n')).toMatch(/Missing\/changed union/);

  // Act
  const future = structuredClone(schema);
  const template = future.records.find(r => r.id === 'public:option.series.graph.layout');
  future.records.push({
    ...template,
    id: 'public:option.series.graph.futureStyle',
    publicPath: 'option.series.graph.futureStyle',
    name: 'futureStyle',
  });

  // Assert
  expect(unresolvedInScope(future, generate(future, overrides), 'advanced-series')).toEqual(['public:option.series.graph.futureStyle']);
});

it('WholeSeriesRegistry_PartitionIsComplete', () => {
  // Arrange
  const result = baseline();
  const partition = JSON.parse(result.files.get('docs/api-coverage/series-partition.json')!);

  // Act & Assert
  expect(partition.series.map(s => s.name).sort()).toEqual(schema.series.map(s => s.name).sort());
  expect(new Set(partition.series.map(s => s.name)).size).toBe(schema.series.length);
  expect(partition.series.every(s => ['standard', 'advanced'].includes(s.group))).toBe(true);
  expect(partition.extensions).toEqual([{ name: 'wordCloud', group: 'wordcloud', family: 'wordcloud' }]);
  expect(partition.series.filter(s => s.group === 'advanced').map(s => s.name).sort()).toEqual([
    'chord', 'custom', 'graph', 'sankey', 'sunburst', 'tree', 'treemap',
  ]);
});

it('CustomRenderItem_KeepsExactArgumentsResultsAndNativeBoundary', () => {
  // Arrange
  const result = baseline();

  // Act
  const contract = result.manifest.signatures.find(s => s.symbol === 'CustomRenderItemSignature')!;

  // Assert
  expect(contract).toBeDefined();
  expect(contract.symbol).toBe('CustomRenderItemSignature');
  expect(contract.signatures[0].parameters.map(p => p.name)).toEqual(['params', 'api']);

  // Act
  const types = new Map(schema.types.map(t => [t.id, t]));

  // Assert
  expect(types.get(contract.signatures[0].parameters[0].type)?.display).toBe('CustomSeriesRenderItemParams');
  expect(types.get(contract.signatures[0].parameters[1].type)?.display).toBe('CustomSeriesRenderItemAPI');

  // Act
  const returns = types.get(contract.signatures[0].returnType)!;

  // Assert
  expect(returns.kind).toBe('union');
  expect(returns.alternatives).toHaveLength(18);
});

it('CustomRenderItem_AcceptsARegisteredSeriesName', () => {
  // Arrange
  const result = baseline();

  // Act & Assert
  expect(result.files.get('src/BlazorECharts/Options/Generated/CustomSeriesOption.cs')).toContain('public CustomSeriesRenderItem? RenderItem');

  // Act
  const union = result.files.get('src/BlazorECharts/Values/Generated/CustomSeriesRenderItem.g.cs')!;

  // Assert
  expect(union).toContain('public static CustomSeriesRenderItem From(string value)');
  expect(union).toContain('public static CustomSeriesRenderItem From(JsFunction<CustomRenderItemSignature> value)');
  expect(result.manifest.entries.find(e => e.sourceId === 'public:option.series.custom.renderItem')?.status).toBe('generated');
  expect(result.scope!.assignments.get('public:option.series.custom.renderItem.arguments')?.set).toBe('K5d');
});
