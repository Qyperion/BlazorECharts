import { existsSync } from 'node:fs';
import type { ApiSchema } from './schema.ts';
import { createSignatureHasher } from './validate-overrides.ts';
import { evidenceErrors } from './evidence.ts';

export interface InstanceMethodMapping {
  recordId: string;
  expectedSignature: string;
  owner: string;
  status: 'implemented' | 'pending';
  symbol: string;
  implementation: string[];
  tests: string[];
  pending: string;
}

/** Source-pinned delivery evidence of the instance methods, separate from the generated option coverage. */
export function createInstanceMethodReport(schema: ApiSchema, mappings: InstanceMethodMapping[] = []) {
  const inventory = schema.records.filter(r => r.inventory?.category.startsWith('instance-'));
  const seen = new Set<string>();
  const signatureHash = createSignatureHasher(schema);
  for (const m of mappings) {
    const record = inventory.find(r => r.id === m.recordId);
    if (!record || signatureHash(record) !== m.expectedSignature || seen.has(m.recordId))
      throw new Error(`Stale instance mapping: ${m.recordId}`);

    seen.add(m.recordId);
    if (m.status === 'implemented' && (!m.symbol || !m.implementation.length || m.implementation.some(p => !existsSync(p))))
      throw new Error(`Missing instance implementation/test evidence: ${m.recordId}`);

    const evidence = m.status === 'implemented' ? evidenceErrors(m.recordId, m.tests) : [];
    if (evidence.length)
      throw new Error(`Missing instance implementation/test evidence: ${evidence.join('; ')}`);
  }

  for (const r of inventory)
    if (!seen.has(r.id))
      throw new Error(`Missing instance owner: ${r.id}`);

  return {
    records: inventory.map(r => ({ ...mappings.find(m => m.recordId === r.id)!, name: r.name, source: r.provenance })),
    note: 'Owners name the delivering capability (lifecycle, updates, events, instance, globals, exports). Export renderer/upstream constraints are documented in docs/export.md.',
  };
}

export function instanceMethodMarkdown(report: ReturnType<typeof createInstanceMethodReport>): string {
  return '# ECharts 6.1.0 instance contracts\n\nGenerated from signature-pinned overrides. '
    + report.note
    + '\n\n| Native member | Owner | Primitive status | CLR contract | Pending | Evidence |\n|---|---|---|---|---|---|\n'
    + report.records
      .map(r => `| ${r.name} | ${r.owner} | ${r.status} | ${r.symbol} | ${r.pending || '—'} | ${[...r.implementation, ...r.tests].join('; ')} |`)
      .join('\n')
    + '\n';
}
