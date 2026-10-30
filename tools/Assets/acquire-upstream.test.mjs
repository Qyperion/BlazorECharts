import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

test('Acquire_RejectsTamperedArtifact', async () => {
  await mkdir('artifacts/acquire-tests', { recursive: true });
  const cache = await mkdtemp('artifacts/acquire-tests/tamper-');
  try {
    const original = await readFile('artifacts/upstream/echarts-wordcloud-3.0.0.tgz');
    // A valid gzip with trailing bytes still extracts; only integrity detects this change.
    await writeFile(join(cache, 'echarts-wordcloud-3.0.0.tgz'), Buffer.concat([original, Buffer.from('altered')]));
    const before = await readFile('schemas/upstream/sources.lock.json');
    const result = spawnSync(process.execPath, ['tools/Assets/acquire-upstream.mjs', '--offline', '--package', '@qyperion/echarts-wordcloud', '--cache-dir', cache], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Altered archive must fail acquisition');
    assert.match(result.stderr, /integrity mismatch/);
    assert.deepEqual(await readFile('schemas/upstream/sources.lock.json'), before);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('Acquire_ExtractsIntoAnEmptyDirectory_AndVerifyNeverRewrites', async () => {
  const { copyFile, rm, stat } = await import('node:fs/promises');
  await mkdir('artifacts/acquire-tests', { recursive: true });
  const cache = await mkdtemp('artifacts/acquire-tests/clean-');
  const run = (...flags) => spawnSync(process.execPath, ['tools/Assets/acquire-upstream.mjs', '--offline', '--package', '@qyperion/echarts-wordcloud', '--cache-dir', cache, ...flags], { encoding: 'utf8' });
  try {
    await copyFile('artifacts/upstream/echarts-wordcloud-3.0.0.tgz', join(cache, 'echarts-wordcloud-3.0.0.tgz'));
    assert.equal(run('--verify').status, 1, 'Verify fails before the first extraction');
    assert.equal(run().status, 0);
    assert.equal(run('--verify').status, 0);
    // A file that the archive does not contain, such as one a previous version left behind.
    const stale = join(cache, 'echarts-wordcloud/src/removed.js');
    await writeFile(stale, 'stale');
    const verify = run('--verify');
    assert.equal(verify.status, 1);
    assert.match(verify.stderr, /src\/removed\.js/);
    assert.ok(await stat(stale), 'Verify leaves the directory as it is');
    await writeFile(join(cache, 'echarts-wordcloud/index.d.ts'), 'changed');
    assert.match(run('--verify').stderr, /index\.d\.ts/);
    assert.equal(run().status, 0);
    await assert.rejects(stat(stale));
    assert.equal(run('--verify').status, 0);
  } finally { await rm(cache, { recursive: true, force: true }); }
});

test('Acquire_ScopedPackage_ExtractsIntoItsDirectory', async () => {
  const { copyFile, readdir } = await import('node:fs/promises');
  await mkdir('artifacts/acquire-tests', { recursive: true });
  const cache = await mkdtemp('artifacts/acquire-tests/scoped-');
  try {
    // The archive and the extracted package keep the unscoped directory name, so no @qyperion folder appears.
    await copyFile('artifacts/upstream/echarts-wordcloud-3.0.0.tgz', join(cache, 'echarts-wordcloud-3.0.0.tgz'));
    const result = spawnSync(process.execPath, ['tools/Assets/acquire-upstream.mjs', '--offline', '--package', '@qyperion/echarts-wordcloud', '--cache-dir', cache], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /@qyperion\/echarts-wordcloud@3\.0\.0/);
    const metadata = JSON.parse(await readFile(join(cache, 'echarts-wordcloud/package.json'), 'utf8'));
    assert.equal(metadata.name, '@qyperion/echarts-wordcloud');
    assert.deepEqual((await readdir(cache)).sort(), ['echarts-wordcloud', 'echarts-wordcloud-3.0.0.tgz']);
  } finally { await rm(cache, { recursive: true, force: true }); }
});
