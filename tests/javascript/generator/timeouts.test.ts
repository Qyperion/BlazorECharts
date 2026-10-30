import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

// vitest.config.ts gives generator tests and hooks 120 s; a shorter local timeout fails a slower machine for no reason.
it('GeneratorTests_LocalTimeoutsAreNotShorterThanTheProjectTimeout', () => {
  // Arrange
  const dir = 'tests/javascript/generator';

  // Act
  const short = readdirSync(dir).filter(file => file.endsWith('.ts')).flatMap(file => readFileSync(`${dir}/${file}`, 'utf8')
    .split('\n')
    .flatMap(
      (line, i) => [...line.matchAll(/\}\s*,\s*(\d[\d_]*)\s*\)/g)].map(m => ({ at: `${file}:${i + 1}`, ms: Number(m[1].replaceAll('_', '')) }))
    )
    .filter(t => t.ms < 120_000)
    .map(t => `${t.at} ${t.ms}`));

  // Assert
  expect(short).toEqual([]);
});
