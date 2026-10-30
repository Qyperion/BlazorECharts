import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/** Reuses the exact validated installer recipe, retaining its independently pinned hash. */
export async function buildWordCloudAssets(root, check) {
  execFileSync(process.execPath, ['tools/Assets/build-probe.mjs'], {cwd:root,stdio:'inherit'});
  const lock = JSON.parse(await readFile(join(root,'schemas/upstream/sources.lock.json'),'utf8'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const pkg=lock.packages.find(p=>p.name==='@qyperion/echarts-wordcloud');
  const installer = await readFile(join(root,'artifacts/compatibility/installer.js'));
  if (hash(installer) !== pkg.installer.sha256) throw new Error('WordCloud proof provenance mismatch.');
  const bundled = await build({absWorkingDir:root,entryPoints:['src/BlazorECharts.WordCloud/JavaScript/wordcloud-extension.ts'],
    bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,metafile:true,external:['./wordcloud-installer.js','../../BlazorECharts/js/blazor-echarts.js']});
  if (Object.keys(bundled.metafile.inputs).some(path => !path.startsWith('src/BlazorECharts.WordCloud/JavaScript/')))
    throw new Error('WordCloud extension must not bundle another ECharts identity.');
  await mkdir(join(root,'artifacts/assets'),{recursive:true});
  await writeFile(join(root,'artifacts/assets/wordcloud-metafile.json'),JSON.stringify(bundled.metafile,null,2)+'\n');
  const files=new Map([['js/wordcloud-installer.js',installer],['js/wordcloud-extension.js',bundled.outputFiles[0].contents]]);
  // The package LICENSE carries the ISC text of echarts-wordcloud and the MIT text of the wordcloud2.js layout it bundles.
  for(const path of pkg.notices) files.set(`notices/${pkg.directory}/${path}`,await readFile(join(root,'artifacts/upstream',pkg.directory,path)));
  files.set('notices/PROVENANCE.md',Buffer.from(`# WordCloud artifact\n\n${pkg.name} ${pkg.version}, npm gitHead ${pkg.upstreamCommit} (${pkg.repository}).\nArchive SHA256 ${pkg.sha256}.\nInstaller built from ${pkg.installer.entry} with ${pkg.installer.buildTool}, SHA256 ${pkg.installer.sha256}.\nnotices/${pkg.directory}/LICENSE is the LICENSE of the package: the ISC text of echarts-wordcloud and the MIT text of the wordcloud2.js layout it bundles.\nECharts is supplied by the core RCL, and is not bundled here.\n`));
  files.set('js/assets-manifest.json',Buffer.from(JSON.stringify({formatVersion:1,version:pkg.version,
    coreVersion:'6.1.0',package:pkg,
    files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))},null,2)+'\n'));
  for(const [path,bytes] of files) {
    const target=join(root,'src/BlazorECharts.WordCloud/wwwroot',path);
    if(check) { if(!Buffer.from(await readFile(target)).equals(Buffer.from(bytes))) throw new Error(`WordCloud asset drift: ${path}`); }
    else { await mkdir(resolve(target,'..'),{recursive:true}); await writeFile(target,bytes); }
  }
  console.log(`${check?'Verified':'Built'} ${files.size} optional WordCloud assets; exact proof installer; no bundled ECharts.`);
}
