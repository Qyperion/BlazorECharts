import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serialize } from 'node:v8';
import type { TestProject } from 'vitest/node';
import { generate } from '../../../tools/BindingGenerator/src/emit-csharp.ts';
import { loadSchema } from '../../../tools/BindingGenerator/src/schema.ts';

declare module 'vitest' {
  interface ProvidedContext {
    generatorBaseline: string;
  }
}

/**
 * Generates the committed schema and overrides once per run, for both generator projects, and hands the
 * result to the test files as a V8 snapshot. The file belongs to this run only, so it is never stale.
 */
export default function setup(project: TestProject) {
  const directory = resolve('artifacts/generator');
  const path = join(directory, `baseline-generation-${process.pid}.v8`);
  if (!existsSync(path)) {
    mkdirSync(directory, { recursive: true });
    for (const entry of readdirSync(directory))
      if (/^baseline-generation-\d+\.v8(\.tmp)?$/.test(entry))
        rmSync(join(directory, entry), { force: true });

    const result = generate(loadSchema(), JSON.parse(readFileSync('schemas/overrides/echarts-6.1.0.json', 'utf8')));
    writeFileSync(`${path}.tmp`, serialize(result));
    renameSync(`${path}.tmp`, path);
  }

  project.provide('generatorBaseline', path);
}
