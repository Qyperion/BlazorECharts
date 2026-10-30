import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TypeNode } from '../../../tools/BindingGenerator/src/schema.ts';
import { manyArray } from '../../../tools/BindingGenerator/src/emit-csharp.ts';

const sources = 'tools/BindingGenerator/src';

/** The arguments of each call of `name(` in the text, split at top-level commas. */
function calls(text: string, name: string): string[][] {
  const result: string[][] = [];
  for (let at = text.indexOf(name + '('); at >= 0; at = text.indexOf(name + '(', at + 1)) {
    const args: string[] = [];
    let depth = 0;
    let start = at + name.length + 1;
    let quote = '';
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === '\\')
          i++;
        else if (c === quote)
          quote = '';

        continue;
      }

      if (c === '\'' || c === '"' || c === '`')
        quote = c;
      else if ('([{'.includes(c))
        depth++;
      else if (')]}'.includes(c) && depth > 0)
        depth--;
      else if (c === ',' && depth === 0) {
        args.push(text.slice(start, i).trim());
        start = i + 1;
      } else if (c === ')') {
        args.push(text.slice(start, i).trim());
        break;
      }
    }

    result.push(args.filter(Boolean));
  }

  return result;
}

describe('determinism', () => {
  it('Generator_LocaleSensitiveCalls_NameTheirLocale', () => {
    // A call without locale follows the ICU locale of the machine (lt sorts y with i), so the output would too.

    // Arrange
    const offenders: string[] = [];

    // Act
    for (const file of readdirSync(sources).filter(f => f.endsWith('.ts'))) {
      const text = readFileSync(join(sources, file), 'utf8');
      for (const args of calls(text, '.localeCompare'))
        if (args.length < 2)
          offenders.push(`${file}: localeCompare(${args.join(', ')})`);

      for (const name of ['.toLocaleLowerCase', '.toLocaleUpperCase', 'Intl.Collator', '.toLocaleString'])
        for (const args of calls(text, name))
          if (!args.length)
            offenders.push(`${file}: ${name}()`);
    }

    // Assert
    expect(offenders).toEqual([]);
  });

  it('Generator_OneOrMany_DoesNotDependOnTheOrderOfArrayAlternatives', () => {
    // Value | Value[] next to a second array (Value[][]); the many array is found in either order.

    // Arrange
    const node = (id: string, kind: string, extra: Partial<TypeNode> = {}): TypeNode => ({ id, kind, display: id, provenance: [], ...extra });
    const types = new Map([
      node('number', 'number'),
      node('string', 'string'),
      node('value', 'union', { alternatives: ['number', 'string'] }),
      node('values', 'array', { element: 'value' }),
      node('rows', 'array', { element: 'values' }),
    ].map(t => [t.id, t] as [string, TypeNode]));

    // Act & Assert
    expect(manyArray(['values', 'rows'], types)).toBe('rows');
    expect(manyArray(['rows', 'values'], types)).toBe('rows');
    expect(manyArray(['number', 'string', 'values'], types)).toBe('values');
    expect(manyArray(['values', 'number', 'string'], types)).toBe('values');
    expect(manyArray(['values', 'number'], types)).toBeUndefined();
  });
});
