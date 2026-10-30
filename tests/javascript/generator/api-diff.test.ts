import { expect, test } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';
import { diffApi } from '../../../tools/BindingGenerator/src/api-diff.ts';
import { signatureHash } from '../../../tools/BindingGenerator/src/validate-overrides.ts';
import { serializeSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import type { ApiSchema } from '../../../tools/BindingGenerator/src/schema.ts';

// Both versions are the same upstream file, so declaration identities line up as in a real upgrade.
const locate = (version: string) => (file: string) => {
  const path = file.replaceAll('\\', '/');
  const lib = path.lastIndexOf('/typescript/lib/');
  return lib >= 0 ? { package: 'typescript', version: '6.0.3', file: path.slice(lib + 1) } : { package: 'fixture', version, file: 'api-diff.d.ts' };
};

const extract = (name: string, version: string) =>
  extractDeclarations([resolve(`tests/javascript/generator/fixtures/${name}`)], { locate: locate(version) });

const before = () => extract('api-diff-before.d.ts', '1.0.0');
const after = () => extract('api-diff-after.d.ts', '1.1.0');

const property = (schema: ApiSchema, owner: string, name: string) => {
  const type = schema.types.find(t => t.display === owner)!;
  return schema.records.find(r => r.id === `property:${type.id}/${name}`)!;
};

test('AddedMemberIsUnresolved', () => {
  // Arrange
  const next = after();

  // Act
  const report = diffApi(before(), next);

  // Assert
  expect(report.entries).toContainEqual(expect.objectContaining({
    code: 'ADDED_MEMBER',
    recordId: property(next, 'TitleOption', 'subtext').id,
    resolution: 'unresolved',
    semver: 'minor',
  }));

  // A member of an anonymous object is reported on the stable record that owns the object.
  expect(report.entries).toContainEqual(expect.objectContaining({
    code: 'ADDED_MEMBER',
    recordId: property(next, 'EChartsOption', 'legend').id,
    detail: 'top: number',
    resolution: 'unresolved',
  }));
  expect(report.entries.filter(e => e.code === 'REMOVED_MEMBER')).toEqual([]);
});

test('AddedUnionAlternativeRequiresMapping', () => {
  // Arrange
  const next = after();
  const report = diffApi(before(), next);

  // Act
  const padding = report.entries.filter(e => e.recordId === property(next, 'TitleOption', 'padding').id);

  // Assert
  expect(padding).toEqual([
    expect.objectContaining({ code: 'UNION_ALTERNATIVE_ADDED', detail: 'string', resolution: 'requires-mapping', semver: 'minor' }),
  ]);
});

test('RemovedOverloadRequiresReview', () => {
  // Arrange
  const next = after();
  const report = diffApi(before(), next);

  // Act
  const resize = report.entries.filter(e => e.recordId === property(next, 'ECharts', 'resize').id);

  // Assert
  expect(resize).toEqual([expect.objectContaining({ code: 'OVERLOAD_REMOVED', resolution: 'requires-review', semver: 'major' })]);
  expect(resize[0].detail).toMatch(/width\?.*height\?/);
  expect(report.summary.semver).toBe('major');
});

test('StaleOverrideRejected', () => {
  // Arrange
  const old = before();
  const next = after();
  const formatter = property(old, 'EChartsOption', 'formatter');

  // Act
  const overrides = {
    formatVersion: 1,
    mappings: [
      {
        recordId: formatter.id,
        expectedSignature: signatureHash(old, formatter),
        reason: 'Fixture',
        source: old.provenance.find(p => p.id === formatter.provenance[0])!,
        sourceUrl: 'https://example.test',
        regressionFixture: 'x',
        requirements: [],
      },
    ],
  };

  // Assert
  expect(diffApi(old, structuredClone(old), overrides).entries).toEqual([]);

  // Act
  const report = diffApi(old, next, overrides);

  // Assert
  expect(report.entries).toContainEqual(expect.objectContaining({
    code: 'STALE_OVERRIDE',
    recordId: formatter.id,
    resolution: 'rejected',
    detail: 'mappings[0]: pinned signature changed',
  }));
  expect(report.entries).toContainEqual(
    expect.objectContaining({ code: 'SIGNATURE_CHANGED', recordId: formatter.id, detail: 'string -> (value: number) => string' })
  );
  expect(report.summary.rejected).toBeGreaterThan(0);
});

test('ApiDiff_UnchangedSchema_ReportsNothing', () => {
  // Act
  const report = diffApi(before(), before());

  // Assert
  expect(report.entries).toEqual([]);
  expect(report.nested).toEqual([]);
  expect(report.summary.semver).toBe('patch');
});

test('ApiDiff_Cli_WritesReportAndRejectsStaleOverrides', async () => {
  // Arrange
  const dir = await mkdtemp(join(tmpdir(), 'api-diff-'));
  try {
    const old = before();
    const formatter = property(old, 'EChartsOption', 'formatter');
    await writeFile(join(dir, 'before.json'), serializeSchema(old));
    await writeFile(join(dir, 'after.json'), serializeSchema(after()));
    await writeFile(join(dir, 'none.json'), JSON.stringify({ formatVersion: 1, mappings: [] }));
    await writeFile(
      join(dir, 'stale.json'),
      JSON.stringify({ formatVersion: 1, mappings: [{ recordId: formatter.id, expectedSignature: signatureHash(old, formatter) }] })
    );
    const run = (...args: string[]) => spawnSync(process.execPath, ['tools/BindingGenerator/src/cli.ts', 'diff', ...args], { encoding: 'utf8' });
    const args = (overrides: string) => [
      '--before',
      join(dir, 'before.json'),
      '--after',
      join(dir, 'after.json'),
      '--output',
      join(dir, `${overrides}-report.json`),
      '--overrides',
      join(dir, `${overrides}.json`),
    ];

    // Act
    const clean = run(...args('none'));

    // Assert
    expect(clean.status, clean.stderr).toBe(0);

    // Act
    const report = JSON.parse(await readFile(join(dir, 'none-report.json'), 'utf8'));

    // Assert
    expect(report.summary).toMatchObject({ rejected: 0, semver: 'major' });
    expect(report.summary.byCode).toMatchObject({ ADDED_MEMBER: 2, UNION_ALTERNATIVE_ADDED: 1, OVERLOAD_REMOVED: 1, SIGNATURE_CHANGED: 1 });

    // Act
    const stale = run(...args('stale'));

    // Assert
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('STALE_OVERRIDE');
    expect(JSON.parse(await readFile(join(dir, 'stale-report.json'), 'utf8')).summary.rejected).toBe(1);

    // Act
    const usage = run('--before', join(dir, 'before.json'));

    // Assert
    expect(usage.status).toBe(1);
    expect(usage.stderr).toMatch(/--after/);

    // Act
    // Re-pinning an override after review needs the signature of the record in the new schema.
    const next = after();
    const pin = spawnSync(process.execPath, ['tools/BindingGenerator/src/cli.ts', 'signature', '--schema', join(dir, 'after.json'), formatter.id], {
      encoding: 'utf8',
    });

    // Assert
    expect(pin.status, pin.stderr).toBe(0);
    expect(JSON.parse(pin.stdout)).toEqual([
      { recordId: formatter.id, signature: signatureHash(next, property(next, 'EChartsOption', 'formatter')) },
    ]);

    // Act
    const unknown = spawnSync(
      process.execPath,
      ['tools/BindingGenerator/src/cli.ts', 'signature', '--schema', join(dir, 'after.json'), 'public:missing'],
      { encoding: 'utf8' }
    );

    // Assert
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('UNKNOWN_RECORD public:missing');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('StaleCSharpContentPinIsRejected', () => {
  // Arrange
  const next = after();
  const root = next.records.find(r => r.kind === 'export' && r.name === 'EChartsOption')!;
  const pinned = next.types.find(t => t.display === 'TitleOption')!;
  const overrides = {
    formatVersion: 1,
    mappings: [],
    csharp: {
      roots: [{ recordId: root.id, name: 'ChartOptions' }],
      names: [{ typeId: pinned.id, name: 'TitleOption', reason: '' }],
      defaults: [],
      pins: [{ typeId: pinned.id, sha256: '0'.repeat(64) }],
    },
  };

  // Act
  const details = diffApi(before(), next, overrides).entries.filter(e => e.code === 'STALE_OVERRIDE' && e.recordId === 'csharp').map(e => e.detail);

  // Assert
  expect(details).toContain(`Stale C# type pin: ${pinned.id}`);
  expect(details).toContain('Missing reason of C# name: TitleOption');
});
