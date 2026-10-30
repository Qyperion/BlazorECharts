import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractDeclarations } from '../../../tools/BindingGenerator/src/extract.ts';
import { validateSchema } from '../../../tools/BindingGenerator/src/schema.ts';

let schema: ReturnType<typeof extractDeclarations>;
const fixture = resolve('tests/javascript/generator/fixtures/public-contracts.d.ts');
const expected = JSON.parse(readFileSync(fixture.replace('.d.ts', '.expected.json'), 'utf8'));

beforeAll(() => { schema = extractDeclarations([fixture, resolve('tests/javascript/generator/fixtures/recursive-contracts.d.ts')]); });

function node(id: string): any {
  return schema.types.find(t => t.id === id)!;
}

function exported(name: string): any {
  return node(schema.records.find(r => r.name === name && r.kind === 'export')!.type!);
}

function property(name: string): any {
  return exported('Options').properties.find((p: any) => p.name === name);
}

function alternatives(id: string): any[] {
  const n = node(id);
  return n.kind === 'union' ? n.alternatives.map(node) : [n];
}

test('Resolve_InheritedGenericIntersection_PreservesEveryMember', () => {
  // Act
  const combined = exported('Combined');

  // Assert
  expect(combined.properties.map((p: any) => p.name)).toEqual(expected.combinedMembers);
  expect(node(combined.properties.find((p: any) => p.name === 'value').type).kind).toBe('string');
  expect(node(combined.properties.find((p: any) => p.name === 'keep').type)).toMatchObject({ kind: 'literal', value: false });
  expect(exported('Resolved').properties.map((p: any) => p.name)).toEqual(['text']);
  expect(node(exported('Resolved').properties[0].type)).toMatchObject({ kind: 'literal', value: 'hello' });
  expect(exported('Indexed').kind).toBe('string');
});

test('Resolve_LiteralFalseAndNumericUnion_PreservesAlternatives', () => {
  // Act & Assert
  expect(alternatives(property('step').type).filter(t => t.kind === 'literal').map(t => t.value).sort()).toEqual(expected.stepLiterals);
  expect(alternatives(property('numeric').type).map(t => t.value).sort()).toEqual(expected.numericLiterals);
});

test('Resolve_OptionalNullUndefined_KeepDistinctPresence', () => {
  // Act & Assert
  expect(property('optional').optional).toBe(true);
  expect(node(property('optional').type).kind).toBe('string');
  expect(property('explicit').optional).toBe(false);
  expect(alternatives(property('explicit').type).map(t => t.kind).sort()).toEqual(['null', 'string', 'undefined']);
  expect(alternatives(property('optionalNullable').type).map(t => t.kind).sort()).toEqual(['null', 'string']);
  expect(alternatives(property('optionalExplicit').type).map(t => t.kind).sort()).toEqual(['string', 'undefined']);
});

test('Resolve_FixedTupleAndOneOrMany_PreserveShape', () => {
  // Act
  const tuple = node(property('tuple').type);

  // Assert
  expect(tuple).toMatchObject({ kind: 'tuple', readonly: true, minLength: 2, fixedLength: 3 });
  expect(tuple.elements.map((e: any) => e.label)).toEqual(expected.tupleLabels);
  expect(tuple.elements[2].optional).toBe(true);
  expect(node(property('variadic').type).elements[1].rest).toBe(true);
  expect(alternatives(property('oneOrMany').type).map(t => t.kind).sort()).toEqual(['array', 'object']);

  // Act
  const dictionary = node(property('dictionary').type).indexes[0];

  // Assert
  expect(dictionary.readonly).toBe(true);
  expect(node(dictionary.key).kind).toBe('string');

  // Act
  const callback = node(property('callback').type).signatures[0];

  // Assert
  expect(callback.typeParameters).toHaveLength(1);
  expect(callback.parameters[1].rest).toBe(true);
});

test('Resolve_RecursiveGraph_UsesStableReferences', () => {
  // Act & Assert
  expect(() => validateSchema(schema)).not.toThrow();

  // Act
  const instance = exported('StringTree');

  // Assert
  expect(instance.kind).toBe('generic-reference');
  expect(node(instance.typeArguments[0]).kind).toBe('string');

  // Act
  const tree = node(instance.target);

  // Assert
  expect(tree.properties.find((p: any) => p.name === 'parent').type).toBe(tree.id);

  // Act
  const children = node(tree.properties.find((p: any) => p.name === 'children').type);

  // Assert
  expect(children.element).toBe(tree.id);
  expect(schema.types.length).toBeLessThan(150);
});

test('Resolve_ExpandingGenericRecursion_RemainsSymbolic', () => {
  // Arrange
  const schema = extractDeclarations([resolve('tests/javascript/generator/fixtures/recursive-contracts.d.ts')]);

  // Act
  validateSchema(schema);

  // Assert
  expect(schema.types.some(t => t.kind === 'generic-reference')).toBe(true);
  expect(schema.types.length).toBeLessThan(80);
});

test('Resolve_MappedReadonly_PreservesModifiers', () => {
  // Act & Assert
  expect(exported('ReadonlyMapped').properties[0].readonly).toBe(true);
  expect(exported('WritableMapped').properties[0].readonly).toBe(false);
});

test('Resolve_OpenArraysTuplesAndOverloadScopes_KeepContracts', () => {
  // Act
  const props = exported('GenericShapes').properties;

  // Assert
  expect(node(props.find((p: any) => p.name === 'array').type).kind).toBe('array');
  expect(node(props.find((p: any) => p.name === 'tuple').type)).toMatchObject({ kind: 'tuple', minLength: 1 });

  // Act
  const signatures = exported('scoped').signatures;

  // Assert
  expect(signatures[0].typeParameters[0].type).not.toBe(signatures[1].typeParameters[0].type);
  expect(node(signatures[0].typeParameters[0].constraint).kind).toBe('string');
  expect(node(signatures[1].typeParameters[0].constraint).kind).toBe('number');
});
