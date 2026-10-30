import { readdir, rename, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** A location of generated files: a whole directory tree, or the files of one directory that `owns` accepts. */
export interface OutputScope {
  dir: string;
  recursive?: boolean;
  owns?: (name: string) => boolean;
}

export type StaleAction = { path: string; remove: true } | { path: string; rename: string };

/**
 * What to do with listed files that the generation does not produce. A file that differs from a generated one only in case
 * is renamed, unless the generated file is listed beside it (a case-sensitive file system); then the old file goes.
 */
export function staleActions(listing: string[], expected: Iterable<string>): StaleAction[] {
  const exact = new Set(expected);
  const byCase = new Map([...exact].map(path => [path.toLowerCase(), path]));
  const listed = new Set(listing);
  return listing.filter(path => !exact.has(path)).map(path => {
    const wanted = byCase.get(path.toLowerCase());
    return wanted && !listed.has(wanted) ? { path, rename: wanted } : { path, remove: true };
  });
}

/** Check mode fails on a stale file or a case-only rename; write mode removes or renames it. */
export async function removeStaleFiles(expected: Iterable<string>, root: string, scopes: OutputScope[], check: boolean): Promise<void> {
  const listing: string[] = [];
  for (const scope of scopes) {
    let entries;
    try {
      entries = await readdir(join(root, scope.dir), { recursive: scope.recursive ?? false, withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        continue;

      throw e;
    }

    for (const entry of entries)
      if (entry.isFile() && (!scope.owns || scope.owns(entry.name)))
        listing.push(relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
  }

  for (const action of staleActions([...new Set(listing)].sort(), expected)) {
    if (check)
      throw new Error('rename' in action ? `Generated file name differs in case: ${action.path}` : `Stale generated file: ${action.path}`);

    const path = join(root, action.path);
    if ('rename' in action) {
      await rename(path, path + '.rename');
      await rename(path + '.rename', join(root, action.rename));
    } else
      await rm(path);
  }
}
