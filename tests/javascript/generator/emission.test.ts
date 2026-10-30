import { describe, it, expect } from 'vitest';
import { readFile, readdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generate, writeGeneration } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { loadSchema, schemaPath, type ApiSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { verifyManifestFiles } from '../../../tools/BindingGenerator/src/coverage.ts';
import { baselineGeneration } from './baseline.ts';

const schema: ApiSchema = loadSchema();
const overrides = JSON.parse(await readFile('schemas/overrides/echarts-6.1.0.json', 'utf8'));

// Streams git's checkout-filtered blob into the hash, so a growing shard needs no output buffer.
const checkoutHash = (path: string) => new Promise<string>((resolve, reject) => {
  const git = spawn('git', ['-c', 'core.autocrlf=true', 'cat-file', '--filters', `HEAD:${path}`]);
  const hash = createHash('sha256');
  git.stdout.on('data', chunk => hash.update(chunk));
  git.on('error', reject);
  git.on('close', code => code === 0 ? resolve(hash.digest('hex')) : reject(new Error(`git cat-file ${path} exited with ${code}`)));
});

const baseline = baselineGeneration;

describe('production emission', () => {
  it('Generator_TooltipGenericCallback_PreservesBothSourceOverloadsAndConcreteParameter', () => {
    // Arrange
    const result = baseline();

    // Act
    const signature = result.manifest.signatures.find(s => s.typeId === 'type:661dd9b1df98bd425cfe2feb');

    // Assert
    expect(signature?.signatures.map(s => s.parameters.length)).toEqual([2, 3]);
    expect(signature?.signatures[0].parameters[0].type).toBe('type:dfc120ce006b7346d2258f1d');
    expect(result.files.get('src/BlazorECharts/Options/Generated/TooltipOption.cs')).toContain('Formatter {');
  });

  it('Generator_PinnedInputsSurviveWindowsGitCheckoutFiltering', async () => {
    // Arrange
    const lock = JSON.parse(await readFile('schemas/upstream/sources.lock.json', 'utf8'));

    // Act & Assert
    for (const file of await readdir(schemaPath)) {
      const path = `${schemaPath}/${file}`;
      expect(await checkoutHash(path), path).toBe(createHash('sha256').update(await readFile(path)).digest('hex'));
    }
  });

  it('Generator_MissingSnapshotFails_RepeatIsByteIdentical', async () => {
    // Arrange
    const result = baseline();

    // Act
    const second = generate(schema, overrides);

    // Assert
    expect([...result.files]).toEqual([...second.files]);
    expect(result.manifest).toEqual(second.manifest);

    // Arrange
    const dir = await mkdtemp(join(tmpdir(), 'echarts-generation-'));
    try {
      // Act & Assert
      await expect(writeGeneration(result, dir, true)).rejects.toThrow(/Missing generated baseline/);

      // Arrange
      await writeGeneration(result, dir, false);
      await writeGeneration(result, dir, true);
      const file = 'src/BlazorECharts/Options/Generated/ChartOptions.cs';
      await writeFile(join(dir, file), 'drift');

      // Act & Assert
      await expect(writeGeneration(result, dir, true)).rejects.toThrow(/Generated drift/);
      expect(await readFile(join(dir, file), 'utf8')).toBe('drift');
      await expect(verifyManifestFiles(result.manifest, dir)).rejects.toThrow(/Emitted file hash mismatch/);

      // Arrange
      await writeFile(join(dir, file), result.files.get(file)!);
      await rm(join(dir, 'src/BlazorECharts/Serialization/Generated/SetOptionOptions.Serializer.g.cs'));

      // Act & Assert
      await expect(verifyManifestFiles(result.manifest, dir)).rejects.toThrow(/property:type:1b369a645e7d387fcf179c72\/replaceMerge/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Generator_StaleFiles_AreFoundInEveryGeneratedLocation', async () => {
    // Every location the core generation writes to, not only its Generated directories.

    // Arrange
    const result = baseline();
    const dir = await mkdtemp(join(tmpdir(), 'echarts-stale-'));
    try {
      await writeGeneration(result, dir, false);
      const strays = [
        'src/BlazorECharts/Options/Generated/Stray.cs', 'src/BlazorECharts/Values/Generated/Signatures/Stray.g.cs',
        'schemas/generated/csharp-manifest/entries.9.json', 'tests/BlazorECharts.Tests/GeneratedContracts/Stray.g.cs',
        'src/BlazorECharts/JavaScript/stray.generated.ts', 'docs/api-coverage/stray-6.1.0.json', 'schemas/generated/stray.json',
      ];

      // Act & Assert
      for (const stray of strays) {
        await writeFile(join(dir, stray), '// stray\n');
        await expect(writeGeneration(result, dir, true), stray).rejects.toThrow(`Stale generated file: ${stray}`);
        await rm(join(dir, stray));
      }

      // Act
      // Hand-written neighbours and the WordCloud outputs are not core files.
      for (const kept of [
        'tests/BlazorECharts.Tests/GeneratedContracts/UnionContractsTests.cs', 'src/BlazorECharts/JavaScript/events.ts',
        'docs/api-coverage/reconciliation.md', 'docs/api-coverage/wordcloud-3.0.0.md', 'schemas/generated/wordcloud-manifest.json',
      ])
        await writeFile(join(dir, kept), 'hand-written\n');

      await writeGeneration(result, dir, true);
      await writeFile(join(dir, strays[3]), '// stray\n');
      await writeGeneration(result, dir, false);

      // Assert
      expect(existsSync(join(dir, strays[3]))).toBe(false);
      expect(existsSync(join(dir, 'docs/api-coverage/reconciliation.md'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Generator_UnsupportedAlternative_IsNamedAndNotObjectFallback', () => {
    // Arrange
    const copy = structuredClone(schema);
    const root = copy.types.find(t => t.id === 'type:a274ece4f795b03fde116ff6')!;
    root.properties!.push({ name: 'future', type: 'future-union', optional: true, readonly: false, provenance: root.provenance });
    copy.types.push(
      {
        id: 'future-union',
        kind: 'union',
        display: 'string | symbol',
        alternatives: ['type:9d02ffb53f936112c4a8c482', 'future-symbol'],
        provenance: root.provenance,
      },
      { id: 'future-symbol', kind: 'symbol', display: 'symbol', provenance: root.provenance }
    );
    copy.records.push({
      id: `property:${root.id}/future`,
      canonicalId: `property:${root.id}/future`,
      kind: 'property',
      name: 'future',
      publicPath: `graph:${root.id}.future`,
      type: 'future-union',
      provenance: root.provenance,
      family: 'declarations',
      status: 'unresolved',
      implementationReferences: [],
      testReferences: [],
    });
    const changedOverrides = structuredClone(overrides);

    // This fixture mutates ChartOptions to test data emission. Remaining-action
    // proofs deliberately pin its entire source closure and reject that mutation;
    // those independent runtime proofs are exercised in their own fixtures.
    changedOverrides.eventActions = changedOverrides.eventActions.filter(m => !m.runtimeRemainingPayload);
    changedOverrides.csharp.pins = changedOverrides.csharp.pins.filter((p: { typeId: string }) => p.typeId !== root.id);
    for (const p of changedOverrides.csharp.componentProperties.filter(p => p.parent === root.id))
      p.sha256 = createHash('sha256').update(JSON.stringify(root)).digest('hex');

    // Act
    const result = generate(copy, changedOverrides);

    // Assert
    expect(result.diagnostics.some(d => d.sourceId === 'property:type:a274ece4f795b03fde116ff6/future' && d.message.includes('future-symbol'))).toBe(
      true
    );
    expect(result.manifest.entries.find(e => e.sourceId.endsWith('/future'))?.status).toBe('unresolved');
  });

  it('Generator_NativeInstanceWithRequiredMethods_IsNotAnOptionModel', () => {
    // Arrange
    const copy = structuredClone(schema);
    const root = copy.types.find(t => t.id === 'type:a274ece4f795b03fde116ff6')!;
    root.properties!.push({
      name: 'nativeHandler',
      type: 'type:08ba7a46ad404e739216992f',
      optional: true,
      readonly: false,
      provenance: root.provenance,
    });
    const changed = structuredClone(overrides);
    changed.eventActions = changed.eventActions.filter(m => !m.runtimeRemainingPayload);
    changed.csharp.pins = changed.csharp.pins.filter((p: { typeId: string }) => p.typeId !== root.id);
    for (const p of changed.csharp.componentProperties.filter(p => p.parent === root.id))
      p.sha256 = createHash('sha256').update(JSON.stringify(root)).digest('hex');

    // Act
    const result = generate(copy, changed);

    // Assert
    expect([...result.files.keys()].some(p => p.endsWith('/Handler.cs'))).toBe(false);
    expect(result.diagnostics.some(d => d.message.includes('type:08ba7a46ad404e739216992f'))).toBe(true);
  });
});
