import { afterAll, describe, expect, it } from 'vitest';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const categories = 'docs/api-coverage/scope-categories-6.1.0.json';
const links: string[] = [];
const roots: string[] = [];

/**
 * A workspace that sees the repository through directory junctions, except the copied paths, which a
 * test may change. Nothing of the repository is copied or changed otherwise.
 */
function workspace(copies: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'api-check-'));
  roots.push(root);
  const mirror = (relative: string) => {
    for (const entry of readdirSync(join(repo, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (path === '.git' || path === 'artifacts/api-coverage')
        continue;

      const source = join(repo, path);
      const target = join(root, path);
      if (copies.includes(path))
        cpSync(source, target, { recursive: true });
      else if (copies.some(c => c.startsWith(path + '/')) || (relative === '' && path === 'artifacts')) {
        mkdirSync(target, { recursive: true });
        mirror(path);
      } else if (entry.isDirectory()) {
        symlinkSync(source, target, 'junction');
        links.push(target);
      } else
        copyFileSync(source, target);
    }
  };
  mirror('');
  return root;
}

// The CLI runs from the workspace's own path, so the compiler and pinned sources resolve inside it.
const run = (root: string, ...args: string[]) => spawnSync(
  process.execPath,
  ['--preserve-symlinks', '--preserve-symlinks-main', join(root, 'tools/BindingGenerator/src/cli.ts'), ...args],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);

/** Moves the first record of the committed scope categories to another set. */
function moveFirstRecord(root: string): string {
  const path = join(root, categories);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const record = json.records[0];
  record[0] = record[0] === 'K1' ? 'K2' : 'K1';
  writeFileSync(path, JSON.stringify(json));
  return record[1];
}

afterAll(() => {
  // Junctions are removed as links first, so no cleanup can reach the repository behind them.
  for (const link of links)
    unlinkSync(link);

  for (const root of roots)
    rmSync(root, { recursive: true, force: true });
});

describe('generator CLI exit codes', () => {
  it(
    'ApiCheck_BaselineAndScopeDrift_ExitsNonZeroWithCodes',
    () => {
      const root = workspace(['docs/api-coverage', 'schemas/generated/public-api.txt']);
      writeFileSync(
        join(root, 'schemas/generated/public-api.txt'),
        readFileSync(join(root, 'schemas/generated/public-api.txt'), 'utf8') + 'Unreviewed member\n'
      );
      const moved = moveFirstRecord(root);
      const origin = join(root, 'docs/api-coverage/scope-origin-index-6.1.0.json');
      writeFileSync(origin, readFileSync(origin, 'utf8') + '\n');
      const result = run(root, 'check');
      expect(result.status, result.stderr).toBe(1);
      for (const code of ['PUBLIC_API_BASELINE_DRIFT', `SCOPE_CATEGORY_DRIFT moved`, 'SCOPE_ORIGIN_INDEX_DRIFT'])
        expect(result.stderr).toContain(code);

      const report = JSON.parse(readFileSync(join(root, 'artifacts/api-coverage/strict-report.json'), 'utf8'));
      expect(report.inputValid).toBe(true);
      expect(report.errors.some((e: string) => e.startsWith('SCOPE_CATEGORY_DRIFT moved') && e.endsWith(moved))).toBe(true);
    },
    300_000
  );

  it(
    'Generate_ScopeMembershipChange_NeedsExplicitAcceptance',
    () => {
      const root = workspace(['docs/api-coverage']);
      moveFirstRecord(root);
      const before = readFileSync(join(root, categories), 'utf8');
      const result = run(root, 'generate');
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('--accept-scope');
      expect(result.stderr).toContain('SCOPE_CATEGORY_DRIFT moved');
      expect(readFileSync(join(root, categories), 'utf8')).toBe(before);
      expect(existsSync(join(root, 'artifacts/api-coverage'))).toBe(false);
    },
    300_000
  );
});
