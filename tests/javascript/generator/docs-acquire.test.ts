import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { acquireDocumentation, docsLockPath } from '../../../tools/BindingGenerator/src/docs-snapshot.ts';

const cache = 'artifacts/generator/upstream/echarts-doc.tgz';

/** A workspace with the real lock and a tarball whose converter leaves a marker when anything requires it. */
function workspace(extra: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-acquire-'));
  mkdirSync(join(root, 'schemas/upstream'), { recursive: true });
  writeFileSync(join(root, docsLockPath), readFileSync(docsLockPath));
  const tool = join(root, 'package/echarts-doc/tool');
  mkdirSync(tool, { recursive: true });
  const marker = join(root, 'converter-ran.txt');
  writeFileSync(
    join(tool, 'md2json.js'),
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = async () => ({ option: {} });\n`
  );
  for (const [path, text] of Object.entries(extra)) {
    mkdirSync(join(root, 'package/echarts-doc', path, '..'), { recursive: true });
    writeFileSync(join(root, 'package/echarts-doc', path), text);
  }

  execFileSync('tar', ['-czf', 'hostile.tgz', '-C', 'package', 'echarts-doc'], { cwd: root });
  const hostile = readFileSync(join(root, 'hostile.tgz'));
  const unpacked = () => readdirSync(join(root, 'artifacts/generator'), { withFileTypes: true }).filter(e => e.name.startsWith('docs-build-')).length;
  return { root, marker, hostile, unpacked };
}

describe('docs:acquire integrity', () => {
  it('DocsAcquire_TamperedCachedArchive_FailsBeforeUnpackOrRequire', async () => {
    // Arrange
    const w = workspace();
    mkdirSync(join(w.root, 'artifacts/generator/upstream'), { recursive: true });
    writeFileSync(join(w.root, cache), w.hostile);

    // Act & Assert
    await expect(acquireDocumentation({ offline: true, root: w.root })).rejects.toThrow('archive integrity mismatch');
    expect(existsSync(w.marker)).toBe(false);
    expect(w.unpacked()).toBe(0);
    expect(readFileSync(join(w.root, cache))).toEqual(w.hostile);
  });

  it('DocsAcquire_TamperedDownload_NeverReachesTheCache', async () => {
    // Arrange
    const w = workspace();

    // Act & Assert
    await expect(acquireDocumentation({ root: w.root, download: async () => new Uint8Array(w.hostile) })).rejects.toThrow(
      'archive integrity mismatch'
    );
    expect(existsSync(w.marker)).toBe(false);
    expect(existsSync(join(w.root, cache))).toBe(false);
    expect(existsSync(join(w.root, 'artifacts/generator')) ? w.unpacked() : 0).toBe(0);
  });

  it('DocsAcquire_Candidate_RunsAnUnpinnedArchiveOnlyWhenAsked', async () => {
    // Arrange
    const w = workspace();

    // Act & Assert
    await expect(acquireDocumentation({ root: w.root, candidate: true, download: async () => new Uint8Array(w.hostile) })).rejects.toThrow('review');
    expect(existsSync(w.marker)).toBe(true);
    expect(existsSync(join(w.root, cache))).toBe(false);

    // Act
    const candidate = JSON.parse(readFileSync(join(w.root, 'artifacts/generator/docs-snapshot.lock.candidate.json'), 'utf8'));

    // Assert
    expect(candidate.sha256).toBe(createHash('sha256').update(w.hostile).digest('hex'));
    expect(w.unpacked()).toBe(0);
  });

  it('DocsAcquire_CandidateInputs_ListEveryToolAndDepFile', async () => {
    // The converter reads templates too, not only scripts.

    // Arrange
    const w = workspace({ 'tool/plain-md.tpl': 'template', 'dep/helper.json': '{}' });

    // Act & Assert
    await expect(acquireDocumentation({ root: w.root, candidate: true, download: async () => new Uint8Array(w.hostile) })).rejects.toThrow('review');

    // Act
    const candidate = JSON.parse(readFileSync(join(w.root, 'artifacts/generator/docs-snapshot.lock.candidate.json'), 'utf8'));

    // Assert
    expect(candidate.inputs.map((i: { path: string }) => i.path)).toEqual(['dep/helper.json', 'tool/md2json.js', 'tool/plain-md.tpl']);
  });

  it('DocsAcquire_CandidateWithNodeModules_IsRejectedBeforeUnpackOrRequire', async () => {
    // The converter must resolve marked, globby and htmlparser2 from the workspace, not from code the archive brings along.

    // Arrange
    const w = workspace({ 'node_modules/marked/index.js': `require('fs').writeFileSync('bundled-ran.txt', 'ran');` });

    // Act & Assert
    await expect(acquireDocumentation({ root: w.root, candidate: true, download: async () => new Uint8Array(w.hostile) })).rejects.toThrow(
      /node_modules/
    );
    expect(existsSync(w.marker)).toBe(false);
    expect(w.unpacked()).toBe(0);
  });

  it('DocsAcquire_OfflineCandidate_UsesTheSavedCandidate', async () => {
    // Arrange
    const w = workspace();
    mkdirSync(join(w.root, 'artifacts/generator/upstream'), { recursive: true });
    writeFileSync(join(w.root, 'artifacts/generator/upstream/echarts-doc.candidate.tgz'), w.hostile);

    // Act & Assert
    await expect(acquireDocumentation({ root: w.root, offline: true, candidate: true })).rejects.toThrow('review');
    expect(existsSync(w.marker)).toBe(true);
    expect(existsSync(join(w.root, cache))).toBe(false);
    expect(JSON.parse(readFileSync(join(w.root, 'artifacts/generator/docs-snapshot.lock.candidate.json'), 'utf8')).sha256).toBe(
      createHash('sha256').update(w.hostile).digest('hex')
    );
  });
});
