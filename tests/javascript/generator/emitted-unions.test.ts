import { describe, expect, it } from 'vitest';
import { validateEmittedUnions } from '../../../tools/BindingGenerator/src/coverage.ts';
import { matches } from '../../../tools/BindingGenerator/src/emit-serializers.ts';
import type { Shape } from '../../../tools/BindingGenerator/src/generation-model.ts';
import { baselineGeneration } from './baseline.ts';

const align: Shape = {
  id: 'type:align',
  kind: 'union',
  name: 'Align',
  cs: 'Align',
  file: 'Values/Align.g.cs',
  alternatives: [
    { id: 'type:left', kind: 'string', cs: 'string', literal: 'left' },
    { id: 'type:right', kind: 'string', cs: 'string', literal: 'right' },
    { id: 'type:number', kind: 'number', cs: 'double' },
  ],
};

const emitted = (text: string) => new Map([['Values/Align.g.cs', text]]);

describe('emitted union alternatives', () => {
  it('EmittedUnions_EveryAlternativeHasItsOverloadAndLiteral_Pass', () => {
    // Act & Assert
    expect(validateEmittedUnions(
      [align],
      emitted('public static Align From(string value) { if (!(value == "left" || value == "right")) throw; }\npublic static Align From(double value)')
    )).toEqual([]);
  });

  it('EmittedUnions_MissingOverload_IsReported', () => {
    // Act & Assert
    expect(validateEmittedUnions([align], emitted('public static Align From(string value) { if (!(value == "left" || value == "right")) throw; }')))
      .toEqual(['UNION_ALTERNATIVE_NOT_EMITTED Align: no From(double)']);
  });

  it('EmittedUnions_MissingLiteral_IsReported', () => {
    // Act & Assert
    expect(validateEmittedUnions(
      [align],
      emitted('public static Align From(string value) { if (!(value == "left")) throw; }\npublic static Align From(double value)')
    )).toEqual(['UNION_ALTERNATIVE_NOT_EMITTED Align: no literal "right"']);
  });

  it('EmittedUnions_LiteralIsMatchedExactly_NotAsAPrefix', () => {
    // `value == 10` does not validate the literal 1.

    // Arrange
    const level: Shape = {
      id: 'type:level',
      kind: 'union',
      name: 'Level',
      cs: 'Level',
      file: 'Values/Level.g.cs',
      alternatives: [
        { id: 'type:1', kind: 'number', cs: 'double', literal: 1 },
        { id: 'type:10', kind: 'number', cs: 'double', literal: 10 },
      ],
    };
    const text = (condition: string) => new Map([['Values/Level.g.cs', `public static Level From(double value) { if (!(${condition})) throw; }`]]);

    // Act & Assert
    expect(validateEmittedUnions([level], text('value == 10 || value == 1.5'))).toEqual(['UNION_ALTERNATIVE_NOT_EMITTED Level: no literal 1']);
    expect(validateEmittedUnions([level], text('value == 10 || value == 1'))).toEqual([]);
  });

  it('EmittedUnions_MissingFile_IsReported', () => {
    // Act & Assert
    expect(validateEmittedUnions([align], new Map())).toEqual(['UNION_ALTERNATIVE_NOT_EMITTED Align: Values/Align.g.cs was not emitted']);
  });

  it('EmittedUnions_ProductionGeneration_EmitsEveryAlternative', async () => {
    // Act
    const result = baselineGeneration();

    // Assert
    expect(result.emissionErrors).toEqual([]);
    expect(result.unions!.length).toBeGreaterThan(100);
  });

  it('EmittedMatchers_ConstantAlternatives_AreFolded', () => {
    // Arrange
    const many: Shape = { id: 'type:many-any', kind: 'many', cs: 'object', element: { id: 'type:any', kind: 'dynamic', cs: 'EChartsValue' } };
    const never: Shape = { id: 'type:never-array', kind: 'array', cs: 'object', element: { id: 'type:never', kind: 'never', cs: 'NeverValue' } };

    // Act & Assert
    expect(matches(many, 'json')).toBe('true');
    expect(matches(never, 'json')).not.toContain('(false)');

    // Act
    const files = baselineGeneration().files;
    const constants = [...files]
      .filter(([path]) => path.endsWith('.cs'))
      .flatMap(([path, text]) => [...text.matchAll(/(?:\|\||&&) \((?:true|false)\)|\((?:true|false)\) (?:\|\||&&)/g)].map(m => `${path}: ${m[0]}`));

    // Assert
    expect(constants).toEqual([]);
    expect(files.get('src/BlazorECharts/Values/Generated/GridTooltip.g.cs')).toContain('internal static bool Matches(JsonElement json) => true;');
  });
});
