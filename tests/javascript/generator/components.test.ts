import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { validateCoverage } from '../../../tools/BindingGenerator/src/coverage.ts';
import { optionPartition, optionGroup } from '../../../tools/BindingGenerator/src/option-partition.ts';
import { unresolvedInScope } from './scope-helpers.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
const baseline = baselineGeneration;

it('Components_AllPublicPathsHaveTypedMappings', () => {
  // Arrange
  const result = baseline();

  // Act & Assert
  expect(validateCoverage(schema, result.manifest).errors).toEqual([]);
  expect(unresolvedInScope(schema, result, 'components-coordinate')).toEqual([]);
  for (const path of [
    'option.xAxis', 'option.matrix', 'option.calendar', 'option.dataset',
    'option.angleAxis.axisLabel.rich.<style_name>.fontSize',
  ]) {
    const entry = result.manifest.entries.find(e => e.sourceId === `public:${path}`);
    expect(entry?.status, path).toBe('generated');
    expect(entry?.serializer, path).toBeTruthy();
    expect(entry?.reader, path).toBeTruthy();
  }
});

it('Components_PartitionCoversEveryOptionAndRegistryWithoutOverlap', () => {
  // Act
  const partition = optionPartition(schema);

  // Assert
  expect(new Set(partition.map(p => p.sourceId)).size).toBe(schema.records.filter(r => r.publicPath.startsWith('option.')).length);
  expect(optionGroup('option.series.sankey.data')).toEqual({ group: 'advanced', family: 'advanced-series' });
  expect(optionGroup('option.series.line.encode')).toEqual({ group: 'standard', family: 'standard-series' });
  expect(optionGroup('option.graphic')).toEqual({ group: 'graphic-custom', family: 'graphic-custom' });
  expect(optionGroup('option.series.wordCloud.shape')).toEqual({ group: 'wordcloud', family: 'wordcloud' });
  expect(optionGroup('option.title')).toEqual({ group: 'components', family: 'components-coordinate' });
  expect(schema.series.map(s => optionGroup(`option.series.${s.name}`).group).every(o => ['standard', 'advanced'].includes(o))).toBe(true);
});

it('Components_IndexSurfaceIsPresentInPublicBaselineAndSymbolInventory', () => {
  // Arrange
  const result = baseline();

  // Act
  const api = result.files.get('schemas/generated/public-api.txt')!;

  // Assert
  expect(api).toContain('  OptionDictionary<NumberOrStringOneOrMany?> Entries { get; }');
  for (const name of ['OptionEncode', 'ToolboxComponentOptionFeature']) {
    const file = result.manifest.files.find(f => f.path === `src/BlazorECharts/Options/Generated/${name}.cs`)!;
    expect(file.symbols).toContain(`${name}.Entries`);
  }
});

it('Components_NewPublicPathAndStaleSupplementFailTheGate', () => {
  // Arrange
  const copy = structuredClone(schema);
  const template = copy.records.find(r => r.id === 'public:option.title')!;

  // Act
  copy.records.push({ ...template, id: 'public:option.futureComponent', publicPath: 'option.futureComponent', name: 'futureComponent' });

  // Assert
  expect(unresolvedInScope(copy, generate(copy, overrides), 'components-coordinate')).toEqual(['public:option.futureComponent']);

  // Arrange
  const stale = structuredClone(overrides);
  stale.csharp.componentProperties[0].sha256 = 'stale';

  // Act & Assert
  expect(() => generate(schema, stale)).toThrow(/Stale component supplement/);
});

it('Components_PrimitiveWithOptionalDictionaryIsStillAnInhabitableString', () => {
  // Arrange
  const copy = structuredClone(schema);
  const root = copy.types.find(t => t.id === 'type:a274ece4f795b03fde116ff6')!;
  root.properties!.push({
    name: 'optionalDictionaryText',
    type: 'type:12e9ac563bacec4d3066c48e',
    optional: true,
    readonly: false,
    provenance: root.provenance,
  });
  const config = structuredClone(overrides);

  // The synthetic option field is not a mutation of the separately pinned
  // remaining-action runtime source closure.
  config.eventActions = config.eventActions.filter(m => !m.runtimeRemainingPayload);
  config.csharp.pins = config.csharp.pins.filter(p => p.typeId !== root.id);
  for (const p of config.csharp.componentProperties.filter(p => p.parent === root.id))
    p.sha256 = createHash('sha256').update(JSON.stringify(root)).digest('hex');

  // Act
  // This optional dictionary imposes no required members on its string constituent.
  const result = generate(copy, config);

  // Assert
  expect(result.files.get('src/BlazorECharts/Options/Generated/ChartOptions.cs')).toContain('public string? OptionalDictionaryText');
});

it('Generation_ComponentMappingsAreDeterministic', () => {
  // Arrange
  const first = baseline();

  // Act
  const second = generate(schema, overrides);

  // Assert
  expect([...first.files]).toEqual([...second.files]);

  // Act
  const broken = structuredClone(first.manifest);
  const target = broken.entries.find(e => e.sourceId === 'public:option.calendar');

  // Assert
  expect(target).toBeDefined();

  // Act
  target!.alternatives.pop();

  // Assert
  expect(validateCoverage(schema, broken).errors.join('\n')).toContain('public:option.calendar');
});

it(
  'Components_RepairOfAMissingProjectionNode_FailsTheProjection',
  async () => {
    // The repaired nodes are named by content-hash IDs; after an upgrade an absent ID must fail, not skip the repair.
    const { componentTypes, componentRepairs } = await import('../../../tools/BindingGenerator/src/component-types.ts');
    const projected = componentTypes(schema, overrides.csharp.specializeGenerics);
    expect(Object.values(componentRepairs).every(id => projected.some(t => t.id === id))).toBe(true);
    expect(() => componentTypes(schema, overrides.csharp.specializeGenerics, { ...componentRepairs, valueLabelOpt: 'type:000000000000000000000000' }))
      .toThrow('Component projection repairs type:000000000000000000000000');
  },
  300_000
);
