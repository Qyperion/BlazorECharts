import { expect, test } from 'vitest';
import { join, resolve } from 'node:path';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileLimitBytes, readShardedJson, shardJson, writeShardedJson } from '../../../tools/BindingGenerator/src/sharded-json.ts';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';
import { loadSchema, schemaPath, serializeSchema, serializeSchemaShards, writeSchema } from '../../../tools/BindingGenerator/src/schema.ts';
import { loadManifest, manifestPath } from '../../../tools/BindingGenerator/src/generation-model.ts';

const scratch = (name: string) => mkdtempSync(resolve('artifacts/generator', `${name}-`));

const value = () => ({
  formatVersion: 1,
  items: Array.from({ length: 50 }, (_, i) => ({ id: `item:${String(i).padStart(2, '0')}`, text: 'x'.repeat(40) })),
  small: [{ id: 'a' }],
  empty: [] as unknown[],
  tail: 'end',
});

test('ShardedJson_LargeArrays_SplitInOrderAndRoundTrip', () => {
  // Arrange
  const files = shardJson(value(), ['items', 'empty'], 1024);

  // Act
  const index = JSON.parse(files.get('index.json')!);

  // Assert
  expect(Object.keys(index)).toEqual(['formatVersion', 'items', 'small', 'empty', 'tail']);
  expect(index.items.shards.length).toBeGreaterThan(2);
  expect(index.items.shards.reduce((n: number, s: { items: number }) => n + s.items, 0)).toBe(50);
  expect(index.empty).toEqual({ shards: [] });
  for (const [file, content] of files)
    if (file !== 'index.json')
      expect(Buffer.byteLength(content), file).toBeLessThanOrEqual(1024 + 64);

  // Act
  const dir = scratch('sharded');
  try {
    writeShardedJson(dir, files);
    const read = readShardedJson(dir);

    // Assert
    expect(JSON.stringify(read)).toBe(JSON.stringify(value()));
    expect(shardJson(read as object, ['items', 'empty'], 1024)).toEqual(files);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ShardedJson_ItemOverFileLimit_Fails', () => {
  // Arrange
  const huge = { items: [{ text: 'x'.repeat(fileLimitBytes) }] };

  // Act & Assert
  expect(() => shardJson(huge, ['items'])).toThrow(/FILE_TOO_LARGE items\.1\.json/);
});

test('ShardedJson_MissingTruncatedOrEscapingShard_Fails', () => {
  // Arrange
  const dir = scratch('sharded-broken');
  try {
    const files = shardJson(value(), ['items'], 1024);
    writeShardedJson(dir, files);
    writeFileSync(join(dir, 'items.2.json'), '[\n  {"id":"item:99"}\n]\n');

    // Act & Assert
    expect(() => readShardedJson(dir)).toThrow(/SHARD_MISMATCH .*items\.2\.json/);

    // Arrange
    rmSync(join(dir, 'items.2.json'));

    // Act & Assert
    expect(() => readShardedJson(dir)).toThrow(/items\.2\.json/);

    // Arrange
    const index = JSON.parse(files.get('index.json')!);
    index.items.shards[0].file = '../outside.json';
    writeFileSync(join(dir, 'index.json'), JSON.stringify(index));

    // Act & Assert
    expect(() => readShardedJson(dir)).toThrow(/INVALID_SHARD_NAME \.\.\/outside\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ShardedJson_Rewrite_RemovesStaleShards', () => {
  // Arrange
  const dir = scratch('sharded-stale');
  try {
    writeShardedJson(dir, shardJson(value(), ['items'], 1024));
    const fewer = shardJson(value(), ['items'], 4096);

    // Act
    writeShardedJson(dir, fewer);

    // Assert
    expect(readdirSync(dir).sort()).toEqual([...fewer.keys()].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Schema_SingleFileAndShards_LoadTheSameSchema', () => {
  // Arrange
  const schema = extractDeclarations([resolve('tests/javascript/generator/fixtures/public-contracts.d.ts')]);
  const dir = scratch('schema-shards');
  try {
    writeFileSync(join(dir, 'old.api.json'), serializeSchema(structuredClone(schema)));

    // Act
    writeSchema(structuredClone(schema), join(dir, 'new.api'));

    // Assert
    expect(JSON.stringify(loadSchema(join(dir, 'new.api')))).toBe(JSON.stringify(loadSchema(join(dir, 'old.api.json'))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CommittedSchemaAndManifest_AreShardsUnderGitHubLimit', () => {
  // Act & Assert
  for (const dir of [schemaPath, manifestPath]) {
    expect(statSync(dir).isDirectory(), dir).toBe(true);
    for (const file of readdirSync(dir))
      expect(statSync(join(dir, file)).size, `${dir}/${file}`).toBeLessThanOrEqual(fileLimitBytes);
  }

  // Act
  const files = serializeSchemaShards(loadSchema());

  // Assert
  expect([...files.keys()].sort()).toEqual(readdirSync(schemaPath).sort());
  for (const [file, content] of files)
    expect(readFileSync(join(schemaPath, file), 'utf8') === content, `${schemaPath}/${file}`).toBe(true);

  expect(loadManifest().entries.length).toBeGreaterThan(0);
});
