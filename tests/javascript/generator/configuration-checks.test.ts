import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { csharpConfigurationErrors, dynamicActionErrors, runtimeTriggerErrors } from '../../../tools/BindingGenerator/src/validate-mappings.ts';
import { scanTriggers } from '../../../tools/BindingGenerator/src/runtime-inventory.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = () => JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));

it('CSharpNames_RequireAReason', () => {
  // Act
  const config = overrides().csharp;

  // Assert
  expect(csharpConfigurationErrors(schema, config)).toEqual([]);

  // Act
  config.names[0].reason = ' ';

  // Assert
  expect(csharpConfigurationErrors(schema, config)).toEqual([`Missing reason of C# name: ${config.names[0].name}`]);
});

it('VariantDefaults_NameAVariantModelAnAllowedCaseAndAReason', () => {
  // A wrong `when` used to emit undefined into C#, a model without a variant literal was ignored silently.

  // Arrange
  const config = overrides().csharp;
  const valid = config.variantDefaults[0];
  const plain = schema.types.find(t => t.kind === 'object' && t.properties?.length && !t.properties.some(p => p.name === 'type'))!;

  // Act
  config.variantDefaults.push(
    { ...valid, when: 'sometimes' },
    { typeId: config.variantDefaults[1].typeId, when: 'always', reason: ' ' },
    { typeId: plain.id, when: 'always', reason: 'fixture' },
    { typeId: 'type:000000000000000000000000', when: 'always', reason: 'fixture' }
  );

  // Assert
  expect(csharpConfigurationErrors(schema, config)).toEqual([
    `Duplicate variant default: ${valid.typeId}`,
    `Invalid variant default case: ${valid.typeId} sometimes`,
    `Duplicate variant default: ${config.variantDefaults[1].typeId}`,
    `Missing reason of variant default: ${config.variantDefaults[1].typeId}`,
    `Stale variant default: ${plain.id}`,
    'Stale variant default: type:000000000000000000000000',
  ]);
});

it('DynamicActionRegistrations_NeedADecision', () => {
  // Act
  const config = overrides();

  // Assert
  expect(dynamicActionErrors(schema, config)).toEqual([]);

  // Act
  const roam = config.dynamicActions.find((d: { site: string }) => d.site.includes('roamHelper'));
  roam.typed.push('sankeyRoam');

  // Assert
  expect(dynamicActionErrors(schema, config)).toEqual([`Dynamic action sankeyRoam (${roam.site}) is not typed`]);

  // Act
  config.dynamicActions = config.dynamicActions.filter((d: { site: string }) => d !== roam);

  // Assert
  expect(dynamicActionErrors(schema, config)).toEqual([
    expect.stringMatching(/^DYNAMIC_ACTION_REGISTRATION without a decision: lib\/component\/helper\/roamHelper\.js:124/),
  ]);
});

it('RuntimeTriggers_FindLiteralChartEvents_NotLifecycleHooks', () => {
  // Arrange
  const text = `lifecycle.trigger('afterupdate', ecModel);\nthis.trigger('updated');\necIns.trigger('rendered', params);\nmessageCenter.trigger(eventObj.type, eventObj);\n`;

  // Act & Assert
  expect(scanTriggers(text, 'lib/core/echarts.js')).toEqual([
    { event: 'updated', site: 'lib/core/echarts.js:2' },
    { event: 'rendered', site: 'lib/core/echarts.js:3' },
  ]);
});

it('RuntimeTriggers_NeedADecision', () => {
  // An instance event that ECharts triggers by name is typed (an eventActions runtime name) or excluded with a reason.

  // Act
  const config = overrides();

  // Assert
  expect(runtimeTriggerErrors(schema, config)).toEqual([]);

  // Act
  config.runtimeTriggers = [];

  // Assert
  expect(runtimeTriggerErrors(schema, config)).toEqual(['RUNTIME_TRIGGER without a decision: lib/core/echarts.js:1601 updated']);

  // Act
  config.runtimeTriggers = [{ event: 'updated', reason: ' ' }, { event: 'rendered', reason: 'fixture' }, { event: 'gone', reason: 'fixture' }];

  // Assert
  expect(runtimeTriggerErrors(schema, config)).toEqual([
    'Runtime trigger decision updated needs a reason', 'Runtime trigger rendered is typed and excluded', 'Stale runtime trigger decision gone',
  ]);
  expect(runtimeTriggerErrors(schema, overrides(), () => 'changed')).toEqual(['RUNTIME_TRIGGER_SOURCE_INVALID lib/core/echarts.js']);
});

it(
  'Generation_WarnsAboutConfigurationThatTakesNoEffect',
  () => {
    const unused = overrides();
    const typeId = schema.types.find(
      t => t.kind === 'object' && !unused.csharp.names.some((n: { typeId: string }) => n.typeId === t.id) && t.properties?.length
    )!;
    unused.csharp.names.push({ typeId: typeId.id, name: 'NeverEmittedOption', reason: 'fixture' });
    unused.csharp.defaults.push({ typeId: typeId.id, property: typeId.properties![0].name, value: 1 });
    unused.scope.k9[0] = { ...unused.scope.k9[0], paths: [...unused.scope.k9[0].paths, 'option.noSuchComponent'] };

    // A variant model that no root reaches.
    const variant = {
      id: 'type:fixture-unreached-variant',
      kind: 'object',
      display: '{ type?: "fixture"; }',
      provenance: typeId.provenance,
      properties: [{ name: 'type', type: 'type:fixture-unreached-variant-type', optional: true, readonly: false, provenance: typeId.provenance }],
    };
    schema.types.push(variant, {
      id: 'type:fixture-unreached-variant-type',
      kind: 'literal',
      display: '"fixture"',
      value: 'fixture',
      provenance: typeId.provenance,
    });
    unused.csharp.variantDefaults.push({ typeId: variant.id, when: 'always', reason: 'fixture' });
    try {
      const result = generate(schema, unused);
      expect(result.warnings).toEqual(expect.arrayContaining([
        `UNUSED_CSHARP_NAME NeverEmittedOption ${typeId.id}`,
        `UNUSED_CSHARP_DEFAULT ${typeId.id}/${typeId.properties![0].name}`,
        `UNUSED_K9_PATH ${unused.scope.k9[0].id} option.noSuchComponent`,
        `UNUSED_CSHARP_VARIANT_DEFAULT ${variant.id}`,
      ]));
    } finally {
      schema.types.splice(schema.types.length - 2, 2);
    }

    expect(baselineGeneration().warnings).toEqual([]);
  },
  300_000
);
