import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { serializeScopeCategories, compareScopeCategories, type ScopeK9Span } from '../../../tools/BindingGenerator/src/scope-categories.ts';
import { deriveFixture, scopeFixture, type ScopeFixture } from './scope-fixture.ts';

const setOf = (f: ScopeFixture, id: string) => deriveFixture(f).assignments.get(id)?.set;

describe('scope categories', () => {
  it('ClassifiesEveryFixtureRecord', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    const result = deriveFixture(f);

    // Assert
    expect(result.errors).toEqual([]);
    expect(Object.fromEntries([...result.assignments].map(([id, a]) => [id, a.set]))).toEqual({
      'export:echarts/index.d.ts::EChartsOption': 'K7',
      'property:t:option/title': 'K7',
      'property:t:option/formatter': 'K7',
      'property:t:option/misc': 'K8',
      'property:t:optionCjs/title': 'K1',
      'property:t:params/dataIndex': 'K5a',
      'property:t:element/onclick': 'K2',
      'property:t:model/getData': 'K4',
      'property:t:useOptions/lazy': 'K6',
      'export:echarts/index.d.ts::use': 'K6',
      'property:t:undoc/extra': 'K8',
      'property:t:resizeOpts/width': 'K7m',
      'symbol:typescript#Lib': 'K3',
      'public:custom.renderItem.api.value': 'K5r',
      'public:echarts.setPlatformAPI': 'K6b',
      'public:echartsInstance.resize': 'S3',
      'public:option.title': 'S1',
      'public:option.formatter': 'S1',
      'public:option.formatter.params': 'K5d',
      'public:option.graphic.elements.arc.shape.r0': 'K9',
      'public:events.click': 'S2',
      'export:echarts/index.d.ts::InitOpts': 'S5',
      'property:t:initOpts/renderer': 'S5',
    });
  });

  it('K1_RequiresSameIdentityAsCanonicalCopy', () => {
    // Arrange
    const f = scopeFixture();
    f.schema.types.find(t => t.id === 't:optionCjs')!.properties![0].type = 'number';

    // Act
    f.schema.records.find(r => r.id === 'property:t:optionCjs/title')!.type = 'number';

    // Assert
    expect(setOf(f, 'property:t:optionCjs/title')).not.toBe('K1');
  });

  it('K2_RequiresZRenderOrigin', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.origin.declarations = f.origin.declarations.filter(d => d.package !== 'zrender');

    // Assert
    expect(setOf(f, 'property:t:element/onclick')).not.toBe('K2');
  });

  it('K3_RequiresOnlyTypeScriptLibSpans', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.schema.records.find(r => r.id === 'symbol:typescript#Lib')!.provenance.push('source:shared:6');

    // Assert
    expect(setOf(f, 'symbol:typescript#Lib')).not.toBe('K3');
  });

  it('K4_RequiresEChartsRuntimeOrigin', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.origin.declarations = f.origin.declarations.filter(d => d.package !== 'echarts-src');

    // Assert
    expect(setOf(f, 'property:t:model/getData')).not.toBe('K4');
  });

  it('K5a_RequiresCallbackOnlyReachability', () => {
    // Arrange
    const f = scopeFixture();
    const option = f.schema.types.find(t => t.id === 't:option')!;

    // Act
    option.properties!.push({ ...option.properties![0], name: 'params', type: 't:params' });

    // Assert
    expect(setOf(f, 'property:t:params/dataIndex')).not.toBe('K5a');
  });

  it('K5d_RequiresFunctionOnlyDocsAncestor', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.schema.records.find(r => r.id === 'public:option.formatter')!.inventory!.docsTypes = ['Function', 'Object'];

    // Assert
    expect(setOf(f, 'public:option.formatter.params')).toBe('S1');
  });

  it('K5r_RequiresRenderItemApiPath', () => {
    // Arrange
    const f = scopeFixture();
    const r = f.schema.records.find(r => r.id === 'public:custom.renderItem.api.value')!;

    // Act
    r.id = r.canonicalId = 'public:custom.other.value';

    // Assert
    expect(setOf(f, 'public:custom.other.value')).not.toBe('K5r');
  });

  it('K6_RequiresValueOrHelperOnlyReachability', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.schema.records.find(r => r.id === 'export:echarts/index.d.ts::use')!.exportSpace = 'type';

    // Assert
    expect(setOf(f, 'export:echarts/index.d.ts::use')).not.toBe('K6');
    expect(setOf(f, 'property:t:useOptions/lazy')).not.toBe('K6');
  });

  it('K6b_RequiresExplicitNativeOnlyDecision', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.overrides.scope!.nativeOnly = [];

    // Assert
    expect(setOf(f, 'public:echarts.setPlatformAPI')).toBe('S3');

    // Act
    const invalid = scopeFixture();
    invalid.overrides.globalMethods = [];

    // Assert
    expect(deriveFixture(invalid).errors).toContain('INVALID_NATIVE_ONLY public:echarts.setPlatformAPI');
  });

  it('K7_RequiresTwinOfScopeRecord', () => {
    // Arrange
    const f = scopeFixture();
    f.schema.records.find(r => r.id === 'public:option.title')!.inventory!.declarationIds = [];

    // Act
    f.manifest.entries = f.manifest.entries.filter(e => e.sourceId !== 'property:t:option/title');

    // Assert
    expect(setOf(f, 'property:t:option/title')).not.toBe('K7');
  });

  it('K7m_RequiresManualMappedMethod', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.manual = [];

    // Assert
    expect(setOf(f, 'property:t:resizeOpts/width')).not.toBe('K7m');
  });

  it('K8_RequiresOptionClosure', () => {
    // Arrange
    const f = scopeFixture();
    const option = f.schema.types.find(t => t.id === 't:option')!;

    // Act
    option.properties = option.properties!.filter(p => p.name !== 'misc');

    // Assert
    expect(setOf(f, 'property:t:undoc/extra')).toBe('RESIDUAL');
  });

  it('K9RequiresRuntimeSpan', () => {
    // Arrange
    const f = scopeFixture();
    f.overrides.scope!.k9![0].runtime.sha256 = '0'.repeat(64);

    // Act
    const result = deriveFixture(f);

    // Assert
    expect(result.errors).toContain('K9_RUNTIME_SPAN_INVALID graphic-arc-r0');
    expect(result.assignments.get('public:option.graphic.elements.arc.shape.r0')?.set).toBe('S1');

    // Act
    const outside = scopeFixture();
    outside.overrides.scope!.k9![0].runtime.endLine = 40;

    // Assert
    expect(deriveFixture(outside).errors).toContain('K9_RUNTIME_SPAN_INVALID graphic-arc-r0');
  });

  it('K9CitesSeveralRuntimeSpans_EachMustHold', () => {
    // The decisive code of a group can be in several places of one or more files.

    // Arrange
    const f = scopeFixture();
    const span = f.overrides.scope!.k9![0].runtime as ScopeK9Span;

    // Act
    f.overrides.scope!.k9![0].runtime = [span, { ...span, startLine: 2, endLine: 3 }];

    // Assert
    expect(deriveFixture(f).errors).toEqual([]);
    expect(setOf(f, 'public:option.graphic.elements.arc.shape.r0')).toBe('K9');

    // Act
    f.overrides.scope!.k9![0].runtime = [span, { ...span, endLine: 40 }];

    // Assert
    expect(deriveFixture(f).errors).toContain('K9_RUNTIME_SPAN_INVALID graphic-arc-r0');

    // Act
    f.overrides.scope!.k9![0].runtime = [];

    // Assert
    expect(deriveFixture(f).errors).toContain('K9_RUNTIME_SPAN_INVALID graphic-arc-r0');
  });

  it('ResidualMustBeEmpty', () => {
    // Arrange
    const f = scopeFixture();
    const owner = f.schema.types.find(t => t.id === 't:orphan')!;

    // Act
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

    // Assert
    expect(setOf(f, 'property:t:orphan/lost')).toBe('RESIDUAL');
  });

  it('CategoryCannotHideDocumentedRecord', () => {
    // Arrange
    const f = scopeFixture();
    const title = f.schema.records.find(r => r.id === 'public:option.title')!;
    title.provenance.push('source:lib', 'source:shared:4:onclick: string;');

    // Act
    f.overrides.scope!.nativeOnly!.push({ recordId: title.id, reason: 'not a native helper' });

    // Assert
    expect(setOf(f, title.id)).toBe('S1');
  });

  it('LooseValuesNeedUpstreamAny', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    f.looseSymbols.add('ChartOptions.Title');

    // Assert
    expect(deriveFixture(f).loose).toEqual(['public:option.title']);

    // Act
    f.schema.records.find(r => r.id === 'public:option.title')!.inventory!.docsTypes = ['*'];

    // Assert
    expect(deriveFixture(f).loose).toEqual([]);

    // Act
    const justified = scopeFixture();
    justified.looseSymbols.add('ChartOptions.Title');
    justified.overrides.scope!.looseValues = [{ path: 'option.title', reason: 'Upstream declares any.' }];

    // Assert
    expect(deriveFixture(justified).loose).toEqual([]);

    // Act
    justified.overrides.scope!.looseValues = [{ path: 'option.missing', reason: 'stale' }];

    // Assert
    expect(deriveFixture(justified).errors).toContain('STALE_LOOSE_VALUE_OVERRIDE option.missing');
  });

  it('DeclarationSourcesAreHashPinned', () => {
    // Arrange
    const f = scopeFixture();
    const read = f.read;

    // Act
    f.read = (pkg, file) => file.endsWith('shared.d.ts') ? read(pkg, file) + ' ' : read(pkg, file);

    // Assert
    expect(deriveFixture(f).errors).toContain('DECLARATION_SOURCE_HASH_MISMATCH echarts/types/dist/shared.d.ts');
  });

  it('SerializationIsDeterministicAndDriftIsReported', () => {
    // Arrange
    const f = scopeFixture();

    // Act
    const committed = serializeScopeCategories(deriveFixture(f));

    // Assert
    expect(serializeScopeCategories(deriveFixture(scopeFixture()))).toBe(committed);
    expect(createHash('sha256').update(committed).digest('hex')).toHaveLength(64);

    // Act
    const undoc = f.schema.types.find(t => t.id === 't:undoc')!;
    undoc.properties!.push({ ...undoc.properties![0], name: 'added' });
    f.schema.records.push({
      ...f.schema.records.find(r => r.id === 'property:t:undoc/extra')!,
      id: 'property:t:undoc/added',
      canonicalId: 'property:t:undoc/added',
      name: 'added',
    });
    const drift = compareScopeCategories(committed, serializeScopeCategories(deriveFixture(f)));

    // Assert
    expect(drift.join('\n')).toContain('SCOPE_CATEGORY_DRIFT added K8 property:t:undoc/added');
    expect(compareScopeCategories(undefined, committed)).toEqual(['SCOPE_CATEGORY_DRIFT missing committed scope categories']);
  });
});

describe('origin index inputs', () => {
  it('OriginFiles_ComeFromTheArchiveListing_NotFromStaleExtractedFiles', async () => {
    // A declaration file that a previous version left in the extracted directory is not an input of this one.

    // Arrange
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const { join, resolve } = await import('node:path');
    const { originFiles } = await import('../../../tools/BindingGenerator/src/scope-categories.ts');
    const archive = resolve('artifacts/upstream/zrender-6.1.0.tgz');
    const dir = mkdtempSync(resolve('artifacts/generator/origin-'));
    try {
      execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', dir]);

      // Act
      const clean = originFiles(archive, join(dir, 'lib'), 'lib');

      // Assert
      expect(clean.length).toBeGreaterThan(100);
      expect(clean.every(f => f.path.endsWith('.d.ts') && !f.path.startsWith('lib/'))).toBe(true);

      // Act
      mkdirSync(join(dir, 'lib/removed'), { recursive: true });
      writeFileSync(join(dir, 'lib/removed/Stale.d.ts'), 'export declare class Stale {}\n');

      // Assert
      expect(originFiles(archive, join(dir, 'lib'), 'lib')).toEqual(clean);

      // Arrange
      rmSync(join(dir, clean[0].path.replace(/^/, 'lib/')));

      // Act & Assert
      expect(() => originFiles(archive, join(dir, 'lib'), 'lib')).toThrow(/assets:acquire/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
