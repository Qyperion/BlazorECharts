import { existsSync, readFileSync } from 'node:fs';

/** A manual mapping's evidence entry is a file, or `file#Name` that names the test in it which exercises the mapping. */
export const evidencePath = (entry: string) => entry.split('#')[0];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The release gate runs these files: the assigned Playwright specs, both .NET test projects and the Vitest projects.
// The stage list is read next to this module, so the generator also runs from another working directory.
const browserRoot = 'tests/browser/';
let gatedSpecs: Set<string> | undefined;

const browserSpecs = () => gatedSpecs ??= new Set(Object.values(
  JSON.parse(readFileSync(new URL('../../Release/browser-stages.json', import.meta.url), 'utf8')).stages as Record<string, string[]>
)
  .flat()
  .map(spec => browserRoot + spec));

const gatedRoots = ['tests/BlazorECharts.Tests/', 'tests/BlazorECharts.ComponentTests/', 'tests/javascript/'];
const gated = (path: string) => path.startsWith(browserRoot) ? browserSpecs().has(path) : gatedRoots.some(root => path.startsWith(root));

/**
 * The declaration of a test called `name`: `test(`/`it(` (or a describe block) whose title starts with it, or a
 * [Fact]/[Theory] method. A template suffix such as `_${mode}` may follow the name; a longer name may not.
 */
function declares(path: string, name: string): boolean {
  const text = readFileSync(path, 'utf8');
  const end = '(?:(?![\\w])|(?=_\\$\\{))';
  if (path.endsWith('.cs')) {
    return new RegExp(`\\[(?:Fact|Theory)\\b[^\\]]*\\](?:\\s*\\[[^\\]]*\\])*\\s*public\\s+(?:async\\s+)?[\\w<>.?]+\\s+${escape(name)}\\s*\\(`).test(
      text
    );
  }

  return new RegExp(`\\b(?:test|it)(?:\\.(?!skip\\b|fixme\\b|fail\\b|fails\\b|todo\\b)\\w+)*\\(\\s*['"\`]${escape(name)}${end}`).test(text);
}

function entryErrors(id: string, entry: string): string[] {
  const [path, name] = entry.split('#');
  if (!existsSync(path))
    return [`${id}: ${path} does not exist`];

  if (name === undefined)
    return [];

  if (!gated(path))
    return [`${id}: ${path} is not run by the release gate`];

  if (!declares(path, name))
    return [`${id}: ${path} declares no test ${name}`];

  return [];
}

/** At least one entry must name a test; every named one must be declared in a file the release gate runs. */
export function evidenceErrors(id: string, entries: string[]): string[] {
  return [
    ...(entries.some(entry => entry.includes('#')) ? [] : [`${id} names no test or probe in its evidence`]),
    ...entries.flatMap(entry => entryErrors(id, entry)),
  ];
}

/** Every entry must name a test that is declared in a file the release gate runs. */
export function namedEvidenceErrors(id: string, entries: string[]): string[] {
  return entries.flatMap(entry => entry.includes('#') ? entryErrors(id, entry) : [`${id}: ${entry} names no test`]);
}
