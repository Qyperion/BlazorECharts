import { readFileSync } from 'node:fs';
import { deserialize } from 'node:v8';
import { inject } from 'vitest';
import type { GenerationResult } from '../../../tools/BindingGenerator/src/generation-model.ts';

let baseline: GenerationResult | undefined;

/** The generation of the committed schema and overrides that global-setup.ts made for this run; each test file reads its own copy. */
export const baselineGeneration = (): GenerationResult => baseline ??= deserialize(readFileSync(inject('generatorBaseline'))) as GenerationResult;
