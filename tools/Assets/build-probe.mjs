import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve('.');
const out = join(root, 'artifacts/compatibility');
await mkdir(out, { recursive: true });
const upstream = join(root, 'artifacts/upstream');
const lock = JSON.parse(await readFile('schemas/upstream/sources.lock.json', 'utf8'));
const pkg = lock.packages.find(p => p.name === '@qyperion/echarts-wordcloud');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
execFileSync(process.execPath, ['tools/Assets/acquire-upstream.mjs', '--offline'], { stdio: 'inherit' });
const sourceRoot = join(out, 'source');
await rm(sourceRoot, { recursive: true, force: true });
await cp(join(upstream, pkg.directory), sourceRoot, { recursive: true });
const result = await build({
  entryPoints: [join(sourceRoot, pkg.installer.entry)],
  bundle: true, format: 'cjs', platform: 'browser', write: false, metafile: true,
  external: ['echarts/lib/echarts'], legalComments: 'inline',
});
const installer = `export default function install(runtime) {\nconst module = {exports:{}}; const exports = module.exports;\nconst require = id => { if(id === 'echarts/lib/echarts') return runtime; throw new Error('Unexpected dependency: '+id); };\n${result.outputFiles[0].text}\nreturn module.exports;\n}\n`;
if (hash(installer) !== pkg.installer.sha256) throw new Error(`WordCloud installer hash mismatch: built ${hash(installer)}, pinned ${pkg.installer.sha256}`);
if (Object.keys(result.metafile.inputs).some(path => !path.replaceAll('\\', '/').startsWith('artifacts/compatibility/source/'))) {
  throw new Error('Unexpected bundled dependency; WordCloud must receive the passed runtime');
}
await writeFile(join(out, 'installer.js'), installer);
await writeFile(join(out, 'installer.meta.json'), JSON.stringify(result.metafile, null, 2));
await build({ entryPoints: ['tests/browser/compatibility/probe.ts'], bundle: true, format: 'esm',
  outfile: join(out, 'probe.js'), external: ['/compatibility/*'], legalComments: 'inline' });
await copyFile(join(upstream, 'echarts/dist/echarts.esm.min.mjs'), join(out, 'echarts.js'));
await copyFile(join(upstream, pkg.directory, 'dist/echarts-wordcloud.js'), join(out, 'echarts-wordcloud.js'));
await copyFile('tests/browser/compatibility/index.html', join(out, 'index.html'));
await mkdir(join(out, 'assets'), { recursive: true });
await copyFile('tests/browser/compatibility/assets/mask.svg', join(out, 'assets/mask.svg'));
await writeFile(join(out, 'provenance.json'), JSON.stringify({
  echarts: '6.1.0', wordcloud: pkg.version, package: pkg.name, archiveHash: pkg.sha256,
  installerHash: hash(installer), echartsHash: hash(await readFile(join(out, 'echarts.js'))),
}, null, 2));
// Preserve exactly the notices supplied by each package.
for (const locked of lock.packages) {
  for (const path of locked.notices) {
    const destination = join(out, 'notices', locked.directory ?? locked.name, path);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(join(upstream, locked.directory ?? locked.name, path), destination);
  }
}
console.log('Static probe built; ECharts is an external passed runtime.');
