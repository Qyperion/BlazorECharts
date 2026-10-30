import { expect, test, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';

let schema: ReturnType<typeof extractDeclarations>;

beforeAll(() => {
  const dir = mkdtempSync(resolve('artifacts/generator/review-'));
  try {
    const entry = join(dir, 'review.d.ts');
    writeFileSync(entry, `
export interface A<T extends string> { values: T[]; optional: T | undefined }
export interface B<T extends number> { values: T[]; optional: T | undefined }
export type Mapped<T> = { [K in keyof T]?: T[K] };
export type C<T, X> = T extends string ? X : number;
export type Applied<T> = C<T, boolean>;
export interface Tuples { implicit: [enabled?: false]; explicit: [enabled?: false | undefined] }
`);
    schema = extractDeclarations([entry]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const node = (id: string) => schema.types.find(t => t.id === id)!;
const exported = (name: string) => node(schema.records.find(r => r.kind === 'export' && r.name === name)!.type);

test('Review_GenericScopes_PreserveNestedArrayAndUnionIdentity', () => {
  // Arrange
  const a = exported('A');
  const b = exported('B');
  const aArray = node(a.properties!.find(p => p.name === 'values')!.type);

  // Act
  const bArray = node(b.properties!.find(p => p.name === 'values')!.type);

  // Assert
  expect(bArray.id).not.toBe(aArray.id);
  expect(node(node(aArray.element!).constraint!).kind).toBe('string');
  expect(node(node(bArray.element!).constraint!).kind).toBe('number');

  // Act
  const aUnion = node(a.properties!.find(p => p.name === 'optional')!.type);
  const bUnion = node(b.properties!.find(p => p.name === 'optional')!.type);

  // Assert
  expect(bUnion.id).not.toBe(aUnion.id);
  expect(bUnion.alternatives).toContain(bArray.element);
  expect(aUnion.alternatives).toContain(aArray.element);
});

test('Review_OpenMapped_IsExplicitlyUnsupportedWithProvenance', () => {
  // Act
  const mapped = exported('Mapped');

  // Assert
  expect(mapped.kind).toBe('unsupported');
  expect(mapped.provenance.length).toBeGreaterThan(0);
  expect(schema.diagnostics.some(d => d.type === mapped.id && d.code === 'UNSUPPORTED_TYPE' && d.message.includes('Open mapped'))).toBe(true);
});

test('Review_InstantiatedConditional_DoesNotPublishUnsubstitutedBranches', () => {
  // Act
  const applied = exported('Applied');

  // Assert
  expect(applied.display).toContain('boolean');
  expect(applied.kind).toBe('unsupported');
  expect(applied.trueType).toBeUndefined();
  expect(applied.provenance.length).toBeGreaterThan(0);
  expect(schema.diagnostics.some(d => d.type === applied.id && d.code === 'UNSUPPORTED_TYPE' && d.message.includes('Instantiated conditional'))).toBe(
    true
  );
});

test('Review_ConcreteExpandingRecursion_RemainsFinite', () => {
  // Arrange
  const dir = mkdtempSync(resolve('artifacts/generator/grow-'));
  try {
    const entry = join(dir, 'grow.d.ts');
    writeFileSync(entry, 'export interface Grow<T> { next: Grow<T[]> }; export type Concrete = Grow<string>;');
    const script = `import {extractDeclarations} from './tools/BindingGenerator/src/extract.ts'; const s=extractDeclarations([process.argv[1]]); console.log(JSON.stringify({ count:s.types.length, refs:s.types.filter(t=>t.kind==='generic-reference').length }));`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, entry], { timeout: 5_000, encoding: 'utf8' });

    // Act
    const result = JSON.parse(output);

    // Assert
    expect(result.count).toBeLessThan(50);
    expect(result.refs).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Review_OptionalTuple_DistinguishesMissingAndExplicitUndefined', () => {
  // Arrange
  const tuples = exported('Tuples');
  const implicit = node(node(tuples.properties!.find(p => p.name === 'implicit')!.type).elements![0].type);

  // Act
  const explicit = node(node(tuples.properties!.find(p => p.name === 'explicit')!.type).elements![0].type);

  // Assert
  expect(implicit).toMatchObject({ kind: 'literal', value: false });
  expect(explicit.kind).toBe('union');
  expect(explicit.alternatives!.map(id => node(id).kind).sort()).toEqual(['literal', 'undefined']);
});
