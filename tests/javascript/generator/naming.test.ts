import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { chooseTypeNames, routeKey, type NameHint, type NamingInput } from '../../../tools/BindingGenerator/src/type-names.ts';
import { generate, handWrittenTypes } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import type { ApiSchema, TypeNode } from '../../../tools/BindingGenerator/src/schema.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import type { GenerationResult } from '../../../tools/BindingGenerator/src/generation-model.ts';
import { baselineGeneration } from './baseline.ts';

const node = (id: string, kind: string, display: string, extra: Partial<TypeNode> = {}): TypeNode =>
  ({ id, kind, display, provenance: [], ...extra });

const hint = (owner: string, property = '', suffix = ''): NameHint => ({ owner, property, suffix });

function input(
  entries: { id: string; type: TypeNode; provisional: string; kind?: string; contexts: NameHint[] }[],
  extraTypes: TypeNode[] = [],
  fixed: [string, string][] = []
): NamingInput {
  return {
    order: entries.map(e => e.id),
    provisional: new Map([...fixed, ...entries.map(e => [e.id, e.provisional] as [string, string])]),
    fixed: new Map(fixed),
    contexts: new Map(entries.map(e => [e.id, e.contexts])),
    types: new Map([...entries.map(e => [e.id, e.type] as [string, TypeNode]), ...extraTypes.map(t => [t.id, t] as [string, TypeNode])]),
    kinds: new Map(entries.map(e => [e.id, e.kind ?? 'model'])),
  };
}

let cached: { schema: ApiSchema; overrides: any; result: GenerationResult } | undefined;

const production = async () => {
  if (!cached) {
    const schema = loadSchema();
    const overrides = JSON.parse(await readFile('schemas/overrides/echarts-6.1.0.json', 'utf8'));
    cached = { schema, overrides, result: baselineGeneration() };
  }

  return cached;
};

const literal = (id: string, value: string) => node(id, 'literal', JSON.stringify(value), { value });

const discriminated = (id: string, value: string) => node(id, 'intersection', `${value} axis & { mainType?: "xAxis"; }`, {
  constituents: [`${id}-base`],
  properties: [{ name: 'type', type: `${id}-type`, optional: true, readonly: false, provenance: [] }],
});

describe('type names', () => {
  it('Naming_DiscriminatedAlternative_UsesPropertyAndDiscriminator', () => {
    // Act
    const names = chooseTypeNames(input(
      [
        {
          id: 'a',
          type: discriminated('a', 'category'),
          provisional: 'ChartOptionsXAxisItemAlternative_0858e74e97',
          contexts: [{ ...hint('XAxisOption', '', 'Alternative'), union: hint('ChartOptions', 'XAxis', 'Item') }],
        },
        {
          id: 'b',
          type: discriminated('b', 'value'),
          provisional: 'ChartOptionsXAxisItemAlternative',
          contexts: [{ ...hint('XAxisOption', '', 'Alternative'), union: hint('ChartOptions', 'XAxis', 'Item') }],
        },
        {
          id: 'c',
          type: discriminated('c', 'value'),
          provisional: 'ParallelOptionParallelAxisAlternative',
          contexts: [{ ...hint('ParallelOptionParallelAxis', '', 'Alternative'), union: hint('ParallelOption', 'ParallelAxis') }],
        },
      ],
      [literal('a-type', 'category'), literal('b-type', 'value'), literal('c-type', 'value')],
      [['root', 'ChartOptions']]
    ));

    // Assert
    expect([names.get('a'), names.get('b'), names.get('c')]).toEqual(['XAxisCategoryOption', 'XAxisValueOption', 'ParallelParallelAxisValueOption']);
  });

  it('Naming_SharedGenericInstantiation_UsesUpstreamNameWithLiteralArguments', () => {
    // Arrange
    const target = node('t', 'object', 'AxisLabelOption<TType>');

    // Act
    const names = chooseTypeNames(input(
      [
        {
          id: 'v',
          type: node('v', 'generic-reference', 'AxisLabelOption<"value">', { target: 't', typeArguments: ['lv'] }),
          provisional: 'AngleAxisValueAxisLabel',
          contexts: [hint('AngleAxisValueOption', 'AxisLabel'), hint('RadarOption', 'AxisLabel')],
        },
        {
          id: 'vl',
          type: node('vl', 'intersection', 'AxisLabelOption<"value"> & AxisLabelOption<"log">', { constituents: ['v', 'l'] }),
          provisional: 'AngleAxisValueAxisLabelAlternative_2afe6470de',
          contexts: [hint('AngleAxisValueOption', 'AxisLabel', 'Alternative')],
        },
        {
          id: 'vc',
          type: node('vc', 'intersection', 'AxisLabelOption<"value"> & AxisLabelOption<"category">', { constituents: ['v', 'c'] }),
          provisional: 'AngleAxisValueAxisLabelAlternative_a7eae7a5d3',
          contexts: [hint('AngleAxisValueOption', 'AxisLabel', 'Alternative')],
        },
      ],
      [
        target,
        literal('lv', 'value'),
        literal('ll', 'log'),
        literal('lc', 'category'),
        node('l', 'generic-reference', 'AxisLabelOption<"log">', { target: 't', typeArguments: ['ll'] }),
        node('c', 'generic-reference', 'AxisLabelOption<"category">', { target: 't', typeArguments: ['lc'] }),
      ]
    ));

    // Assert
    // Single-context alternatives keep their context name until it collides; the upstream name then breaks the tie.
    expect([names.get('v'), names.get('vl'), names.get('vc')]).toEqual([
      'ValueAxisLabelOption', 'ValueLogAxisLabelOption', 'ValueCategoryAxisLabelOption',
    ]);
  });

  it('Naming_TiedUpstreamNames_FallBackToTheirContexts', () => {
    // Arrange
    const target = node('t', 'object', 'ItemStyleOption<TCbParams>');
    const shared = (id: string, owner: string) => ({
      id,
      type: node(id, 'generic-reference', `ItemStyleOption<${id}>`, { target: 't', typeArguments: [] }),
      provisional: `${owner}ItemStyle`,
      contexts: [hint(owner, 'ItemStyle'), hint(owner, 'EmphasisItemStyle')],
    });

    // Act
    const names = chooseTypeNames(input([shared('series', 'BoxplotSeriesOption'), shared('data', 'BoxplotDataItemOption')], [target]));

    // Assert
    expect([names.get('series'), names.get('data')]).toEqual(['BoxplotSeriesOptionItemStyle', 'BoxplotDataItemOptionItemStyle']);
  });

  it('Naming_TsIdentifierWinsOverUpstreamAlias_LoserTakesSharedPropertyName', () => {
    // Act
    const names = chooseTypeNames({
      ...input([
        {
          id: 'ts',
          type: node('ts', 'union', 'ZRColor', { alternatives: [] }),
          provisional: 'ZRColor',
          kind: 'union',
          contexts: [hint('A', 'Color'), hint('B', 'Color')],
        },
        {
          id: 'copy',
          type: node('copy', 'union', 'string | LinearGradientObject', { alternatives: [] }),
          provisional: 'SplitAreaOptionAreaStyleColorItem',
          kind: 'union',
          contexts: [hint('SplitAreaOptionAreaStyle', 'Color', 'Item'), hint('MarkAreaOption', 'Color')],
        },
      ]),
      alias: t => t.id === 'copy' ? 'ZRColor' : undefined,
    });

    // Assert
    expect([names.get('ts'), names.get('copy')]).toEqual(['ZRColor', 'Color']);
  });

  it('Naming_LockedName_SurvivesANewSharedDeclaration', () => {
    // Arrange
    const target = node('t', 'object', 'ItemStyleOption<TCbParams>');

    // Act
    const shared = (id: string, owner: string) => ({
      id,
      type: node(id, 'generic-reference', `ItemStyleOption<${id}>`, { target: 't', typeArguments: [] }),
      provisional: `${owner}ItemStyle`,
      contexts: [hint(owner, 'ItemStyle'), hint(owner, 'EmphasisItemStyle')],
    });

    // Assert
    expect(chooseTypeNames(input([shared('series', 'BoxplotSeriesOption')], [target])).get('series')).toBe('ItemStyleOption');

    // Act
    // Release N locked the name; release N+1 adds a second declaration that ties on it.
    const locked = new Map([[routeKey(hint('BoxplotSeriesOption', 'EmphasisItemStyle'), undefined, new Map()), 'ItemStyleOption']]);
    const names = chooseTypeNames({ ...input([shared('series', 'BoxplotSeriesOption'), shared('data', 'BoxplotDataItemOption')], [target]), locked });

    // Assert
    expect([names.get('series'), names.get('data')]).toEqual(['ItemStyleOption', 'BoxplotDataItemOptionItemStyle']);
  });

  it('Naming_LockedAlternative_IsKeyedByItsDiscriminatorOrFingerprint', () => {
    // Arrange
    const union = { ...hint('XAxisOption', '', 'Alternative'), union: hint('ChartOptions', 'XAxis', 'Item') };
    const types = new Map([literal('a-type', 'category'), literal('b-type', 'value')].map(t => [t.id, t] as [string, TypeNode]));

    // Act & Assert
    expect(routeKey(union, discriminated('a', 'category'), types)).toBe('XAxisOption|category');
    expect(routeKey(union, node('b', 'object', '{ x?: number; }'), types)).toBe('XAxisOption|{ x?: number; }');

    // Bundle suffixes ($1) are not part of the fingerprint; a long declaration keeps a readable prefix and a hash of the rest.
    expect(routeKey(union, node('c', 'object', '(extra: NullUndefined$1 | AxisLabelFormatterExtraBreakPart) => string'), types)).toBe(
      'XAxisOption|(extra: NullUndefined | AxisLabelFormatterExtraBreakPart) => string'
    );

    // Act
    const long = routeKey(union, node('d', 'object', `{ ${'member?: number; '.repeat(20)}}`), types);

    // Assert
    expect(long).toMatch(/^XAxisOption\|\{ member\?: number; .{70,}…[0-9a-f]{12}$/);
    expect(long.length).toBeLessThan(140);
    expect(routeKey(hint('TitleOption', 'TextStyle'), undefined, types)).toBe('TitleOption.TextStyle');
  });

  it('Naming_ReorderedUnionAlternatives_KeepTheirLockedNames', () => {
    // Release N+1 changes the ids of two unnamed alternatives and so their order; the lock follows each type.

    // Arrange
    const generic = (label: string) =>
      node('g' + label, 'generic-reference', `AxisLabelOption<"${label}">`, { target: 't', typeArguments: ['l' + label] });
    const both = (id: string, a: string, b: string) =>
      node(id, 'intersection', `AxisLabelOption<"${a}"> & AxisLabelOption<"${b}">`, { constituents: ['g' + a, 'g' + b] });
    const extra = [node('t', 'object', 'AxisLabelOption<TType>'), ...['category', 'time', 'log'].flatMap(l => [literal('l' + l, l), generic(l)])];
    const union = hint('AngleAxisCategoryOption', 'AxisLabel');
    const alternative = (index: number) => ({ ...hint('AngleAxisCategoryOptionAxisLabel', '', 'Alternative'), union, index });
    const release = (order: { A: number; B: number }, locked?: Map<string, string>) => chooseTypeNames({
      ...input(
        [
          { id: 'A', type: both('A', 'category', 'time'), provisional: 'ProvA', contexts: [alternative(order.A)] },
          { id: 'B', type: both('B', 'category', 'log'), provisional: 'ProvB', contexts: [alternative(order.B)] },
        ],
        extra
      ),
      ...(locked ? { locked } : {}),
    });

    // Act
    const first = release({ A: 0, B: 1 });

    // Assert
    expect([first.get('A'), first.get('B')]).toEqual(['CategoryTimeAxisLabelOption', 'CategoryLogAxisLabelOption']);

    // Act
    const types = new Map([...extra, both('A', 'category', 'time'), both('B', 'category', 'log')].map(t => [t.id, t] as [string, TypeNode]));
    const lock = new Map([
      [routeKey(alternative(0), types.get('A'), types), first.get('A')!],
      [routeKey(alternative(1), types.get('B'), types), first.get('B')!],
    ]);

    // Assert
    expect([...lock.keys()]).not.toContainEqual(expect.stringContaining('|#'));

    // Act
    const next = release({ A: 1, B: 0 }, lock);

    // Assert
    expect([next.get('A'), next.get('B')]).toEqual(['CategoryTimeAxisLabelOption', 'CategoryLogAxisLabelOption']);
  });

  it('Naming_AlternativesWithOneFingerprint_FailWithTypeNameLock', () => {
    // Arrange
    const union = hint('LegendOption', 'Data');
    const same = (id: string) => ({
      id,
      type: node(id, 'object', '{ name?: string; }', { properties: [] }),
      provisional: `Legend${id}`,
      contexts: [{ ...hint('LegendOptionData', '', 'Alternative'), union }],
    });

    // Act & Assert
    expect(() => chooseTypeNames(input([same('x'), same('y')]))).toThrow(/TYPE_NAME_LOCK .*LegendOptionData\|\{ name\?: string; \}.*x, y/);
  });

  it('Naming_WithoutFixedPoint_FailsWithCsharpNameUnstable', () => {
    // Two types reached only through each other's provisional names grow by one word per round.

    // Arrange
    const model = (id: string) => node(id, 'object', `{ ${id}?: number; }`, { properties: [] });
    const names = () => chooseTypeNames(input([
      { id: 'p', type: model('p'), provisional: 'P0', contexts: [hint('Q0', 'Next')] },
      { id: 'q', type: model('q'), provisional: 'Q0', contexts: [hint('P0', 'Next')] },
    ]));

    // Act & Assert
    expect(names).toThrow(/CSHARP_NAME_UNSTABLE .*\bp\b.*\bq\b/);
  });

  it('Naming_ReservedNames_AreComparedWithoutCase', () => {
    // Act
    const names = chooseTypeNames({
      ...input([
        { id: 'e', type: node('e', 'object', 'Echart', { properties: [] }), provisional: 'Echart', contexts: [hint('ChartOptions', 'Echart')] },
      ]),
      reserved: new Set(['EChart']),
    });

    // Assert
    expect(names.get('e')).toBe('ChartOptionsEchart');
  });

  it('Naming_UnresolvableCollision_FailsWithoutHashSuffix', () => {
    // Arrange
    const same = (id: string) => ({
      id,
      type: node(id, 'object', `{ ${id}?: number; }`, { properties: [] }),
      provisional: `LegendOptionData${id}`,
      contexts: [hint('LegendOption', 'Data')],
    });

    // Act & Assert
    expect(() => chooseTypeNames(input([same('x'), same('y')]))).toThrow(/CSHARP_NAME_COLLISION LegendOptionData: x, y/);
  });
});

describe('production names', () => {
  it('Naming_PublicApi_HasStableNamesWithoutHashes', async () => {
    // Arrange
    const api = (await production()).result.files.get('schemas/generated/public-api.txt')!;

    // Act
    const types = new Set(api.split('\n').filter(l => /^[A-Za-z]/.test(l)).map(l => l.split(' ')[0]));

    // Assert
    expect([...types].filter(t => /_[0-9a-f]{8,}$/.test(t) || /^(GlobalData|GlobalUnion|BrowserCallback)/.test(t))).toEqual([]);
    for (const name of [
      'XAxisCategoryOption', 'XAxisValueOption', 'XAxisTimeOption', 'XAxisLogOption', 'YAxisValueOption', 'AngleAxisCategoryOption',
      'RadiusAxisValueOption', 'ValueAxisLabelOption', 'CategoryAxisLabelOption', 'HighlightPayloadEasingSignature', 'SeriesLabelOption',
      'ItemStyleOption', 'StaticItemStyleOption', 'LineStyleOption', 'TextAlign', 'AnimationDelay', 'AnimationDelayAlternativeSignature',
      'OptionDataValue', 'OptionDataItemValue', 'XAxisOption', 'YAxisOption', 'DataZoomOption', 'LegendComponentOption', 'VisualMapOption',
      'ParallelAxisOption', 'ParallelAxisDefaultValueOption',
    ])
      expect(types, name).toContain(name);

    // Unions with the same alternatives are one type: the palette takes the same ZRColor as every color.
    expect(api).toContain('  ZRColorOneOrMany? Color [color]');

    // No impossible never alternatives (an empty never[] array stays), no private upstream members.
    expect(api).not.toMatch(/From\(NeverValue\)|NeverValue\? \w+ \[/);
    expect(api).not.toMatch(/^ {2}\S.* _\w* (\{|\[)/m);
    for (const twin of [
      'ZRColorItem', 'NumberOrStringItem', 'OptionId', 'ScaleDataValue', 'OptionDataValueDate', 'IconStyleTextAlign', 'ChartOptionsXAxisItem',
      'ChartOptionsLegendItem',
    ])
      expect(types, twin).not.toContain(twin);

    for (const misleading of [
      'CandlestickStateOptionLabel', 'ChartOptionsAngleAxisItemAlternativeBreakAreaItemStyle', 'SplitAreaOptionAreaStyleColorItem',
      'CalendarOptionRangeItem', 'PathPropsExtra',
    ])
      expect(types, misleading).not.toContain(misleading);
  });
});

describe('type name lock', () => {
  it(
    'Naming_TypeNameLock_CoversEveryNameAndRejectsALostName',
    async () => {
      const { schema, overrides, result } = await production();
      const lock = JSON.parse(result.files.get('schemas/generated/type-names.lock.json')!) as Record<string, string>;
      const generated = [...result.files.keys()]
        .filter(path => /src\/BlazorECharts\/(Options\/Generated\/[^/]+(?<!\.g)\.cs|Values\/Generated\/(Signatures\/)?[^/]+\.g\.cs)$/.test(path))
        .map(path => path.split('/').pop()!.replace(/(\.g)?\.cs$/, ''));

      // The series base and the runtime node targets have fixed emitters, not chosen names.
      expect(generated.filter(name => !(name in lock))).toEqual(['SeriesOption', 'SunburstNodeTarget', 'TreemapNodeTarget']);
      expect(lock.ChartOptions).toBe('ChartOptions.');
      expect(() => generate(schema, overrides, { ...lock, LostTypeName: 'ChartOptions.Lost' })).toThrow(
        /TYPE_NAME_LOCK LostTypeName \(ChartOptions\.Lost\)/
      );
    },
    240_000
  );
});

describe('reserved names', () => {
  it('Naming_HandWrittenTypes_AreFoundAndNeverReused', async () => {
    // Act
    const reserved = handWrittenTypes();

    // Assert
    // Partial and internal hand-written types too: EChart is partial, ReadValue lives in the namespace of generated values.
    for (const name of [
      'EChart', 'EChartInstance', 'EChartsRuntime', 'ReadValue', 'EChartsError', 'EChartsRuntimeOptions', 'EChartsRuntimeProvider', 'OptionMetadata',
      'ChartSubscription', 'WordCloudExtension',
    ])
      expect(reserved, name).toContain(name);

    expect(reserved.length).toBeGreaterThan(40);

    // Act
    const { result } = await production();
    const generated = [...result.files.keys()]
      .filter(path => /\/Generated\/.*\.cs$/.test(path))
      .map(path => path.split('/').pop()!.replace(/(\.Serializer)?(\.g)?\.cs$/, ''));
    const lower = new Set(reserved.map(name => name.toLowerCase()));

    // Assert
    expect(generated.filter(name => lower.has(name.toLowerCase()))).toEqual([]);

    // Act
    // File names must also be unique on case-insensitive file systems.
    const paths = [...result.files.keys()].map(path => path.toLowerCase());

    // Assert
    expect(paths.length - new Set(paths).size).toBe(0);
  });
});

describe('documentation boundary', () => {
  it('Docs_SummariesNameLiteralsDefaultsAndPagesWithoutHashes', async () => {
    // Arrange
    const { files } = (await production()).result;

    // Act
    const docs = [...files]
      .filter(([path]) => /src\/BlazorECharts\/.*\.cs$/.test(path))
      .flatMap(([, text]) => text.split('\n').filter(l => l.trimStart().startsWith('///')));

    // Assert
    expect(docs.filter(l => /type:[0-9a-f]{24}/.test(l))).toEqual([]);

    // Act
    const legend = files.get('src/BlazorECharts/Options/Generated/LegendOption.cs')!;

    // Assert
    expect(legend).toContain(
      '/// <summary>The ECharts <c>legend</c> option.</summary>\n/// <seealso href="https://echarts.apache.org/en/option.html#legend"/>'
    );
    expect(legend).toMatch(/<remarks>ECharts default: <c>'horizontal'<\/c>\.<\/remarks>\n {4}public \w+\? Orient /);
    expect(files.get('src/BlazorECharts/Options/Generated/BarSeriesOption.cs')).toContain('#series-bar"/>');
    expect(files.get('src/BlazorECharts/Values/Generated/TextAlign.g.cs')).toContain(
      '/// <summary>One of <c>"center"</c>, <c>"left"</c> or <c>"right"</c>.</summary>'
    );
    expect(files.get('src/BlazorECharts/Values/Generated/NumberOrAuto.g.cs')).toContain('/// <summary>A number or <c>"auto"</c>.</summary>');
  });

  it('Docs_TsOnlyMembers_AreMarkedInXmlDocumentation', async () => {
    // Act
    const { files } = (await production()).result;

    // Assert
    const member = (file: string, property: string) => {
      const lines = files.get(`src/BlazorECharts/Options/Generated/${file}.cs`)!.split('\n');
      const at = lines.findIndex(l => l.includes(` ${property} { get =>`));
      expect(at, property).toBeGreaterThan(0);
      return lines.slice(at - 3, at).join('\n');
    };

    // Act
    const remark = 'Not described by echarts-doc';

    // Assert
    expect(member('LineSeriesOption', 'SourceHeader')).toContain(remark);
    expect(member('LineSeriesOption', 'ColorLayer')).toContain(remark);
    expect(member('BarSeriesOption', 'BarWidth')).not.toContain(remark);
    expect(member('ChartOptions', 'XAxis')).not.toContain(remark);
  });
});
