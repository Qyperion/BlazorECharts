import { expect, it } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateScopedCoverage, validateManualMappings } from '../../../tools/BindingGenerator/src/coverage.ts';
import { validateMappings } from '../../../tools/BindingGenerator/src/validate-mappings.ts';
import { serializeScopeCategories } from '../../../tools/BindingGenerator/src/scope-categories.ts';
import { signatureHash } from '../../../tools/BindingGenerator/src/validate-overrides.ts';
import { deriveFixture, scopeFixture, type ScopeFixture } from './scope-fixture.ts';
import { loadSchema, schemaPath, schemaShards } from '../../../tools/BindingGenerator/src/schema.ts';
import { shardJson, writeShardedJson } from '../../../tools/BindingGenerator/src/sharded-json.ts';
import { baselineGeneration } from './baseline.ts';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Gate the fixture the way api:check does: committed categories come from the unmutated fixture. */
function gate(f: ScopeFixture, committed = serializeScopeCategories(deriveFixture(scopeFixture()))) {
  f.manifest.sourceHash = hash(f.schema);
  const expected = structuredClone(f.manifest);
  const scope = deriveFixture(f);
  return validateScopedCoverage({
    schema: f.schema,
    manifest: f.manifest,
    expected,
    scope,
    manual: f.manual,
    committedCategories: committed,
    expectedCategories: serializeScopeCategories(scope),
  });
}

it('ScopedCoverage_AcceptsCompleteFixture', () => {
  // Act
  const report = gate(scopeFixture());

  // Assert
  expect(report.errors).toEqual([]);
  expect(report.summary.sets.S1).toEqual({ total: 2, generated: 2, manualMapped: 0, unresolved: 0 });
  expect(report.summary.residual).toBe(0);
});

it('AddedDocumentedPathFails', () => {
  // Arrange
  const f = scopeFixture();
  const title = f.schema.records.find(r => r.id === 'public:option.title')!;

  // Act
  f.schema.records.push({
    ...structuredClone(title),
    id: 'public:option.newPath',
    canonicalId: 'public:option.newPath',
    publicPath: 'option.newPath',
    name: 'newPath',
  });

  // Assert
  expect(gate(f).errors).toContain('UNRESOLVED_SCOPE_RECORD S1 public:option.newPath');
});

it('AddedTsMemberCausesCategoryDrift', () => {
  // Arrange
  const f = scopeFixture();
  const undoc = f.schema.types.find(t => t.id === 't:undoc')!;
  undoc.properties!.push({ ...undoc.properties![0], name: 'added' });

  // Act
  f.schema.records.push({
    ...f.schema.records.find(r => r.id === 'property:t:undoc/extra')!,
    id: 'property:t:undoc/added',
    canonicalId: 'property:t:undoc/added',
    name: 'added',
  });

  // Assert
  expect(gate(f).errors).toContain('SCOPE_CATEGORY_DRIFT added K8 property:t:undoc/added');
});

it('CategoryCannotHideDocumentedRecord', () => {
  // Arrange
  const f = scopeFixture();
  const title = f.schema.records.find(r => r.id === 'public:option.title')!;
  title.provenance.push('source:lib');

  // Act
  f.manifest.entries = f.manifest.entries.filter(e => e.sourceId !== title.id);

  // Assert
  expect(gate(f).errors).toContain('UNRESOLVED_SCOPE_RECORD S1 public:option.title');
});

it('LooseDocumentedValueFails', () => {
  // Arrange
  const f = scopeFixture();

  // Act
  f.looseSymbols.add('ChartOptions.Title');

  // Assert
  expect(gate(f).errors).toContain('LOOSE_DOCUMENTED_VALUE public:option.title');
});

it('ResidualRecordFails', () => {
  // Arrange
  const f = scopeFixture();
  const owner = f.schema.types.find(t => t.id === 't:orphan')!;
  f.schema.records.push({
    id: 'property:t:orphan/lost',
    kind: 'property',
    name: 'lost',
    publicPath: 'Orphan.lost',
    canonicalId: 'property:t:orphan/lost',
    type: 'number',
    provenance: owner.properties![0].provenance,
    family: 'fixture',
    status: 'unresolved',
    implementationReferences: [],
    testReferences: [],
  });

  // Act
  const report = gate(f);

  // Assert
  expect(report.errors).toContain('RESIDUAL_RECORD property:t:orphan/lost');
  expect(report.summary.residual).toBe(1);
});

it('K9WithoutRuntimeSpanFails', () => {
  // Arrange
  const f = scopeFixture();
  f.overrides.scope!.k9![0].runtime.file = 'lib/missing.js';

  // Act
  const errors = gate(f).errors;

  // Assert
  expect(errors).toContain('K9_RUNTIME_SPAN_INVALID graphic-arc-r0');
  expect(errors).toContain('UNRESOLVED_SCOPE_RECORD S1 public:option.graphic.elements.arc.shape.r0');
});

it('ManualMappingsArePinned', () => {
  // Arrange
  const f = scopeFixture();
  const record = f.schema.records.find(r => r.id === 'public:echartsInstance.resize')!;

  // Act
  const mapping = {
    sourceId: record.id,
    expectedSignature: 'stale',
    symbols: ['EChartInstance.ResizeAsync'],
    implementation: ['Fixture.cs'],
    tests: ['fixture.test.ts'],
  };

  // Assert
  expect(validateManualMappings(f.schema, [mapping]).errors).toEqual([`STALE_MANUAL_MAPPING ${record.id}`]);

  // Act
  mapping.expectedSignature = signatureHash(f.schema, record);

  // Assert
  expect(validateManualMappings(f.schema, [mapping])).toEqual({ ids: [record.id], errors: [] });
  expect(validateManualMappings(f.schema, [mapping, mapping]).errors).toEqual([`DUPLICATE_MANUAL_MAPPING ${record.id}`]);
  expect(validateManualMappings(f.schema, [{ ...mapping, tests: [] }]).errors).toEqual([`MISSING_MANUAL_EVIDENCE ${record.id}`]);

  // Act
  f.manual = [];

  // Assert
  expect(gate(f).errors).toContain('UNRESOLVED_SCOPE_RECORD S3 public:echartsInstance.resize');
});

for (const mutation of read('tests/javascript/generator/fixtures/coverage-mutations.json')) {
  it(mutation.name, () => {
    // Arrange
    const f = scopeFixture();
    const { schema, manifest } = f;
    const title = () => manifest.entries.find(e => e.sourceId === 'public:option.title')!;
    switch (mutation.mutation) {
      case 'remove-alternative':
        title().alternatives.pop();
        break;
      case 'invalid-status':
        Object.assign(title(), { status: 'out-of-scope' });
        break;
      case 'remove-mapping':
        manifest.entries = manifest.entries.filter(e => e.sourceId !== 'public:option.title');
        break;
      case 'duplicate-mapping':
        manifest.entries.push(structuredClone(title()));
        break;
      case 'dangling-source':
        schema.records[0].provenance = ['source:missing'];
        break;
      case 'remove-overload':
        manifest.signatures = [{ typeId: 't:formatter', symbol: 'FormatterSignature', signatures: [] }];
        break;
      case 'wrong-symbol-file':
        manifest.files[0].symbols = manifest.files[0].symbols.filter(s => s !== 'Fixture.Write' && s !== 'Fixture.Read');
        manifest.files.push({ path: 'Unrelated.cs', sha256: 'c'.repeat(64), symbols: ['Fixture.Write', 'Fixture.Read'] });
        break;
      case 'duplicate-source':
        schema.records.push(structuredClone(schema.records[0]));
        break;
      case 'dangling-type':
        schema.types.find(t => t.id === 't:option')!.properties![0].type = 'missing-type';
        break;
      case 'missing-record-type':
        schema.records[0].type = 'missing-type';
        break;
      default:
        throw new Error(`Unknown mutation: ${mutation.mutation}`);
    }

    const expected = structuredClone(scopeFixture().manifest);
    if (mutation.mutation === 'remove-overload')
      expected.signatures = [
        {
          typeId: 't:formatter',
          symbol: 'FormatterSignature',
          signatures: [{ parameters: [], returnType: 'string', typeParameters: [], provenance: [] }],
        },
      ];

    if (mutation.mutation === 'wrong-symbol-file')
      expected.files = structuredClone(manifest.files.slice(0, 1)).map(
        file => ({ ...file, symbols: [...file.symbols, 'Fixture.Write', 'Fixture.Read'] })
      );

    manifest.sourceHash = expected.sourceHash = hash(schema);
    let scope;
    try {
      scope = deriveFixture(f);
    } catch {
      scope = deriveFixture(scopeFixture());
    }

    // Act
    const report = validateScopedCoverage({
      schema,
      manifest,
      expected,
      scope,
      manual: f.manual,
      committedCategories: serializeScopeCategories(deriveFixture(scopeFixture())),
      expectedCategories: serializeScopeCategories(scope),
    });

    // Assert
    expect(report.errors.join('\n')).toContain(mutation.diagnostic);
  });
}

it('InvalidSchemaCli_RefreshesMachineReportsBeforeGeneration', () => {
  // Arrange
  const { schema } = scopeFixture();
  schema.records[0].type = 'missing-type';
  const parent = resolve('artifacts/generator');
  const root = mkdtempSync(resolve(parent, 'strict-invalid-'));
  try {
    // Written without writeSchema, which would reject the invalid schema before the CLI sees it.
    writeShardedJson(resolve(root, schemaPath), shardJson(schema, schemaShards));

    // Act
    const run = spawnSync(process.execPath, [resolve('tools/BindingGenerator/src/cli.ts'), 'check'], { cwd: root, encoding: 'utf8' });

    // Assert
    expect(run.status).toBe(1);
    expect(existsSync(resolve(root, 'artifacts/api-coverage/strict-report.json')), run.stderr).toBe(true);

    // Act
    const report = readFileSync(resolve(root, 'artifacts/api-coverage/strict-report.json'), 'utf8');

    // Assert
    expect(JSON.parse(report).errors.join('\n')).toContain('INVALID_SOURCE_SCHEMA');
    expect(JSON.parse(readFileSync(resolve(root, 'artifacts/api-coverage/public-contract-diff.json'), 'utf8')).comparisonPerformed).toBe(false);
  } finally {
    if (!root.startsWith(parent + sep))
      throw new Error('Invalid strict fixture scratch path');

    rmSync(root, { recursive: true, force: true });
  }
});

it('StaleOverrideFails', () => {
  // Arrange
  const schema = loadSchema();
  const overrides = read('schemas/overrides/echarts-6.1.0.json');
  overrides.mappings[0].expectedSignature = '0'.repeat(64);

  // Act & Assert
  expect(() => validateMappings(schema, overrides)).toThrow(/Stale override/);
});

it(
  'GraphicOptions_RootAndElementsUseCompiledModelMappings',
  () => {
    const schema = loadSchema();
    const result = baselineGeneration();
    for (const id of [
      'public:option.graphic', 'public:option.graphic.elements', 'public:option.graphic.elements.text.style.textAlign',
      'public:option.graphic.elements.text.style.textVerticalAlign',
    ]) {
      const mapping = result.manifest.entries.find(e => e.sourceId === id);
      expect(mapping?.status, id).toBe('generated');
      expect(mapping?.targets?.length, id).toBeGreaterThan(0);
    }

    expect(result.scope?.assignments.get('public:option.graphic.elements.compoundPath')?.set).toBe('K9');
  },
  180_000
);
