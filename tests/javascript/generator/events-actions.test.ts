import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { baselineGeneration } from './baseline.ts';

const schema = loadSchema();
const overrides = () => JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
const baseline = baselineGeneration;

it('Every_public_event_and_action_has_source_pinned_generated_contract', () => {
  // Arrange
  const result = baseline();

  // Act
  const records = schema.records.filter((r: any) => r.kind === 'event' || r.kind === 'action');

  // Assert
  expect(records).toHaveLength(69);
  for (const r of records) {
    const entry = result.manifest.entries.find(e => e.sourceId === r.id);
    expect(entry?.status, r.id).toBe('generated');
    expect(result.files.get(entry!.file), r.id).toContain(r.name === 'brushEnd' && r.kind === 'event' ? 'brushend' : r.name);
  }
});

it('Changed_event_signature_or_conflicting_shared_action_cannot_silently_generate', () => {
  // Arrange
  const changed = overrides();
  const duplicate = changed.eventActions.filter((m: any) => m.runtimeName === 'takeGlobalCursor');
  duplicate[1].fields.key = 'number';

  // Act & Assert
  expect(() => generate(schema, changed)).toThrow(/Conflicting shared action/);

  // Arrange
  duplicate[1].fields.key = 'string';
  changed.eventActions[0].expectedSignature = 'stale';

  // Act & Assert
  expect(() => generate(schema, changed)).toThrow(/Stale event\/action/);
});

it(
  'EventActionFieldTypes_UseTheSharedTokenList',
  async () => {
    // A token EventActionValue.Matches does not know would reject every value at run time.
    const { eventActionValueTokens } = await import('../../../tools/BindingGenerator/src/emit-events-actions.ts');
    const cs = readFileSync('src/BlazorECharts/Values/EventActionValue.cs', 'utf8');
    const matches = cs.slice(cs.indexOf('private static bool Matches(JsonElement json, string alternative)'));
    expect([...new Set([...matches.slice(0, matches.indexOf('_ => false')).matchAll(/"([A-Za-z]+)"/g)].map(m => m[1])), 'function'].sort()).toEqual(
      [...eventActionValueTokens].sort()
    );
    const changed = overrides();
    const action = changed.eventActions.find((m: any) => Object.values(m.fields).includes('string|string[]'));
    const field = Object.keys(action.fields).find(f => action.fields[f] === 'string|string[]')!;
    action.fields[field] = 'string|strings[]';
    expect(() => generate(schema, changed)).toThrow(`Unknown event/action field type ${action.name}.${field}: string|strings[]`);
    action.fields[field] = 'type:000000000000000000000000';
    expect(() => generate(schema, changed)).toThrow(`Unknown event/action field type ${action.name}.${field}: type:000000000000000000000000`);
  },
  300_000
);

it('Mouse_events_expose_documented_emitted_fields_typed', () => {
  // Arrange
  const result = baseline();

  // Act
  const mouse = ['Click', 'DoubleClick', 'MouseDown', 'MouseMove', 'MouseUp', 'MouseOver', 'MouseOut', 'GlobalOut', 'ContextMenu'];

  // Assert
  for (const name of mouse) {
    const source = result.files.get(`src/BlazorECharts/Events/Generated/${name}Event.g.cs`);
    expect(source, name).toBeDefined();
    for (const member of [
      'public double? Percent => Number("percent");',
      'public ChartTreePathItem[]? TreePathInfo =>',
      'public ChartTreePathItem[]? TreeAncestors =>',
      'public EChartsValue? Info => JsonValue("info");',
      'public string? TargetType => Text("targetType");',
      'public ChartAxisLabelBreak? Break =>',
      'public double[]? Coord =>',
      'public string? SelfType => Text("selfType");',
      'public ZRColor? Color => ReadValue("color", json => ZRColor.Read(json));',
    ])
      expect(source, `${name}: ${member}`).toContain(member);

    expect(source, name).not.toContain('Values.Generated');
    expect(source, name).not.toMatch(/ComponentTypeIndex|\[componentType\]Index/);
  }

  // Act
  const path = result.files.get('src/BlazorECharts/Options/Generated/ChartTreePathItem.g.cs');

  // Assert
  expect(path).toMatch(/public string\? Name/);
  expect(path).toMatch(/public int\? DataIndex/);
  expect(path).toMatch(/public EventActionValue\? Value/);

  // Act
  const breakSource = result.files.get('src/BlazorECharts/Options/Generated/ChartAxisLabelBreak.g.cs');

  // Assert
  expect(breakSource).toMatch(/public double\? Start/);
  expect(breakSource).toMatch(/public double\? End/);
});

it('EventActionCoverage_NamesItsBrowserEvidenceOrSaysContractOnly', () => {
  // Arrange
  const report = baseline().files.get('docs/api-coverage/events-actions-6.1.0.md')!;

  // Act
  const rows = report.split('\n').filter(line => /^\| public:/.test(line));

  // Assert
  expect(rows).toHaveLength(96);
  expect(rows.find(row => row.startsWith('| public:events.timelinechanged |'))).toContain(
    'interaction-events.spec.ts#TimelineActions_EmitTypedChangeAndPlayEvents'
  );
  expect(rows.find(row => row.startsWith('| public:action.toolbox.restore |'))).toContain(
    'interaction-events.spec.ts#RestoreAction_ResetsTheOptionAndEmitsRestore'
  );

  // Every event and action names its browser test; a new contract-only row must change this count on purpose.
  expect(rows.filter(row => row.endsWith('| contract only |'))).toEqual([]);
  expect(report).not.toContain('EventActionContractTests; events.test.ts; events.spec.ts');

  // Arrange
  const deleted = overrides();
  const timeline = deleted.eventActions.find((m: any) => m.runtimeName === 'timelinechanged');
  timeline.evidence = ['tests/browser/interaction-events.spec.ts#DeletedTest'];

  // Act & Assert
  expect(() => generate(schema, deleted)).toThrow(/timelinechanged.*declares no test DeletedTest/);
});

it('LegacyActions_NameTheirReplacementInRemarks', () => {
  // Arrange
  const files = baseline().files;

  // Act
  const action = (name: string) => files.get(`src/BlazorECharts/Options/Generated/${name}.g.cs`)!;

  // Assert
  for (const [name, replacement] of [
    ['FocusNodeAdjacencyAction', 'HighlightAction'],
    ['UnfocusNodeAdjacencyAction', 'DownplayAction'],
    ['SunburstHighlightAction', 'HighlightAction'],
    ['SunburstUnhighlightAction', 'DownplayAction'],
  ]) {
    expect(action(name), name).toMatch(new RegExp(`/// <remarks>[^\n]*${replacement}[^\n]*</remarks>\npublic sealed class ${name}\(\)`));
  }

  expect(action('HighlightAction')).not.toContain('<remarks>');
});
