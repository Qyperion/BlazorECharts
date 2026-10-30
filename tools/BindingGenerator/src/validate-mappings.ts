import { createHash } from 'node:crypto';
import type { ApiSchema } from './schema.ts';
import type { MappingOverrides } from './validate-overrides.ts';
import { validateOverrides } from './validate-overrides.ts';
import { componentTypes } from './component-types.ts';
import type { ManualCoverageMapping } from './coverage.ts';
import { variantDefaultCases } from './generation-model.ts';
import { scanTriggers } from './runtime-inventory.ts';
import { upstreamSourceReader, type SourceReader } from './scope-categories.ts';

/** Only delivered managed members are promoted. Native/custom declarations need
 * their own contract audit, rather than inheriting a blanket bridge status. */
export function manualCoverageMappings(overrides: MappingOverrides): ManualCoverageMapping[] {
  return [
    ...(overrides.instanceMethods ?? []).filter(m => m.status === 'implemented').map(m => ({
      sourceId: m.recordId,
      expectedSignature: m.expectedSignature,
      symbols: m.symbol.split('/').map(s => s.includes('.') ? s : `EChartInstance.${s}`),
      implementation: m.implementation,
      tests: m.tests,
    })),
    ...(overrides.globalMethods ?? []).filter(m => m.owner === 'managed').map(m => ({
      sourceId: m.recordId,
      expectedSignature: m.expectedSignature,
      symbols: [...new Set(m.symbol.split('/').map(s => s.includes('.') ? s : `EChartsRuntime.${s}`))],
      implementation: m.implementation,
      tests: m.tests,
    })),
  ];
}

export function validateMappings(schema: ApiSchema, overrides: MappingOverrides): void {
  validateOverrides(schema, overrides, false);
  const errors = [
    ...csharpConfigurationErrors(schema, overrides.csharp),
    ...dynamicActionErrors(schema, overrides),
    ...runtimeTriggerErrors(schema, overrides),
  ];
  if (errors.length)
    throw new Error(errors.join('\n'));
}

/** A dynamic registerAction site of the pinned runtime needs a decision; a typed action must have its event/action mapping. */
export function dynamicActionErrors(schema: ApiSchema, overrides: MappingOverrides): string[] {
  const sites = schema.diagnostics.filter(d => d.code === 'DYNAMIC_ACTION_REGISTRATION');
  const decisions = overrides.dynamicActions ?? [];
  const mapped = new Set((overrides.eventActions ?? []).map(e => e.runtimeName.toLowerCase()));
  const errors: string[] = [];
  for (const site of sites)
    if (!decisions.some(d => site.provenance?.includes(d.source)))
      errors.push(`DYNAMIC_ACTION_REGISTRATION without a decision: ${site.message.slice(0, 160)}`);

  for (const d of decisions) {
    if (!sites.some(s => s.provenance?.includes(d.source)))
      errors.push(`Stale dynamic action decision ${d.source} (${d.site})`);

    if (!d.reason?.trim())
      errors.push(`Dynamic action decision ${d.source} (${d.site}) needs a reason`);

    for (const action of d.typed)
      if (!mapped.has(action.toLowerCase()))
        errors.push(`Dynamic action ${action} (${d.site}) is not typed`);
  }

  return errors;
}

/** Core sources whose literal trigger calls are chart events of the pinned runtime. */
export const triggerSources = ['lib/core/echarts.js'];

/** A chart event that the pinned core triggers by name is typed (an eventActions runtime name) or excluded with a reason. */
export function runtimeTriggerErrors(schema: ApiSchema, overrides: MappingOverrides, read: SourceReader = upstreamSourceReader()): string[] {
  const errors: string[] = [];
  const pins = schema.sources.find(s => s.name === 'echarts')?.files ?? [];
  const triggers: { event: string; site: string }[] = [];
  for (const file of triggerSources) {
    const text = read('echarts', file);
    const pin = pins.find(f => f.path === file)?.sha256;
    if (text === undefined || !pin || createHash('sha256').update(text).digest('hex') !== pin)
      errors.push(`RUNTIME_TRIGGER_SOURCE_INVALID ${file}`);
    else
      triggers.push(...scanTriggers(text, file));
  }

  if (errors.length)
    return errors;

  const typed = new Set((overrides.eventActions ?? []).map(e => e.runtimeName.toLowerCase()));
  const decisions = overrides.runtimeTriggers ?? [];
  for (const t of triggers)
    if (!typed.has(t.event.toLowerCase()) && !decisions.some(d => d.event === t.event))
      errors.push(`RUNTIME_TRIGGER without a decision: ${t.site} ${t.event}`);

  for (const d of decisions) {
    if (!d.reason?.trim())
      errors.push(`Runtime trigger decision ${d.event} needs a reason`);

    if (!triggers.some(t => t.event === d.event))
      errors.push(`Stale runtime trigger decision ${d.event}`);
    else if (typed.has(d.event.toLowerCase()))
      errors.push(`Runtime trigger ${d.event} is typed and excluded`);
  }

  return errors;
}

/** Every stale, invalid or unexplained entry of the C# configuration; api:diff reports them all. */
export function csharpConfigurationErrors(schema: ApiSchema, config: MappingOverrides['csharp']): string[] {
  const errors: string[] = [];
  if (!config?.roots.length)
    return ['Missing C# root mappings'];

  const types = new Map(schema.types.map(t => [t.id, t]));
  const records = new Map(schema.records.map(r => [r.id, r]));
  const pin = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const names = new Set<string>();

  // A name may also fix a projected component node: a specialized generic or a configured component node.
  let projectedIds: Set<string> | undefined;
  const projectedType = (id: string) => (projectedIds ??= new Set([
    ...componentTypes(schema, config.specializeGenerics ?? []).map(t => t.id),
    ...(config.componentNodes ?? []).map(t => t.id),
  ])).has(id);
  for (const mapping of [...config.roots, ...config.names]) {
    const id = 'typeId' in mapping ? mapping.typeId : records.get(mapping.recordId)?.type;
    if (!id || !types.has(id) && !projectedType(id))
      errors.push(`Stale C# mapping: ${JSON.stringify(mapping)}`);

    if (!/^[A-Z][A-Za-z0-9_]*$/.test(mapping.name) || names.has(mapping.name))
      errors.push(`Duplicate/invalid C# name: ${mapping.name}`);

    names.add(mapping.name);
  }

  for (const mapping of config.names)
    if (!mapping.reason?.trim())
      errors.push(`Missing reason of C# name: ${mapping.name}`);

  for (const d of config.defaults) {
    if (!types.get(d.typeId)?.properties?.some(p => p.name === d.property))
      errors.push(`Stale default: ${d.typeId}/${d.property}`);
  }

  for (const mapping of config.pins ?? []) {
    const t = types.get(mapping.typeId);
    if (!t || pin(t) !== mapping.sha256)
      errors.push(`Stale C# type pin: ${mapping.typeId}`);
  }

  for (const mapping of config.normalizedArrays ?? []) {
    const property = types.get(mapping.typeId)?.properties?.find(p => p.name === mapping.property);
    if (!property || property.type !== mapping.expectedTypeId || !mapping.reason.trim())
      errors.push(`Stale normalized array mapping: ${mapping.typeId}/${mapping.property}`);
  }

  for (const mapping of config.runtimePropertyTypes ?? []) {
    const property = types.get(mapping.typeId)?.properties?.find(p => p.name === mapping.property);
    if (!property || property.type !== mapping.expectedTypeId || !types.has(mapping.replacementTypeId) || !mapping.reason.trim())
      errors.push(`Stale runtime property mapping: ${mapping.typeId}/${mapping.property}`);
  }

  if (config.valueTypes?.length) {
    let projected: ReturnType<typeof componentTypes> = [];
    try {
      projected = componentTypes(schema, config.specializeGenerics ?? []);
    } catch (error) {
      errors.push(`Component projection failed: ${error}`);
    }

    for (const mapping of config.valueTypes) {
      const t = types.get(mapping.typeId) ?? projected.find(t => t.id === mapping.typeId);
      if (!t || pin(t) !== mapping.sha256 || !mapping.reason.trim())
        errors.push(`Stale value mapping: ${mapping.typeId}`);
    }
  }

  for (const v of config.variantTypes ?? []) {
    const member = types.get(v.typeId)?.properties?.find(p => p.name === 'type');
    if (!member || types.get(member.type)?.kind !== 'string' || !v.type || !v.reason?.trim())
      errors.push(`Stale variant type: ${v.typeId}`);
  }

  // A default applies to a variant: a model whose type member is one string literal, or a listed variant or graphic variant.
  const literalType = (id: string) => {
    const member = types.get(types.get(id)?.properties?.find(p => p.name === 'type')?.type ?? '');
    const values = (member?.kind === 'union' ? member.alternatives! : member ? [member.id] : [])
      .map(a => types.get(a))
      .filter(n => n && n.kind !== 'undefined' && n.kind !== 'null');
    return values.length === 1 && values[0]!.kind === 'literal' && typeof values[0]!.value === 'string';
  };
  const variants = new Set([
    ...(config.variantTypes ?? []).map(v => v.typeId),
    ...(config.graphicVariants ?? []).filter(v => v.discriminator).map(v => v.typeId),
  ]);
  const defaulted = new Set<string>();
  for (const d of config.variantDefaults ?? []) {
    if (defaulted.has(d.typeId))
      errors.push(`Duplicate variant default: ${d.typeId}`);

    defaulted.add(d.typeId);
    if (!variantDefaultCases.includes(d.when))
      errors.push(`Invalid variant default case: ${d.typeId} ${d.when}`);

    if (!d.reason?.trim())
      errors.push(`Missing reason of variant default: ${d.typeId}`);

    if (!types.has(d.typeId) || !variants.has(d.typeId) && !literalType(d.typeId))
      errors.push(`Stale variant default: ${d.typeId}`);
  }

  for (const r of config.memberRenames ?? []) {
    const owner = types.get(r.typeId);
    if (!owner?.properties?.some(p => p.name === r.property) || owner.properties.some(p => p.name === r.jsonName) || !r.jsonName || !r.reason?.trim())
      errors.push(`Stale member rename: ${r.typeId}/${r.property}`);
  }

  for (const id of config.specializeGenerics ?? []) {
    if (!types.get(id)?.typeParameters?.length)
      errors.push(`Stale generic target: ${id}`);
  }

  return errors;
}
