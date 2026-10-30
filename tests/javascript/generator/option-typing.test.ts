import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareComponentTypes } from '../../../tools/BindingGenerator/src/component-types.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
const numberOrString = 'type:9b40621d2c224d46ffe6b999';
const numbers = 'type:065686656ad2290597ca7832';
const zrColor = 'type:70fbb6d87d34c98455846f9e';
const colorOrCallback = 'type:2a827a652f87341006dd1b78';

const result = baselineGeneration;

const target = (path: string) => {
  const entry = result().manifest.entries.find(e => e.sourceId === 'public:' + path);
  expect(entry?.status, path).toBe('generated');
  return entry!.targets!;
};

const member = (cls: string, json: string) => {
  const api = result().files.get('schemas/generated/public-api.txt')!.split('\n');
  const start = api.findIndex(l => l.startsWith(cls + ' : '));
  expect(start, cls).toBeGreaterThanOrEqual(0);
  const end = api.findIndex((l, i) => i > start && !l.startsWith('  '));
  return api.slice(start + 1, end).find(l => l.endsWith(` [${json}]`))?.trim();
};

it('OptionTyping_NoLooseDocumentedValues', () => {
  // Act & Assert
  expect(result().scope!.loose).toEqual([]);
});

it('VisualMapChannels_TypedScalarArrayAndCategoryTable', () => {
  // Act & Assert
  for (const owner of ['continuous', 'piecewise'])
    for (const path of ['inRange', 'outOfRange', 'controller.inRange', 'controller.outOfRange'])
      expect(target(`option.visualMap.${owner}.${path}`).map(t => t.symbol.split('.').pop())).not.toContain(
        'ContinuousVisualMapOptionControllerInRange'
      );

  expect(member('ContinuousVisualMapOption', 'inRange')).toBe('VisualMapChannelsOption? InRange [inRange]');
  expect(member('PiecewiseVisualMapOption', 'outOfRange')).toBe('VisualMapChannelsOption? OutOfRange [outOfRange]');
  for (const [json, channel] of [
    ['color', 'VisualMapStringChannel'],
    ['symbol', 'VisualMapStringChannel'],
    ['symbolSize', 'VisualMapNumberChannel'],
    ['opacity', 'VisualMapNumberChannel'],
    ['colorAlpha', 'VisualMapNumberChannel'],
    ['colorHue', 'VisualMapNumberChannel'],
    ['colorSaturation', 'VisualMapNumberChannel'],
    ['colorLightness', 'VisualMapNumberChannel'],
    ['liftZ', 'VisualMapNumberChannel'],
    ['decal', 'VisualMapDecalChannel'],
  ])
    expect(member('VisualMapChannelsOption', json)).toMatch(new RegExp(`^${channel}\\? \\w+ \\[${json}\\]$`));

  // Act
  const files = result().files;
  const strings = files.get('src/BlazorECharts/Values/Generated/VisualMapStringChannel.g.cs')!;

  // Assert
  for (const form of ['string value', 'string?[] value', 'OptionDictionary<string?> value'])
    expect(strings).toContain(`public static VisualMapStringChannel From(${form})`);

  // Act
  const numeric = files.get('src/BlazorECharts/Values/Generated/VisualMapNumberChannel.g.cs')!;

  // Assert
  for (const form of ['double value', 'double?[] value', 'OptionDictionary<double?> value'])
    expect(numeric).toContain(`public static VisualMapNumberChannel From(${form})`);

  // Act
  const decals = files.get('src/BlazorECharts/Values/Generated/VisualMapDecalChannel.g.cs')!;

  // Assert
  for (const form of ['DecalObject value', 'DecalObject?[] value', 'OptionDictionary<DecalObject?> value'])
    expect(decals).toContain(`public static VisualMapDecalChannel From(${form})`);
});

it('ComponentNodeIds_ProduceValidLambdaNames', () => {
  // Act
  const invalid = [...result().files].filter(([path, text]) => path.endsWith('.cs') && /\bitem\w*-/.test(text)).map(([path]) => path);

  // Assert
  expect(invalid).toEqual([]);
});

it('ScalarOptions_AcceptDocumentedAlternatives', () => {
  // Act & Assert
  for (const owner of ['continuous', 'piecewise'])
    expect(target(`option.visualMap.${owner}.dimension`)[0].typeId).toBe(numberOrString);

  expect(target('option.series.gauge.splitLine.length')[0].typeId).toBe(numberOrString);
  expect(target('option.legend.pageIconSize')[0].typeId).toBe(numbers);
  for (const kind of ['line', 'bar'])
    expect(target(`option.toolbox.feature.magicType.seriesIndex.${kind}`)[0].typeId).toBe(numbers);

  expect(member('ScrollableLegendOption', 'pageIconSize')).toBe('OneOrMany<double?>? PageIconSize [pageIconSize]');
  for (const state of ['', 'emphasis.', 'blur.', 'select.', 'data.', 'data.emphasis.', 'data.blur.', 'data.select.'])
    expect(target(`option.series.candlestick.${state}itemStyle.borderColor0`).map(t => t.typeId)).toEqual([zrColor]);

  expect(member('CandlestickItemStyleOption', 'borderColor0')).toBe('ZRColor? BorderColor0 [borderColor0]');
  expect(target('option.series.radar.itemStyle.color').map(t => t.typeId)).toEqual([colorOrCallback]);
  expect(target('option.series.radar.emphasis.itemStyle.color').map(t => t.typeId)).toEqual([zrColor]);
});

it('CustomSeriesData_AcceptsValuesValueArraysAndItems', () => {
  // Act & Assert
  expect(member('CustomSeriesOption', 'data')).toBe('CustomSeriesOptionDataItem?[]? Data [data]');

  // Act
  const union = result().files.get('src/BlazorECharts/Values/Generated/CustomSeriesOptionDataItem.g.cs')!;

  // Assert
  for (const form of ['double value', 'string value', 'DateTimeOffset value', 'CustomDataItemOption value'])
    expect(union).toContain(`public static CustomSeriesOptionDataItem From(${form})`);

  expect(union).toMatch(/public static CustomSeriesOptionDataItem From\(\w+\?\[\] value\)/);
  expect(result().files.has('src/BlazorECharts/Values/Generated/CustomSeriesData.g.cs')).toBe(false);
});

it('FunnelSort_AcceptsComparatorSignature', () => {
  // Act
  const union = result().files.get('src/BlazorECharts/Values/Generated/FunnelSeriesOptionSort.g.cs')!;

  // Assert
  expect(union).toContain('public static FunnelSeriesOptionSort From(string value)');
  expect(union).toContain('public static FunnelSeriesOptionSort From(JsFunction<FunnelSortComparatorSignature> value)');

  // Act
  const contract = result().manifest.signatures.find(s => s.symbol === 'FunnelSortComparatorSignature')!;

  // Assert
  expect(contract.signatures).toHaveLength(1);

  // Act
  const kinds = new Map(schema.types.map((t: { id: string; kind: string }) => [t.id, t.kind]));

  // Assert
  expect(contract.signatures[0].parameters.map(p => [p.name, kinds.get(p.type)])).toEqual([['a', 'number'], ['b', 'number']]);
  expect(kinds.get(contract.signatures[0].returnType)).toBe('number');
});

it('ComponentNodes_DictionaryAndSignatureNodesAreValidated', () => {
  // Arrange
  const config = () => structuredClone(overrides.csharp);
  const node = (c: ReturnType<typeof config>, id: string) => c.componentNodes.find((n: { id: string }) => n.id === id);
  const dictionary = config();
  node(dictionary, 'type:visual-map-number-table').indexes[0].key = 'type:6aa0dbf237a420195c29828a';

  // Act & Assert
  expect(() => prepareComponentTypes(schema, dictionary)).toThrow(/Invalid component node type:visual-map-number-table/);

  // Arrange
  const unverified = config();
  node(unverified, 'type:visual-map-number-table').provenance = ['source:missing'];

  // Act & Assert
  expect(() => prepareComponentTypes(schema, unverified)).toThrow(/Invalid component node type:visual-map-number-table/);

  // Arrange
  const parameter = config();
  node(parameter, 'type:funnel-sort-comparator').signatures[0].parameters[0].type = 'type:missing';

  // Act & Assert
  expect(() => prepareComponentTypes(schema, parameter)).toThrow(/Invalid component node type:funnel-sort-comparator/);

  // Arrange
  const generic = config();
  node(generic, 'type:funnel-sort-comparator').signatures[0].typeParameters = [{ name: 'T', type: 'type:6aa0dbf237a420195c29828a' }];

  // Act & Assert
  expect(() => prepareComponentTypes(schema, generic)).toThrow(/Invalid component node type:funnel-sort-comparator/);

  // Arrange
  const mixed = config();
  node(mixed, 'type:funnel-sort-comparator').properties = [
    { name: 'x', type: 'type:6aa0dbf237a420195c29828a', optional: true, readonly: false, provenance: [] },
  ];

  // Act & Assert
  expect(() => prepareComponentTypes(schema, mixed)).toThrow(/Invalid component node type:funnel-sort-comparator/);
});
