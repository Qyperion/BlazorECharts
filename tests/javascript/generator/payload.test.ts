import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateMappings } from '../../../tools/BindingGenerator/src/validate-mappings.ts';
import type { GenerationResult } from '../../../tools/BindingGenerator/src/generation-model.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
let result: GenerationResult;

beforeAll(() => { result = baselineGeneration(); });

// Each payload is declared once and re-exported eight times; the family root is the one generated declaration.
describe.each([
  {
    name: 'Payload',
    family: 'dto:payload',
    members: 11,
    closure: [['type:5c9dea03a5955e070dfd736d', 'type'], ['type:0b795c3a69b29c1d2d625e6d', 'animation'], ['type:d7e50ced505fc676b1611328', 'easing']],
  },
  {
    name: 'HighlightPayload',
    family: 'dto:highlight-payload',
    members: 12,
    closure: [
      ['type:b6a7105543dcfad3f9b3abf3', 'notBlur'],
      ['type:0b795c3a69b29c1d2d625e6d', 'animation'],
      ['type:d7e50ced505fc676b1611328', 'easing'],
    ],
  },
  {
    name: 'DownplayPayload',
    family: 'dto:downplay-payload',
    members: 12,
    closure: [
      ['type:68989db663885fbf1c727dc2', 'notBlur'],
      ['type:0b795c3a69b29c1d2d625e6d', 'animation'],
      ['type:d7e50ced505fc676b1611328', 'easing'],
    ],
  },
])('$name', ({ name, family: familyId, members, closure }) => {
  it(`${name}_OneOfNineExportsIsTheGeneratedRootOfACompleteFamily`, () => {
    // Act
    const exports = schema.records.filter((r: any) => r.name === name || r.name.endsWith(`___${name}`));

    // Assert
    expect(exports).toHaveLength(9);

    // Act
    const family = result.manifest.families.find(f => f.id === familyId)!;
    const roots = exports.filter((r: any) => r.id === family.rootSourceId);

    // Assert
    expect(roots).toHaveLength(1);

    // Act
    const entry = result.manifest.entries.find(e => e.sourceId === roots[0].id);

    // Assert
    expect(entry?.status).toBe('generated');
    expect(entry?.symbol).toBe(name);
    expect(entry?.reader).toBe(`GeneratedOptionMetadata.Read${name}`);
    expect(entry?.serializer).toBe(`GeneratedOptionMetadata.Write${name}`);
    expect(family.sourceIds).toHaveLength(members);
    for (const id of family.sourceIds)
      expect(result.manifest.entries.find(e => e.sourceId === id)?.status, id).toBe('generated');
  });

  it.each(closure)(`${name}_RejectsStaleClosure_%s_%s`, (id, field) => {
    // Arrange
    const changed = structuredClone(schema);
    const property = changed.types.find((t: any) => t.id === id).properties.find((p: any) => p.name === field);
    property.optional = !property.optional;

    // Act & Assert
    expect(() => validateMappings(changed, overrides)).toThrow(/Stale C# type pin/);
  });
});
