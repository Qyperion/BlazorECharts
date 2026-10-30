import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { prepareComponentTypes } from '../../../tools/BindingGenerator/src/component-types.ts';
import { graphicRuntimeContracts } from '../../../tools/BindingGenerator/src/graphic-options.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
let result: ReturnType<typeof generate>;

beforeAll(() => { result = baselineGeneration(); });

it('GraphicGeometry_HasTypedDiscriminatedArcAndRectMappings', () => {
  // Act & Assert
  for (const path of [
    'arc', 'arc.shape.cx', 'arc.shape.cy', 'arc.shape.r', 'arc.shape.clockwise', 'rect', 'rect.shape.x', 'rect.shape.width', 'circle.shape.r',
    'line.shape.x2', 'bezierCurve.shape.cpx1',
  ]) {
    const entry = result.manifest.entries.find(e => e.sourceId === 'public:option.graphic.elements.' + path);
    expect(entry?.status, path).toBe('generated');
    expect(entry?.targets?.length, path).toBeGreaterThan(0);
  }

  expect(result.files.has('src/BlazorECharts/Options/Generated/GraphicArcOption.cs')).toBe(true);
  expect(result.files.has('src/BlazorECharts/Options/Generated/GraphicArcShape.cs')).toBe(true);

  // Act
  const arc = result.files.get('src/BlazorECharts/Options/Generated/GraphicArcShape.cs')!;

  // Assert
  expect(arc).toContain('double? Cx');
  expect(arc).toContain('bool? Clockwise');
});

it('GraphicGeometry_RejectsStaleNativeShapePin', () => {
  // Act
  const changed = structuredClone(overrides);

  // Assert
  expect(changed.csharp.graphicVariants?.length).toBeGreaterThan(0);

  // Arrange
  changed.csharp.graphicVariants[0].nativeHash = '0'.repeat(64);

  // Act & Assert
  expect(() => prepareComponentTypes(schema, changed.csharp)).toThrow(/Stale graphic variant/);
});

it('GraphicGeometry_PreservesGenericEscapeHatchAndSeriesRegistry', () => {
  // Act & Assert
  expect(result.files.get('src/BlazorECharts/Options/Generated/GraphicComponentZRPathOption.cs')).toBeTruthy();

  // Act
  const registry = result.files.get('src/BlazorECharts/Serialization/Generated/GeneratedOptionMetadata.g.cs')!;

  // Assert
  expect(registry).not.toMatch(/RegisterSeries\("(?:arc|circle|rect)"/);
  expect(registry).toContain('OptionTypeRegistration<GraphicArcOption>');
});

it('GraphicGeometry_RecordsNativeReservationsWithoutClaimingSupport', () => {
  // Act
  const runtime = graphicRuntimeContracts(schema);

  // Assert
  expect(runtime.reserved).toEqual(['compoundPath', 'path']);
  expect(runtime.supported).toHaveLength(10);

  // Arrange
  const changed = structuredClone(overrides);
  changed.csharp.graphicVariants[0].discriminator = 'compoundPath';

  // Act & Assert
  expect(() => prepareComponentTypes(schema, changed.csharp)).toThrow(/Unsupported pinned graphic variant compoundPath/);
});

it('GraphicElements_ExposeRuntimeHandlersDuringAndTextLayout', () => {
  // Arrange
  const elements = ['arc', 'bezierCurve', 'circle', 'group', 'image', 'line', 'polygon', 'polyline', 'rect', 'ring', 'sector', 'text'];

  // Act
  const textConfig = [
    '', '.distance', '.inside', '.insideFill', '.insideStroke', '.layoutRect', '.local', '.offset', '.origin', '.outsideFill', '.outsideStroke',
    '.position', '.rotation',
  ].map(p => 'text.textConfig' + p);

  // Assert
  for (const path of [...elements.map(e => e + '.onmouseover'), 'group.during', 'image.during', 'text.during', ...textConfig]) {
    const entry = result.manifest.entries.find(e => e.sourceId === 'public:option.graphic.elements.' + path);
    expect(entry?.status, path).toBe('generated');
  }

  for (const name of ['GraphicArcOption', 'GraphicGroupOption', 'GraphicImageOption', 'GraphicTextOption', 'GraphicComponentZRPathOptionTextContent'])
    expect(result.files.get(`src/BlazorECharts/Options/Generated/${name}.cs`), name).toContain('JsFunction<GraphicOnClickSignature>? OnMouseOver');

  expect(result.files.get('src/BlazorECharts/Options/Generated/GraphicGroupOption.cs')).toContain('JsFunction<GraphicGroupDuringSignature>? During');
  expect(result.files.get('src/BlazorECharts/Options/Generated/GraphicImageOption.cs')).toContain(
    'JsFunction<GraphicElementDuringSignature>? During'
  );
  for (const name of ['GraphicTextOption']) {
    const text = result.files.get(`src/BlazorECharts/Options/Generated/${name}.cs`)!;
    expect(text).toContain('JsFunction<GraphicElementDuringSignature>? During');
    expect(text).toContain('ElementTextConfig? TextConfig');
    expect(text).not.toContain('TextContent');
    expect(text).toMatch(/ECharts 4 style[^\n]*\n(?:[^\n]*<remarks>[^\n]*\n)?[^\n]*TextConfig/);
  }

  // ZRText.setTextContent throws: a text element cannot carry another text element.
  expect(result.scope!.assignments.get('public:option.graphic.elements.text.textContent')).toEqual({ set: 'K9', rule: 'graphic-text-content' });

  // Act
  const unresolved = [...result.scope!.assignments].filter(([id, a]) => a.set === 'S1'
    && id.startsWith('public:option.graphic')
    && !result.manifest.entries.some(e => e.sourceId === id && e.status === 'generated'));

  // Assert
  expect(unresolved).toEqual([]);
});
