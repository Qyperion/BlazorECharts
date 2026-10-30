import { describe, expect, it } from 'vitest';
import { hydrateBindings } from '../../../src/BlazorECharts/JavaScript/bindings.ts';
import { ExtensionRegistry } from '../../../src/BlazorECharts/JavaScript/extension-registry.ts';
import { createNativeValue } from '../../../src/BlazorECharts/JavaScript/native-values.ts';
import { normalizeConfiguration, type ModuleImporter } from '../../../src/BlazorECharts/JavaScript/runtime-provider.ts';

// Every loader resolves module URLs through moduleUrl(): only HTTP(S) without credentials can be imported (R5).
const base = 'https://example.test/app/';

const rejected = [
  'data:text/javascript,export const format = () => 1',
  'blob:https://example.test/2f1c0e1a-0000-4000-8000-000000000000',
  'javascript:alert(1)',
  'https://user:secret@example.test/format.js',
  'file:///C:/modules/format.js',
];

const loaders: [string, (url: string, importer: ModuleImporter) => Promise<unknown>][] = [
  ['runtime provider', async (url, importer) => normalizeConfiguration({ provider: 'module', moduleUrl: url }, base, `${base}echarts.js`)],
  [
    'module binding',
    (url, importer) => hydrateBindings(
      {
        json: { formatter: null },
        bindings: [{ path: ['formatter'], kind: 'module', token: 'binding:0', signature: 'fixture', moduleUrl: url, exportName: 'format' }],
      },
      {},
      {} as any,
      importer,
      base,
      () => {}
    ),
  ],
  [
    'extension',
    (
      url,
      importer
    ) => new ExtensionRegistry(async () => ({}), importer, base).registerAll([{ id: 'x', version: '1', dependencies: [], moduleUrl: url }]),
  ],
  ['native factory', (url, importer) => createNativeValue('module', { moduleUrl: url, exportName: 'create' }, [], importer, base)],
];

describe.each(loaders)('%s', (_, load) => {
  it.each(rejected)('ModuleUrl_RejectsWithoutImport %s', async url => {
    // Arrange
    const imported: string[] = [];
    const importer: ModuleImporter = async target => {
      imported.push(target);
      return { format: () => 1, create: () => ({}), register() {} };
    };

    // Act & Assert
    await expect(load(url, importer)).rejects.toThrow(/HTTP\(S\) without credentials/);
    expect(imported).toEqual([]);
  });

  it('ModuleUrl_ResolvesRelativeHttpUrlAgainstTheBase', async () => {
    // Arrange
    const imported: string[] = [];
    const importer: ModuleImporter = async target => {
      imported.push(target);
      return { format: () => 1, create: () => ({}), register() {} };
    };

    // Act
    const result = await load('./modules/format.js', importer);

    // Assert
    expect(imported.length ? imported : [(result as { moduleUrl: string }).moduleUrl]).toEqual([`${base}modules/format.js`]);
  });
});
