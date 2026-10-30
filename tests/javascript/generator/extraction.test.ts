import { expect, test } from 'vitest';
import { join, resolve } from 'node:path';
import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { extractDeclarations, extractContract } from '../../../tools/BindingGenerator/src/extract.ts';
import { serializeSchema, validateSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { discoverPublicRoots } from '../../../tools/BindingGenerator/src/public-roots.ts';

const fixture = resolve('tests/javascript/generator/fixtures/public-contracts.d.ts');

test('Extract_PublicAliasesAndOverloads_KeepProvenance', () => {
  // Arrange
  const schema = extractDeclarations([fixture]);

  // Act
  const exported = (name: string) => schema.records.find(r => r.kind === 'export' && r.name === name)!;

  // Assert
  expect(exported('OptionsAlias').canonicalId).toBe(exported('Options').canonicalId);
  expect(exported('convertAlias').canonicalId).toBe(exported('convert').canonicalId);

  // Act
  const type = schema.types.find(t => t.id === exported('convert').type)!;

  // Assert
  expect(type.signatures).toHaveLength(2);
  expect(type.signatures![1].parameters[1].optional).toBe(true);
  expect(schema.provenance.find(p => p.id === exported('Options').provenance[0])).toMatchObject({
    package: 'fixture',
    version: 'test',
    start: { line: 7, column: 1 },
  });

  // Act
  const factory = schema.types.find(t => t.id === exported('Factory').type)!;

  // Assert
  expect(factory.constructSignatures).toHaveLength(1);
  expect(schema.records.some(r => r.publicPath.endsWith('.secret'))).toBe(false);
  expect(schema.records.some(r => r.publicPath.endsWith('helpers.scale'))).toBe(true);
});

test('Extract_UnknownConstruct_IsDiagnosticNotObject', () => {
  // Act
  const schema = extractDeclarations([fixture]);

  // Assert
  expect(schema.diagnostics.some(d => d.code === 'UNSUPPORTED_TYPE' && d.message.includes('TemplateLiteral'))).toBe(true);
  expect(schema.types.some(t => t.kind === 'unsupported')).toBe(true);
  for (const kind of ['any', 'unknown']) {
    expect(schema.types.some(t => t.kind === kind)).toBe(true);
    expect(schema.diagnostics.some(d => d.code === `UPSTREAM_${kind.toUpperCase()}`)).toBe(true);
  }

  expect(schema.records.every(r => r.status === 'unresolved')).toBe(true);
});

test('Extract_Twice_IsByteIdentical', () => {
  // Arrange
  const first = extractDeclarations([fixture]);

  // Act
  const second = extractDeclarations([fixture]);

  // Assert
  expect(serializeSchema(first)).toBe(serializeSchema(second));

  // Act & Assert
  expect(() => validateSchema(first)).not.toThrow();
  expect(() => validateSchema({ ...first, types: first.types.slice(1) })).toThrow();
  expect(() => validateSchema({ ...first, types: first.types.map(t => t.kind === 'union' ? { ...t, alternatives: undefined } : t) })).toThrow();
  expect(() => validateSchema({ ...first, provenance: [] })).toThrow();
});

// Real pinned artifacts: loses a public root, registry member or dependency => fails.
test('Extract_PinnedPackage_InventoryAndIntegrity', async () => {
  // Arrange
  const schema = await extractContract(resolve('schemas/upstream/sources.lock.json'));

  // Act
  validateSchema(schema);

  // Assert
  expect(schema.compilerVersion).toBe('6.0.3');
  expect(schema.roots.some(r => r.exportPath === '.' && r.declaration === 'types/dist/all.d.ts')).toBe(true);
  expect(schema.roots.some(r => r.exportPath === '.' && r.declaration === 'types/dist/echarts.d.cts')).toBe(true);
  expect(schema.series.map(s => s.name).sort()).toEqual([
    'bar', 'boxplot', 'candlestick', 'chord', 'custom', 'effectScatter', 'funnel', 'gauge', 'graph', 'heatmap', 'line', 'lines', 'map', 'parallel',
    'pictorialBar', 'pie', 'radar', 'sankey', 'scatter', 'sunburst', 'themeRiver', 'tree', 'treemap',
  ]);
  expect(schema.records.some(r => r.name === 'MatrixComponentOption')).toBe(true);
  // The WordCloud declarations augment the ECharts module types; they have their own inventory and stay out of the core contract.
  expect(schema.roots.every(r => r.package === 'echarts')).toBe(true);
  expect(schema.records.some(r => r.name.startsWith('WordCloud') || r.publicPath.includes('echarts-wordcloud'))).toBe(false);
  expect(schema.sources.find(s => s.name === '@qyperion/echarts-wordcloud')).toMatchObject({ version: '3.0.0' });
  expect(schema.sources.find(s => s.name === 'echarts')!.files.length).toBeGreaterThan(10);
  expect(schema.diagnostics.filter(d => d.code === 'TS2307')).toEqual([]);
});

test('Extract_ExportsConditionsPatternsAndGaps_AreInventoried', () => {
  // Arrange
  const dir = mkdtempSync(resolve('artifacts/generator/roots-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'fixture',
      exports: {
        '.': { types: { import: './index.d.ts', require: './index.d.cts' }, import: './index.js', require: './runtime.cjs' },
        './helper': './helper.js',
        './missing': './missing.js',
        './*': './*',
      },
    }));
    for (const file of ['index.d.ts', 'index.d.cts', 'helper.d.ts'])
      writeFileSync(join(dir, file), 'export interface A { value: string }');

    // Act
    const roots = discoverPublicRoots(dir);

    // Assert
    expect(roots.find(r => r.conditions.join('.') === 'types.import')?.declaration).toBe('index.d.ts');
    expect(roots.find(r => r.conditions.join('.') === 'types.require')?.declaration).toBe('index.d.cts');
    expect(roots.filter(r => r.exportPath === '.' && r.status === 'declaration-gap')).toEqual([]);
    expect(roots.find(r => r.exportPath === './helper')?.declaration).toBe('helper.d.ts');
    expect(roots.find(r => r.exportPath === './missing')?.status).toBe('declaration-gap');
    expect(roots.some(r => r.conditions.includes('pattern:./*') && r.declaration === 'helper.d.ts')).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Extract_StableIds_IgnoreUnrelatedSourceLineShifts', () => {
  // Arrange
  const dir = mkdtempSync(resolve('artifacts/generator/stable-'));
  try {
    const entry = join(dir, 'contracts.d.ts');
    const declarations = readFileSync(fixture, 'utf8');
    writeFileSync(entry, declarations);
    const first = extractDeclarations([entry]);
    writeFileSync(entry, '// unrelated comment\n\n' + declarations);

    // Act
    const second = extractDeclarations([entry]);

    // Assert
    expect(second.records.map(r => r.id)).toEqual(first.records.map(r => r.id));
    expect(second.types.map(t => t.id)).toEqual(first.types.map(t => t.id));
    expect(second.provenance[0].sha256).not.toBe(first.provenance[0].sha256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Extract_CorruptArchive_RejectsBeforeSchema', async () => {
  // Arrange
  const dir = mkdtempSync(resolve('artifacts/generator/archive-'));
  try {
    const lock = readFileSync('schemas/upstream/sources.lock.json');
    mkdirSync(join(dir, 'schemas/upstream'), { recursive: true });
    mkdirSync(join(dir, 'artifacts/upstream'), { recursive: true });
    writeFileSync(join(dir, 'schemas/upstream/sources.lock.json'), lock);
    const original = readFileSync('artifacts/upstream/echarts-6.1.0.tgz');
    writeFileSync(join(dir, 'artifacts/upstream/echarts-6.1.0.tgz'), Buffer.concat([original, Buffer.from('tampered')]));

    // Act & Assert
    await expect(extractContract(join(dir, 'schemas/upstream/sources.lock.json'))).rejects.toThrow('archive integrity mismatch');
    expect(readFileSync(join(dir, 'schemas/upstream/sources.lock.json'))).toEqual(lock);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Extract_CorruptUnpackedDeclaration_RejectsEvenWithValidArchive', async () => {
  // Arrange
  const dir = mkdtempSync(resolve('artifacts/generator/cache-'));
  try {
    const lock = JSON.parse(readFileSync('schemas/upstream/sources.lock.json', 'utf8'));
    mkdirSync(join(dir, 'schemas/upstream'), { recursive: true });
    mkdirSync(join(dir, 'artifacts/upstream'), { recursive: true });
    writeFileSync(join(dir, 'schemas/upstream/sources.lock.json'), JSON.stringify(lock));

    // Copy only declaration inputs; runtime files are irrelevant to this read-only tool.
    for (const pkg of lock.packages) {
      const directory = pkg.directory ?? pkg.name;
      cpSync(`artifacts/upstream/${directory}-${pkg.version}.tgz`, join(dir, 'artifacts/upstream', `${directory}-${pkg.version}.tgz`));
      cpSync(`artifacts/upstream/${directory}`, join(dir, 'artifacts/upstream', directory), {
        recursive: true,
        filter: path => !/\.[^/\\]+$/.test(path) || /\.d\.[cm]?ts$|package\.json$/.test(path),
      });
    }

    const entry = join(dir, 'artifacts/upstream/echarts/types/dist/all.d.ts');
    writeFileSync(entry, readFileSync(entry, 'utf8') + '\n// altered declaration\n');

    // Act & Assert
    await expect(extractContract(join(dir, 'schemas/upstream/sources.lock.json'))).rejects.toThrow('cached input integrity mismatch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
