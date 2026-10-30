import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractContract } from './extract.ts';
import { loadSchema, schemaPath, validateSchema, writeSchema } from './schema.ts';
import { reconcileDocumentation, compareApi, preserveApiChanges } from './reconcile-docs.ts';
import { inventoryPublicApi } from './inventory-public-api.ts';
import { inventoryPinnedRuntime } from './runtime-inventory.ts';
import { loadDocumentationLock } from './docs-snapshot.ts';
import { validateOverrides, createSignatureHasher } from './validate-overrides.ts';
import { generate, writeGeneration } from './emit-csharp.ts';
import { validateCoverage, validateScopedCoverage, validateManualMappings, publicContractDiff, verifyManifestFiles } from './coverage.ts';
import { generatedJson, loadManifest } from './generation-model.ts';
import { generateWordCloud, writeWordCloudGeneration } from './wordcloud.ts';
import { manualCoverageMappings } from './validate-mappings.ts';
import { evidencePath } from './evidence.ts';
import { diffApi } from './api-diff.ts';
import { compareScopeCategories } from './scope-categories.ts';

await mkdir('artifacts/generator', { recursive: true });
const categoriesPath = 'docs/api-coverage/scope-categories-6.1.0.json';
const originIndexPath = 'docs/api-coverage/scope-origin-index-6.1.0.json';
const command = process.argv[2] ?? 'extract';

if (command === 'check') {
  try {
    const schema = loadSchema();
    try {
      validateSchema(schema);
    } catch (error) {
      throw new Error(`INVALID_SOURCE_SCHEMA ${error}`);
    }

    const overrides = JSON.parse(await readFile('schemas/overrides/echarts-6.1.0.json', 'utf8'));

    // generate validates signature-pinned overrides; it does not write or bless the baseline.
    const expected = generate(schema, overrides);
    const manifest = loadManifest();
    const mappings = manualCoverageMappings(overrides);
    const manual = validateManualMappings(schema, mappings);
    const committed = (path: string) => readFile(path, 'utf8').catch(() => undefined);
    const report = validateScopedCoverage({
      schema,
      manifest,
      expected: expected.manifest,
      scope: expected.scope!,
      manual: manual.ids,
      committedCategories: await committed(categoriesPath),
      expectedCategories: expected.files.get(categoriesPath)!,
    });
    report.errors.push(...manual.errors, ...(expected.emissionErrors ?? []));
    for (const path of new Set(mappings.flatMap(m => [...m.implementation, ...m.tests.map(evidencePath)]))) {
      try {
        await readFile(path);
      } catch {
        report.errors.push(`MISSING_MANUAL_REFERENCE ${path}`);
      }
    }

    if (await committed(originIndexPath) !== expected.files.get(originIndexPath))
      report.errors.push(`SCOPE_ORIGIN_INDEX_DRIFT ${originIndexPath}`);

    try {
      await verifyManifestFiles(manifest, process.cwd());
    } catch (error) {
      report.errors.push(`REFERENCE_VERIFICATION_FAILED ${error}`);
    }

    const wordCloud = await generateWordCloud();
    for (const [path, content] of wordCloud.files) {
      try {
        if (await readFile(path, 'utf8') !== content)
          report.errors.push(`WORDCLOUD_CONTRACT_DRIFT ${path}`);
      } catch {
        report.errors.push(`MISSING_WORDCLOUD_CONTRACT ${path}`);
      }
    }

    for (const id of wordCloud.inventory.unresolved)
      report.errors.push(`UNRESOLVED_SCOPE_RECORD S4 ${id}`);

    const publicApi = await readFile('schemas/generated/public-api.txt', 'utf8');
    const expectedApi = expected.files.get('schemas/generated/public-api.txt')!;
    if (publicApi !== expectedApi)
      report.errors.push('PUBLIC_API_BASELINE_DRIFT schemas/generated/public-api.txt');

    const s4 = { total: wordCloud.inventory.records.length, unresolved: wordCloud.inventory.unresolved.length };
    const records = [...expected.scope!.assignments].map(([id, a]) => ({ id, set: a.set, rule: a.rule }));
    await mkdir('artifacts/api-coverage', { recursive: true });
    await writeFile('artifacts/api-coverage/strict-report.json', generatedJson({
      formatVersion: 1,
      inputValid: report.inputValid,
      summary: { ...report.summary, s4 },
      errors: report.errors,
      unresolved: report.unresolved,
      residual: report.residual,
      loose: report.loose,
      drift: report.drift,
      records,
    }));
    await writeFile('artifacts/api-coverage/public-contract-diff.json', generatedJson({
      formatVersion: 1,
      diagnostics: publicContractDiff(manifest, expected.manifest),
      publicApiChanged: publicApi !== expectedApi,
    }));
    const summary = report.summary!;
    console.log(JSON.stringify({
      s: summary.s,
      s4,
      k: summary.k,
      bonus: summary.bonus,
      residual: summary.residual,
      sets: Object.fromEntries(Object.entries(summary.sets)
        .filter(([, v]) => v.total)
        .map(([k, v]) => [k, v.total + (v.unresolved && k.startsWith('S') ? ` (${v.unresolved} unresolved)` : '')])),
      errors: report.errors.length,
      report: 'artifacts/api-coverage/strict-report.json',
      diff: 'artifacts/api-coverage/public-contract-diff.json',
    }));
    if (report.errors.length) {
      console.error(report.errors.slice(0, 40).join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    // Invalid inputs must replace previous reports too: stale success artifacts
    // are not evidence of the attempted audit.
    const errors = [String(error)];
    await mkdir('artifacts/api-coverage', { recursive: true });
    await writeFile('artifacts/api-coverage/strict-report.json', generatedJson({ formatVersion: 1, inputValid: false, errors }));
    await writeFile(
      'artifacts/api-coverage/public-contract-diff.json',
      generatedJson({ formatVersion: 1, comparisonPerformed: false, diagnostics: errors })
    );
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
} else if (['generate', 'generate-check'].includes(command)) {
  const schema = loadSchema();
  const result = generate(schema, JSON.parse(await readFile('schemas/overrides/echarts-6.1.0.json', 'utf8')));
  const report = validateCoverage(schema, result.manifest);
  report.errors.push(...(result.emissionErrors ?? []));
  if (report.errors.length)
    throw new Error(report.errors.join('\n'));

  if (command === 'generate' && !process.argv.includes('--accept-scope')) {
    // A changed K or S membership is a decision: it is written only after a review, never as a side effect.
    const drift = compareScopeCategories(await readFile(categoriesPath, 'utf8').catch(() => undefined), result.files.get(categoriesPath)!)
      .filter(error => !error.endsWith('summary or format changed'));
    if (drift.length)
      throw new Error(
        `The scope membership in ${categoriesPath} would change; nothing was written. Review it and run npm run generate -- --accept-scope.\n`
        + drift.slice(0, 40).join('\n') + (drift.length > 40 ? `\n... and ${drift.length - 40} more` : '')
      );
  }

  result.files.set('schemas/generated/mapping-diagnostics.json', JSON.stringify(result.diagnostics, null, 2) + '\n');
  await writeGeneration(result, process.cwd(), command === 'generate-check');
  await writeWordCloudGeneration((await generateWordCloud()).files, process.cwd(), command === 'generate-check');
  for (const warning of result.warnings ?? [])
    console.warn(warning);

  console.log(JSON.stringify({
    files: result.files.size,
    entries: result.manifest.entries.length,
    diagnostics: result.diagnostics.length,
    scope: result.manifest.scopeCategories,
  }));
} else if (command === 'diff') {
  const option = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const [beforePath, afterPath, output] = ['before', 'after', 'output'].map(option);
  const overridesPath = option('overrides') ?? 'schemas/overrides/echarts-6.1.0.json';
  if (!beforePath || !afterPath || !output) {
    console.error('Usage: npm run api:diff -- --before <schema.api directory or .api.json> --after <schema.api directory or .api.json> --output <report.json> [--overrides <overrides.json>]');
    process.exitCode = 1;
  } else {
    const load = (path: string) => {
      const s = loadSchema(path);
      validateSchema(s);
      return s;
    };
    const report = diffApi(load(beforePath), load(afterPath), JSON.parse(await readFile(overridesPath, 'utf8')));
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, generatedJson(report));
    console.log(JSON.stringify({ report: output, ...report.summary }));
    const rejected = report.entries.filter(e => e.resolution === 'rejected');
    if (rejected.length) {
      console.error(rejected.slice(0, 40).map(e => `${e.code} ${e.recordId} ${e.detail}`).join('\n'));
      process.exitCode = 1;
    }
  }
} else if (command === 'signature') {
  const i = process.argv.indexOf('--schema');
  const schema = loadSchema(i > 0 ? process.argv[i + 1] : schemaPath);
  const ids = process.argv.slice(3).filter((_, n, all) => all[n] !== '--schema' && all[n - 1] !== '--schema');
  const records = new Map(schema.records.map(r => [r.id, r]));
  const hash = createSignatureHasher(schema);
  const missing = ids.filter(id => !records.has(id));
  if (!ids.length || missing.length) {
    console.error(ids.length
      ? missing.map(id => `UNKNOWN_RECORD ${id}`).join('\n')
      : 'Usage: node tools/BindingGenerator/src/cli.ts signature [--schema <schema.api directory or .api.json>] <recordId>...');
    process.exitCode = 1;
  } else
    console.log(JSON.stringify(ids.map(id => ({ recordId: id, signature: hash(records.get(id)!) }))));
} else if (command === 'validate-overrides') {
  const schema = loadSchema();
  validateOverrides(schema, JSON.parse(await readFile(process.argv[3] ?? 'schemas/overrides/echarts-6.1.0.json', 'utf8')));
  console.log('All overrides have current signatures and verified provenance.');
} else if (command === 'extract') {
  const { lock, snapshotPath } = loadDocumentationLock();
  const schema = await extractContract(resolve('schemas/upstream/sources.lock.json'));
  const beforeCounts = {
    records: schema.records.length,
    types: schema.types.length,
    series: schema.series.length,
    overloads: schema.types.reduce((n, t) => n + (t.signatures?.length ?? 0), 0),
  };
  schema.sources.push({
    name: 'echarts-doc',
    version: lock.commit,
    sha256: lock.sha256,
    integrityKind: 'archive',
    url: lock.url,
    upstreamCommit: lock.commit,
    files: [...lock.inputs, { path: 'normalized/records.jsonl', sha256: lock.recordsSha256 }],
  });
  const reconciliation = reconcileDocumentation(schema, snapshotPath);
  inventoryPublicApi(schema);
  const runtime = inventoryPinnedRuntime(schema, resolve('schemas/upstream/sources.lock.json'));
  const previous = loadSchema();
  const changes = compareApi(previous, schema);
  preserveApiChanges(previous, schema);

  // First extraction of an upgrade: report stale overrides instead of failing, so the schema can be diffed and re-pinned.
  const stale: string[] = [];
  validateOverrides(
    schema,
    JSON.parse(await readFile('schemas/overrides/echarts-6.1.0.json', 'utf8')),
    true,
    process.argv.includes('--allow-stale-overrides') ? message => stale.push(message) : undefined
  );
  await writeFile('artifacts/generator/stale-overrides.json', JSON.stringify(stale, null, 2) + '\n');
  await writeFile('artifacts/generator/api-changes.json', JSON.stringify(changes, null, 2) + '\n');
  await writeFile(
    'artifacts/generator/reconciliation.json',
    JSON.stringify({ beforeCounts, docsCommit: lock.commit, versionAlignment: lock.versionAlignment, ...reconciliation, runtime }, null, 2) + '\n'
  );
  await writeFile(
    'artifacts/generator/diagnostics.json',
    JSON.stringify({ provenance: schema.provenance, diagnostics: schema.diagnostics }, null, 2) + '\n'
  );
  writeSchema(schema);
  console.log(JSON.stringify(
    {
      beforeCounts,
      records: schema.records.length,
      types: schema.types.length,
      series: schema.series.length,
      docs: { matched: reconciliation.matched.length, conflicting: reconciliation.conflicting.length, docsOnly: reconciliation.docsOnly.length },
      runtimeRegistrations: runtime.registrations.length,
      dynamicRegistrationSites: runtime.dynamicSites.length,
      changes: changes.length,
      staleOverrides: stale.length,
    },
    null,
    2
  ));
  if (stale.length)
    console.error(`${stale.length} stale overrides skipped; see artifacts/generator/stale-overrides.json. Re-pin them and extract again without --allow-stale-overrides.`);
} else
  throw new Error(`Unknown generator command: ${command}`);
