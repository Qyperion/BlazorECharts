import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hash } from './resolve-types.ts';
import type { DocumentationEntry, DocumentationSnapshot } from './reconcile-docs.ts';

const slash = (s: string) => s.replaceAll('\\', '/');
const output = 'artifacts/generator/docs';
export const docsLockPath = 'schemas/upstream/docs-snapshot.lock.json';

export function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap(d => d.isDirectory() ? filesIn(join(dir, d.name)) : [join(dir, d.name)]);
}

interface DocNode {
  type?: string | string[];
  default?: unknown;
  description?: string;
  properties?: Record<string, DocNode>;
  items?: DocNode;
}

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&');

/** Uses the pinned upstream ETPL/Markdown converter, not a replacement template parser. */
export async function buildDocumentation(dir: string, commit: string, outputDir = output) {
  mkdirSync(outputDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const convert = require(join(resolve(dir), 'tool/md2json.js'));
  const tplEnv = {
    galleryViewPath: 'https://echarts.apache.org/examples/en/view.html?c=',
    galleryEditorPath: 'https://echarts.apache.org/examples/en/editor.html?c=',
    galleryPath: 'https://echarts.apache.org/examples/en/',
    websitePath: 'https://echarts.apache.org',
    handbookPath: 'https://echarts.apache.org/handbook/en/',
    ecVersion: '6.1.0',
  };
  const entries: Omit<DocumentationEntry, 'source'>[] = [];
  const trees: { path: string; sha256: string }[] = [];
  for (const tree of ['option', 'api']) {
    const schema = await convert({ path: `${slash(resolve(dir))}/en/${tree}/**/*.md`, entry: tree, tplEnv, imageRoot: '' });
    const treeBytes = JSON.stringify(schema) + '\n';
    writeFileSync(`${outputDir}/${tree}.json`, treeBytes);
    trees.push({ path: `${tree}.json`, sha256: hash(treeBytes) });
    const walk = (node: DocNode, path: string, category: string) => {
      const types = (Array.isArray(node.type) ? node.type : node.type ? [node.type] : []).map(String);
      if (path && category) {
        const description = node.description ?? '';
        const examples = tree === 'api'
          ? [...description.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map(m => decode(m[1])).slice(0, 3)
          : [];
        entries.push({
          path,
          category,
          types,
          descriptionHash: hash(description),
          ...(node.default !== undefined ? { defaultValue: node.default } : {}),
          ...(examples.length ? { examples } : {}),
        });
      }

      const children = node.properties ?? node.items?.properties ?? {};
      for (const [name, child] of Object.entries(children)) {
        const childPath = path ? `${path}.${name}` : name;
        let nextCategory = category;
        if (tree === 'api') {
          if (childPath.startsWith('events.'))
            nextCategory = 'event';
          else if (childPath.startsWith('action.'))
            nextCategory = 'action';
          else if (childPath.startsWith('echartsInstance.'))
            nextCategory = childPath.split('.').length > 2 ? 'api-parameter' : childPath.endsWith('.group') ? 'instance-property' : 'instance-method';
          else if (childPath.startsWith('echarts.graphic.'))
            nextCategory = 'graphic';
          else if (childPath === 'echarts.graphic')
            nextCategory = 'graphic-namespace';
          else if (childPath.startsWith('echarts.'))
            nextCategory = childPath.split('.').length > 2 ? 'api-parameter' : 'global-method';
          else
            nextCategory = '';
        }

        // Category headings are containers, not separate events/actions.
        const childTypes = Array.isArray(child.type) ? child.type : [child.type];
        const isContainer = (nextCategory === 'event' || nextCategory === 'action')
          && !childTypes.includes('Event')
          && !childTypes.includes('Action')
          && Object.keys(child.properties ?? {}).length > 0;
        if (isContainer) {
          for (const [n, c] of Object.entries(child.properties!))
            walk(c, `${childPath}.${n}`, nextCategory);
        } else
          walk(child, childPath, nextCategory);
      }
    };
    walk(schema.option, tree === 'option' ? 'option' : '', tree === 'option' ? 'option' : '');
  }

  // Template headings named Mouse events group nine actual event records.
  for (const e of entries)
    if (e.path.startsWith('events.Mouse events.'))
      e.path = e.path.replace('events.Mouse events.', 'events.');

  const sorted = [...new Map(entries.filter(e => e.path !== 'option').map(e => [e.path, e])).values()].sort(
    (a, b) => a.path.localeCompare(b.path, 'en')
  );
  const lines = sorted.map(e => JSON.stringify(e));
  const bytes = lines.join('\n') + '\n';
  writeFileSync(`${outputDir}/records.jsonl`, bytes);
  const recordsSha256 = hash(bytes);
  const snapshot: DocumentationSnapshot = {
    formatVersion: 1,
    commit,
    entries: sorted.map((entry, i) => ({
      ...entry,
      source: {
        package: 'echarts-doc',
        version: commit,
        file: 'normalized/records.jsonl',
        sha256: recordsSha256,
        start: { line: i + 1, column: 1 },
        end: { line: i + 1, column: lines[i].length + 1 },
      },
    })),
  };
  const snapshotBytes = JSON.stringify(snapshot) + '\n';
  writeFileSync(`${outputDir}/snapshot.json`, snapshotBytes);

  // The converter scripts and everything else of tool/ and dep/ they may read, such as templates.
  const inputs = filesIn(dir)
    .filter(f => /[\\/]en[\\/](option|api)[\\/].*\.md$/.test(f)
      || /(^|\/)(tool|dep)\//.test(slash(relative(dir, f)))
      || /[\\/](LICENSE|NOTICE|package\.json)$/.test(f))
    .map(f => ({ path: slash(relative(dir, f)), sha256: hash(readFileSync(f)) }));
  return { snapshotSha256: hash(snapshotBytes), recordsSha256: hash(bytes), entries: sorted.length, trees, inputs, tplEnv };
}

export interface AcquireOptions {
  /** Reuse the cached archive instead of downloading it. */
  offline?: boolean;

  /** Unpack and run an archive that differs from the lock, to write a candidate lock for review. */
  candidate?: boolean;

  /** Workspace root that the lock and artifacts paths are relative to. */
  root?: string;

  download?: (url: string) => Promise<Uint8Array>;
}

async function fetchArchive(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok)
    throw new Error(`Documentation download: ${response.status}`);

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The archive is hashed before anything else: an archive that differs from the lock is never written to
 * the cache, unpacked or run (its tool/ scripts convert the documentation) unless candidate is set.
 */
export async function acquireDocumentation(
  { offline = false, candidate = false, root = process.cwd(), download = fetchArchive }: AcquireOptions = {}
): Promise<void> {
  const lock = JSON.parse(readFileSync(join(root, docsLockPath), 'utf8'));
  const cached = join(root, 'artifacts/generator/upstream/echarts-doc.tgz');
  const savedCandidate = join(root, 'artifacts/generator/upstream/echarts-doc.candidate.tgz');

  // Offline, a candidate run converts the candidate archive that the previous run saved, not the pinned cache.
  const bytes = offline ? readFileSync(candidate ? savedCandidate : cached) : await download(lock.url);
  const archiveSha256 = hash(bytes);
  const pinned = archiveSha256 === lock.sha256;
  if (!pinned && !candidate) {
    throw new Error(
      `Documentation archive integrity mismatch with ${docsLockPath}: ${archiveSha256}, pinned ${lock.sha256}. Nothing was unpacked or run. `
      + 'To pin another commit, review the tool/ and dep/ scripts of that archive first, then run npm run docs:acquire -- --candidate.'
    );
  }

  // Only the pinned archive reaches the cache; a candidate is kept apart from it.
  const archive = pinned ? cached : savedCandidate;
  mkdirSync(dirname(archive), { recursive: true });
  if (!offline || !existsSync(archive))
    writeFileSync(archive, bytes);

  const bundled = execFileSync('tar', ['-tzf', relative(root, archive)], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(entry => /(^|\/)node_modules(\/|$)/.test(entry));
  if (bundled.length)
    throw new Error(`Documentation archive ${relative(root, archive)} contains node_modules (${bundled[0]}); nothing was unpacked or run. The converter resolves marked, globby and htmlparser2 from the workspace.`);

  const temp = mkdtempSync(join(root, 'artifacts/generator/docs-build-'));
  try {
    execFileSync('tar', ['-xf', relative(root, archive), '--strip-components=1', '-C', relative(root, temp)], { cwd: root });
    const result = await buildDocumentation(temp, lock.commit, join(root, output));
    if (!pinned
      || result.snapshotSha256 !== lock.snapshotSha256
      || result.recordsSha256 !== lock.recordsSha256
      || JSON.stringify(result.inputs) !== JSON.stringify(lock.inputs)) {
      // A new commit is pinned by reviewing this candidate, never by rewriting the lock automatically.
      const lockCandidate = 'artifacts/generator/docs-snapshot.lock.candidate.json';
      writeFileSync(join(root, lockCandidate), JSON.stringify(
        {
          ...lock,
          sha256: archiveSha256,
          snapshotSha256: result.snapshotSha256,
          recordsSha256: result.recordsSha256,
          entries: result.entries,
          trees: result.trees,
          inputs: result.inputs,
          tplEnv: result.tplEnv,
        },
        null,
        2
      ) + '\n');
      throw new Error(`Documentation ${pinned ? 'build' : 'candidate'} mismatch with ${docsLockPath}; review ${lockCandidate}`);
    }

    console.log(JSON.stringify({ commit: lock.commit, entries: result.entries, snapshotSha256: result.snapshotSha256 }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function loadDocumentationLock() {
  const lock = JSON.parse(readFileSync(docsLockPath, 'utf8'));
  for (const [path, expected] of [
    [`${output}/snapshot.json`, lock.snapshotSha256],
    [`${output}/records.jsonl`, lock.recordsSha256],
    ['artifacts/generator/upstream/echarts-doc.tgz', lock.sha256],
    ...lock.trees.map((t: { path: string; sha256: string }) => [`${output}/${t.path}`, t.sha256]),
  ]) {
    if (hash(readFileSync(path)) !== expected)
      throw new Error(`${path}: documentation integrity mismatch; run docs:acquire`);
  }

  return { lock, snapshotPath: `${output}/snapshot.json` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await acquireDocumentation({ offline: process.argv.includes('--offline'), candidate: process.argv.includes('--candidate') });
}
