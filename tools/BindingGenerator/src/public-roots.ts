import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { PublicRoot } from './schema.ts';

const slash = (path: string) => path.replaceAll('\\', '/');

const declarationPath = (path: string): string | undefined => {
  const candidates = /\.d\.[cm]?ts$/.test(path)
    ? [path]
    : [path.replace(/\.mjs$/, '.d.mts').replace(/\.cjs$/, '.d.cts').replace(/\.js$/, '.d.ts'), `${path}.d.ts`];
  return candidates.find(p => /\.d\.[cm]?ts$/.test(p) && existsSync(p));
};

/** Explicit export facades are roots. Wildcard implementation projections are inventoried separately. */
export function discoverPublicRoots(packageDir: string): PublicRoot[] {
  const metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const roots: PublicRoot[] = [];
  const add = (exportPath: string, target: string, conditions: string[]) => {
    const absolute = resolve(packageDir, target);
    if (!absolute.startsWith(resolve(packageDir) + '\\') && !absolute.startsWith(resolve(packageDir) + '/'))
      throw new Error(`Export escapes package: ${target}`);

    const declaration = declarationPath(absolute);
    const internal = declaration && /(?:^|\/)types\/(?:src\/|dist\/shared\.d\.ts$)/.test(slash(relative(packageDir, declaration)));
    roots.push({
      package: metadata.name,
      exportPath,
      conditions,
      target,
      ...(declaration ? { declaration: slash(relative(packageDir, declaration)) } : {}),
      status: internal ? 'internal-projection' : declaration ? 'declaration' : 'declaration-gap',
      ...(internal ? { reason: 'Implementation declaration projection, not a consumer facade; reachable contracts are traversed from public exports. See package.README.md TypeScript entries.' }
        : !declaration ? { reason: 'Published export has no adjacent or explicit declaration. Requires source/docs reconciliation.' } : {}),
    });
  };
  const walk = (exportPath: string, entry: unknown, conditions: string[] = []) => {
    if (typeof entry === 'string') {
      if (entry.includes('*')) {
        let matched = false;

        // Every declaration matched by the catch-all is accounted for, without treating all exported internals as public roots.
        for (const file of readdirSync(packageDir, { recursive: true }).map(String).map(slash).sort()) {
          if (!/\.d\.[cm]?ts$/.test(file))
            continue;

          const [prefix, suffix] = entry.replace(/^\.\//, '').split('*');
          if (file.startsWith(prefix) && file.endsWith(suffix)) {
            matched = true;
            const capture = file.slice(prefix.length, suffix ? -suffix.length : undefined);
            add(exportPath.replace('*', capture), './' + file, [...conditions, `pattern:${exportPath}`]);
          }
        }

        if (!matched)
          add(exportPath, entry, conditions);
      } else
        add(exportPath, entry, conditions);
    } else if (Array.isArray(entry))
      entry.forEach((item, i) => walk(exportPath, item, [...conditions, `fallback:${i}`]));
    else if (entry && typeof entry === 'object') {
      // An explicit types branch supplies declarations for the runtime branches too.
      // Treating a JS require target without a sibling .d.cts as an omission here is incorrect.
      if ('types' in entry)
        walk(exportPath, entry.types, [...conditions, 'types']);
      else
        for (const [condition, target] of Object.entries(entry))
          walk(exportPath, target, [...conditions, condition]);
    }
  };
  if (metadata.exports) {
    if (Object.keys(metadata.exports).some(k => k.startsWith('.')))
      for (const [path, entry] of Object.entries(metadata.exports))
        walk(path, entry);
    else
      walk('.', metadata.exports);
  } else if (metadata.types || metadata.typings)
    add('.', metadata.types ?? metadata.typings, ['types']);
  else if (existsSync(join(packageDir, 'index.d.ts')))
    add('.', './index.d.ts', ['implicit-index']);

  if (metadata.types)
    add('.', metadata.types, ['legacy-types']);

  return roots;
}
