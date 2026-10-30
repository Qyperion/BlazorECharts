import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** GitHub warns about files over 50 MiB and rejects a push with a file over 100 MiB. */
export const fileLimitBytes = 50 * 1024 * 1024;
const shardBytes = 32 * 1024 * 1024;
export const indexFile = 'index.json';
const shardName = /^[A-Za-z0-9_-]+\.[1-9][0-9]*\.json$/;

interface ShardList {
  shards: { file: string; items: number }[];
}

const isShardList = (value: unknown): value is ShardList => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 1 && Array.isArray((value as ShardList).shards);

const formatIndex = (index: Record<string, unknown>) =>
  '{\n'
  + Object.entries(index).map(([key, value]) => `  ${JSON.stringify(key)}: ` + (Array.isArray(value)
    ? (value.length ? '[\n' + value.map(item => '    ' + JSON.stringify(item)).join(',\n') + '\n  ]' : '[]') : JSON.stringify(value))).join(',\n')
  + '\n}\n';

/**
 * Splits the named top-level arrays into consecutive shards of about `targetBytes`, one item per line.
 * index.json keeps every other member in order and lists each array's shards in its place, so the files
 * of a large inventory stay under the GitHub limit and diffable.
 */
export function shardJson(value: object, keys: readonly string[], targetBytes = shardBytes): Map<string, string> {
  const files = new Map<string, string>();
  const index: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (!keys.includes(key)) {
      index[key] = member;
      continue;
    }

    if (!Array.isArray(member))
      throw new Error(`SHARD_NOT_ARRAY ${key}`);

    const shards: string[][] = [];
    let size = Infinity;
    for (const item of member) {
      const line = JSON.stringify(item);
      const bytes = Buffer.byteLength(line) + 4;
      if (size + bytes > targetBytes) {
        shards.push([]);
        size = 4;
      }

      shards.at(-1)!.push(line);
      size += bytes;
    }

    index[key] = {
      shards: shards.map((lines, i) => {
        const file = `${key}.${i + 1}.json`;
        files.set(file, '[\n' + lines.map(line => '  ' + line).join(',\n') + '\n]\n');
        return { file, items: lines.length };
      }),
    };
  }

  files.set(indexFile, formatIndex(index));
  for (const [file, content] of files) {
    const bytes = Buffer.byteLength(content);
    if (bytes > fileLimitBytes)
      throw new Error(`FILE_TOO_LARGE ${file} has ${bytes} bytes, over ${fileLimitBytes}`);
  }

  return files;
}

/** Reads a directory written by writeShardedJson; each shard must hold the item count its index names. */
export function readShardedJson<T>(directory: string): T {
  const index: Record<string, unknown> = JSON.parse(readFileSync(join(directory, indexFile), 'utf8'));
  for (const [key, member] of Object.entries(index)) {
    if (!isShardList(member))
      continue;

    let items: unknown[] = [];
    for (const { file, items: count } of member.shards) {
      if (!shardName.test(file))
        throw new Error(`INVALID_SHARD_NAME ${file} in ${join(directory, indexFile)}`);

      const part: unknown = JSON.parse(readFileSync(join(directory, file), 'utf8'));
      if (!Array.isArray(part) || part.length !== count)
        throw new Error(
          `SHARD_MISMATCH ${join(directory, file)}: expected ${count} items of ${key}, found ${Array.isArray(part) ? part.length : 'no array'}`
        );

      items = items.concat(part);
    }

    index[key] = items;
  }

  return index as T;
}

/** Writes the files of shardJson and removes shards of an earlier, longer split. */
export function writeShardedJson(directory: string, files: Map<string, string>): void {
  mkdirSync(directory, { recursive: true });
  for (const name of readdirSync(directory))
    if ((name === indexFile || shardName.test(name)) && !files.has(name))
      rmSync(join(directory, name));

  for (const [file, content] of files)
    writeFileSync(join(directory, file), content);
}
