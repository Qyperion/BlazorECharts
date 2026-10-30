import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emitGlobalMethods } from '../../../tools/BindingGenerator/src/global-methods.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';

it('Globals_RequireSignaturePinnedOwnersAndRejectMissingMappings', () => {
  // Arrange
  const schema = loadSchema();
  const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));

  // Act
  const result = emitGlobalMethods(schema, overrides.globalMethods);

  // Assert
  expect(result.records.find(r => r.name === 'connect')).toMatchObject({ owner: 'managed' });
  expect(result.records.find(r => r.name === 'registerPreprocessor')).toMatchObject({ owner: 'native' });
  expect(result.records.find(r => r.name === 'registerCustomSeries')).toMatchObject({ owner: 'managed', symbol: 'RegisterCustomSeriesAsync' });

  // Act & Assert
  expect(() => emitGlobalMethods(schema, overrides.globalMethods.slice(1))).toThrow(/owner/);

  // Arrange
  const stale = structuredClone(overrides.globalMethods);
  stale[0].expectedSignature = 'stale';

  // Act & Assert
  expect(() => emitGlobalMethods(schema, stale)).toThrow(/Stale/);

  // Arrange
  const missingEvidence = structuredClone(overrides.globalMethods);
  missingEvidence.find((m: any) => m.owner === 'native').implementation = [];

  // Act & Assert
  expect(() => emitGlobalMethods(schema, missingEvidence)).toThrow(/evidence/);
});

it('Globals_RegisterLocaleReusesTheLocaleOptionModel', () => {
  // Arrange
  const schema = loadSchema();
  const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));

  // Act
  const twins = overrides.csharp.globalTypeTwins;

  // Assert
  expect(twins).toHaveLength(1);

  // Act
  const models = (id: string) => id === twins[0].canonicalTypeId ? 'ChartLocaleOption' : undefined;
  const code = emitGlobalMethods(schema, overrides.globalMethods, { twins, models }).files.get(
    'src/BlazorECharts/Runtime/Generated/GlobalHelpers.g.cs'
  )!;

  // Assert
  expect(code).toContain('public async ValueTask RegisterLocaleAsync(string @name, ChartLocaleOption @locale,');

  // Arrange
  const unknown = structuredClone(overrides.globalMethods);
  unknown.find((m: any) => m.recordId === 'public:echarts.registerLocale').parameters = { lang: 'name' };

  // Act & Assert
  expect(() => emitGlobalMethods(schema, unknown, { twins, models })).toThrow(/Unknown global parameter lang/);
  expect(code).not.toMatch(/GlobalData\w+ @localeObj/);
  for (const locale of ['fc0622b047', 'd882a37120', '1160504b6d'])
    expect(code).not.toContain('GlobalData' + locale);

  expect(() => emitGlobalMethods(schema, overrides.globalMethods, { twins, models: () => undefined })).toThrow(/model/);

  // Arrange
  const unused = [...twins, { ...twins[0], typeId: twins[0].canonicalTypeId }];

  // Act & Assert
  expect(() => emitGlobalMethods(schema, overrides.globalMethods, { twins: unused, models })).toThrow(/twin/);

  // Arrange
  const unrelated = [{ ...twins[0], canonicalTypeId: 'type:5c14306e0c6caa0f0fafd6b2' }];

  // Act & Assert
  expect(() => emitGlobalMethods(schema, overrides.globalMethods, { twins: unrelated, models: () => 'TooltipOption' })).toThrow(/twin/);
});

it('Globals_UndocumentedHelpersAreNotPublicApi', async () => {
  // Arrange
  const { emitNativeGraphics } = await import('../../../tools/BindingGenerator/src/native-graphics.ts');
  const schema = loadSchema();
  const overrides = JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8'));
  const twins = overrides.csharp.globalTypeTwins;
  const models = (id: string) => id === twins[0].canonicalTypeId ? 'ChartLocaleOption' : undefined;
  const helpers = emitGlobalMethods(schema, overrides.globalMethods, { twins, models });

  // Act
  const code = helpers.files.get('src/BlazorECharts/Runtime/Generated/GlobalHelpers.g.cs')!;

  // Assert
  expect([...code.matchAll(/public (?:async )?ValueTask(?:<[^>]+>)? (\w+)\(/g)].map(m => m[1]).sort()).toEqual([
    'RegisterLocaleAsync', 'RegisterThemeAsync',
  ]);
  expect(code).not.toMatch(/Global(Data|Union)/);
  expect(helpers.publicApi).not.toMatch(/Color|Format|ZrUtil|Global(Data|Union)/);

  // Act
  // Every native path stays callable through InvokeNativeAsync; only documented ones get named helpers.
  const native = emitNativeGraphics(schema);
  const named = [
    ...native.files
      .get('src/BlazorECharts/Runtime/Generated/NativeGraphics.g.cs')!
      .matchAll(/public ValueTask<EChartsBrowserResult> (\w+)NativeAsync/g),
  ].map(m => m[1]);

  // Assert
  expect(named).toEqual(
    expect.arrayContaining(['GraphicExtendShape', 'GraphicRegisterShape', 'GraphicClipPointsByRect', 'SetPlatformAPI', 'Connect', 'RegisterMap'])
  );
  for (const hidden of [
    'ColorLift', 'RegisterTransform', 'RegisterAction', 'GraphicRect', 'GraphicLinearGradient', 'ZrUtilMerge', 'ExtendSeriesModel',
  ])
    expect(named).not.toContain(hidden);

  // Act
  const allowed = native.files.get('src/BlazorECharts/JavaScript/native-graphics.generated.ts')!;

  // Assert
  for (const path of ['color.lift', 'registerTransform', 'graphic.Rect'])
    expect(allowed).toContain(JSON.stringify(path));
});
