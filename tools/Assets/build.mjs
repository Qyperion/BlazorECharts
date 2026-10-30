import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWordCloudAssets } from './build-wordcloud.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const check = process.argv.includes('--check');
const output = join(root, 'src/BlazorECharts/wwwroot');
const lock = JSON.parse(await readFile(join(root, 'schemas/upstream/sources.lock.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Re-extract verified archives so modified unpacked files cannot enter a product bundle.
execFileSync(process.execPath, ['tools/Assets/acquire-upstream.mjs', '--offline'], { cwd: root, stdio: 'inherit' });
const echarts = lock.packages.find(pkg => pkg.name === 'echarts');
// Packages ship the minified production build; the development build stays in the test harnesses.
const runtimeBytes = await readFile(join(root, 'artifacts/upstream/echarts/dist/echarts.esm.min.mjs'));
if (echarts.version !== '6.1.0' || hash(runtimeBytes) !== echarts.files['dist/echarts.esm.min.mjs']) throw new Error('Pinned runtime mismatch.');
const files = new Map([['js/echarts-6.1.0.js', runtimeBytes]]);
const bundled = await build({ absWorkingDir: root, entryPoints: ['src/BlazorECharts/JavaScript/runtime-loader.ts'],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true,
  // Whitespace and syntax only: names stay readable in stack traces and for the test harness patches.
  minifyWhitespace: true, minifySyntax: true,
  legalComments: 'inline', outfile: 'runtime-loader.js' });
if (Object.keys(bundled.metafile.inputs).some(path => !path.replaceAll('\\', '/').startsWith('src/BlazorECharts/JavaScript/')))
  throw new Error('Core facade must not bundle ECharts or WordCloud.');
await mkdir(join(root, 'artifacts/assets'), { recursive: true });
await writeFile(join(root, 'artifacts/assets/core-metafile.json'), JSON.stringify(bundled.metafile, null, 2) + '\n');
files.set('js/runtime-loader.js', bundled.outputFiles[0].contents);
// The stable browser API reads the page coordinator from its global key; it never imports the interop module.
const stable = await build({ absWorkingDir: root, entryPoints: ['src/BlazorECharts/JavaScript/blazor-echarts.ts'],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true,
  legalComments: 'inline', outfile: 'blazor-echarts.js' });
const stableInputs = ['blazor-echarts.ts', 'runtime-protocol.ts', 'errors.ts'].map(name => `src/BlazorECharts/JavaScript/${name}`);
if (Object.keys(stable.metafile.inputs).some(path => !stableInputs.includes(path.replaceAll('\\', '/'))))
  throw new Error('The stable browser module must only read the page coordinator of its protocol.');
files.set('js/blazor-echarts.js', stable.outputFiles[0].contents);
for (const pkg of lock.packages.filter(pkg => ['echarts', 'zrender', 'tslib'].includes(pkg.name))) {
  for (const path of pkg.notices) files.set(`notices/${pkg.name}/${path}`, await readFile(join(root, 'artifacts/upstream', pkg.name, path)));
}
const manifest = { formatVersion: 1, buildTool: 'esbuild@0.28.2',
  runtime: { version: echarts.version, sourceSha256: hash(runtimeBytes), archiveSha256: echarts.sha256 },
  files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) })).sort((a, b) => a.path.localeCompare(b.path)),
};
files.set('js/assets-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
for (const [path, bytes] of files) {
  const destination = join(output, path);
  if (check) {
    if (!Buffer.from(await readFile(destination)).equals(Buffer.from(bytes))) throw new Error(`Asset drift: ${path}`);
  } else {
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, bytes);
  }
}
console.log(`${check ? 'Verified' : 'Built'} ${files.size} pinned core assets; ECharts ${echarts.version}; no WordCloud in core.`);
await buildWordCloudAssets(root, check);
