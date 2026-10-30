import { readFile, readdir, writeFile, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const cache = resolve(option('--cache-dir', join(root, 'artifacts/upstream')));
// --verify compares the extracted packages with their archives and changes nothing; it never downloads.
const verify = args.includes('--verify');
const lock = JSON.parse(await readFile(join(root, 'schemas/upstream/sources.lock.json'), 'utf8'));
const selected = lock.packages.filter(p => !args.includes('--package') || p.name === option('--package'));
if (!selected.length) throw new Error('No locked package selected.');

const files = async dir => (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile())
  .map(e => relative(dir, join(e.parentPath, e.name)).replaceAll('\\', '/')).sort();
/** Files that the extracted directory has beyond the archive, lacks, or holds with other bytes. */
async function differences(expected, actual) {
  let present;
  try { present = await files(actual); } catch (error) { if (error.code === 'ENOENT') return ['the directory is missing']; throw error; }
  const wanted = await files(expected);
  const listed = new Set(present);
  const changed = [];
  for (const path of wanted.filter(p => listed.has(p))) if (!(await readFile(join(expected, path))).equals(await readFile(join(actual, path)))) changed.push(path);
  return [...present.filter(p => !wanted.includes(p)).map(p => `stale ${p}`), ...wanted.filter(p => !listed.has(p)).map(p => `missing ${p}`), ...changed.map(p => `changed ${p}`)];
}
/** Antivirus scanners briefly hold freshly extracted files on Windows. */
async function replace(staging, destination) {
  for (let attempt = 0; ; attempt++) {
    try { await rm(destination, { recursive: true, force: true, maxRetries: 5 }); await rename(staging, destination); return; }
    catch (error) { if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error; await new Promise(r => setTimeout(r, 200 * (attempt + 1))); }
  }
}

for (const pkg of selected) {
  await mkdir(cache, { recursive: true });
  // A scoped package name holds a slash: the archive and the extracted package use its unscoped directory instead.
  const directory = pkg.directory ?? pkg.name;
  const archive = join(cache, `${directory}-${pkg.version}.tgz`);
  let bytes;
  try { bytes = await readFile(archive); }
  catch (error) {
    if (error.code !== 'ENOENT' || args.includes('--offline') || verify) throw error;
    const response = await fetch(pkg.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${pkg.name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (integrity !== pkg.integrity) throw new Error(`${pkg.name}: integrity mismatch`);
  if (createHash('sha256').update(bytes).digest('hex') !== pkg.sha256) throw new Error(`${pkg.name}: sha256 mismatch`);
  if (!verify) await writeFile(archive, bytes);
  const destination = join(cache, directory);
  // A new version must not inherit the files of the previous one: extract into an empty directory, then replace.
  const staging = await mkdtemp(join(cache, `.${directory}-`));
  try {
    // Relative paths: a GNU tar first in PATH (Git for Windows) reads W:\... as a remote host.
    execFileSync('tar', ['-xf', basename(archive), '--strip-components=1', '-C', basename(staging)], { cwd: cache });
    const metadata = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'));
    if (metadata.name !== pkg.name || metadata.version !== pkg.version) throw new Error(`${pkg.name}: version mismatch`);
    for (const path of [...pkg.notices, ...pkg.declarations]) await readFile(join(staging, path));
    for (const [path, expected] of Object.entries(pkg.files ?? {})) {
      if (createHash('sha256').update(await readFile(join(staging, path))).digest('hex') !== expected) {
        throw new Error(`${pkg.name}/${path}: file hash mismatch`);
      }
    }
    if (verify) {
      const found = await differences(staging, destination);
      if (found.length) throw new Error(`${pkg.name}: ${destination} differs from ${directory}-${pkg.version}.tgz (${found.slice(0, 10).join(', ')}${found.length > 10 ? `, ... ${found.length - 10} more` : ''}). Run npm run assets:acquire.`);
    } else await replace(staging, destination);
  } finally { await rm(staging, { recursive: true, force: true, maxRetries: 5 }); }
  console.log(`${pkg.name}@${pkg.version} sha256=${createHash('sha256').update(bytes).digest('hex')}${verify ? ' verified' : ''}`);
}
