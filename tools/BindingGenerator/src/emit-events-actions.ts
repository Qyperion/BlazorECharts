import type { ApiSchema } from './schema.ts';
import { createSignatureHasher } from './validate-overrides.ts';
import { namedEvidenceErrors } from './evidence.ts';
import { header, quote, nullable, usings as shapeUsings, type ManifestEntry, type Shape } from './generation-model.ts';
import { read as readShape } from './emit-serializers.ts';
import { treemapTargetSource, sunburstTargetSource } from './runtime-node-targets.ts';
import { apiDocs, type ApiDoc } from './api-docs.ts';

export interface RuntimePayloadMapping {
  typeId?: string;
  registrationSources: string[];
  payloadSources: { file: string; sha256: string; startLine: number; endLine: number }[];
}

/** `self[]` types a field as an array of the event itself: dispatchAction copies the whole payload into every batch item.
 * `remarks` and `fieldRemarks` add XML remarks, for example for a documented member that ECharts 6.1.0 does not emit. */
export interface EventActionMapping {
  recordId: string;
  expectedSignature: string;
  runtimeName: string;
  name: string;
  fields: Record<string, string>;
  remarks?: string;
  fieldRemarks?: Record<string, string>;
  source: string[];
  contractSources: string[];
  reason: string;

  /** Browser tests (`file#TestName`) that dispatch the typed action or receive the typed event through EChart; none is contract only. */
  evidence?: string[];

  runtimePayload?: RuntimePayloadMapping;
  runtimeNodePayload?: RuntimePayloadMapping;
  runtimeAxisPayload?: RuntimePayloadMapping;
  runtimeSunburstPayload?: RuntimePayloadMapping;
  runtimeTreePayload?: RuntimePayloadMapping;
  runtimeRemainingPayload?: RuntimePayloadMapping;
}

export interface EventActionObject {
  name: string;
  fields: Record<string, string>;
  contractSources: string[];
}

/** C# member of a payload field; leading underscores of upstream internals go: __rangeOffset -> RangeOffset. */
const property = (s: string) => {
  const name = s.replace(/^_+/, '');
  return name[0].toUpperCase() + name.slice(1);
};

/** The ChartEvents descriptor of an event is its class name without Event: LegendSelectChangedEvent -> LegendSelectChanged. */
const descriptorName = (m: { name: string }) => {
  if (!/^[A-Z][A-Za-z]+Event$/.test(m.name))
    throw new Error(`Event class names are PascalCase and end with Event: ${m.name}`);

  return m.name.slice(0, -'Event'.length);
};

const escapeDoc = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

/** The class summary of an event or action: the echarts-doc API sentence and a link to its section, or what ECharts registers. */
const classDoc = (doc: ApiDoc | undefined, fallback: string, tail: string) =>
  `/// <summary>${doc?.summary ? escapeDoc(doc.summary) : fallback} ${tail}</summary>\n${doc ? `/// <seealso href="${doc.href}"/>\n` : ''}`;

const remarks = (text?: string, indent = '') =>
  text ? `${indent}/// <remarks>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</remarks>\n` : '';

/** The alternatives an EventActionValue field may name, joined by | and each optionally with []: what EventActionValue.Matches and Validate
 * (function) know. */
export const eventActionValueTokens = [
  'unknown', 'id', 'false', 'all', 'none', 'auto', 'click', 'mousemove', 'leave', 'mousewheel', 'rollUp', 'drillDown', 'main', 'node', 'edge', 'line',
  'bar', 'stack', 'tiled', 'geo', 'series', 'polygon', 'rect', 'lineX', 'lineY', 'single', 'multiple', 'string', 'number', 'boolean', 'object',
  'function',
];

/** integer: an index field of an event, read as int. */
const primitive: Record<string, string> = { string: 'string', number: 'double', integer: 'int', boolean: 'bool' };
const modelDir = 'src/BlazorECharts/Options/Generated/';
const eventDir = 'src/BlazorECharts/Events/Generated/';
const metadataPath = 'src/BlazorECharts/Serialization/Generated/EventActionMetadata.g.cs';

/** Explicit source-backed payload projection; closed nested structures never become opaque object arrays. */
export function emitEventsActions(
  schema: ApiSchema,
  mappings: EventActionMapping[] = [],
  objects: EventActionObject[] = [],
  shapes = new Map<string, Shape>()
) {
  const files = new Map<string, string>();
  const symbols = new Map<string, string[]>();
  const entries: ManifestEntry[] = [];
  const descriptors: string[] = [];
  const registrations: string[] = [];
  const metadata: string[] = [];
  const publicApi: string[] = [];
  const objectNames = new Set(objects.map(o => o.name));
  const docs = apiDocs();
  const docOf = (r: { publicPath: string; inventory?: { descriptionHash?: string } }) => docs(r.publicPath, r.inventory?.descriptionHash);
  const sourceModel = (type: string) =>
    type.startsWith('type:') && ['model', 'function', 'union'].includes(shapes.get(type)?.kind ?? '') ? shapes.get(type) : undefined;
  const direct = (type: string): boolean => ['tree-node-target', 'treemap-node-target', 'json'].includes(type)
    || !!primitive[type]
    || objectNames.has(type)
    || !!sourceModel(type)
    || (type.endsWith('[]') && direct(type.slice(0, -2)));
  const clr = (type: string): string =>
    type === 'json'
      ? 'EChartsValue'
      : type === 'treemap-node-target'
        ? 'TreemapNodeTarget'
        : type === 'tree-node-target'
          ? 'SunburstNodeTarget'
          : primitive[type] ?? sourceModel(type)?.cs ?? (objectNames.has(type) ? type : type.endsWith('[]') && direct(type.slice(0, -2))
            ? clr(type.slice(0, -2)) + '[]'
            : type === 'boolean-map' ? 'IReadOnlyDictionary<string, bool>' : 'EventActionValue');

  function read(type: string, json: string, external = false, depth = 0): string {
    if (type === 'json')
      return `EChartsValue.FromJson(${json})`;

    if (type === 'treemap-node-target')
      return `TreemapNodeTarget.Read(${json})`;

    if (type === 'tree-node-target')
      return `SunburstNodeTarget.Read(${json})`;

    // The browser event bridge sends non-finite numbers as JSON null; array elements read them back as NaN.
    if (type === 'number')
      return `(${json}.ValueKind == JsonValueKind.Null ? double.NaN : ${json}.GetDouble())`;

    if (type === 'integer')
      return `${json}.GetInt32()`;

    if (primitive[type])
      return type === 'string' ? `${json}.GetString() ?? throw new JsonException("Expected string.")` : `${json}.GetBoolean()`;

    const model = sourceModel(type);
    if (model?.kind === 'function')
      return `${json}.ValueKind == JsonValueKind.Null ? null : throw new JsonException("Function values require separate binding descriptors.")`;

    if (model?.kind === 'union')
      return `${model.name}.Read(${json})`;

    if (model)
      return `${external ? 'GeneratedOptionMetadata.' : ''}Read${model.name}(${json}, ${external ? 'PayloadSerialization' : 'context'})`;

    if (objectNames.has(type))
      return `${external ? 'GeneratedOptionMetadata.' : ''}Read${type}(${json}, ${external ? 'PayloadSerialization' : 'context'})`;

    if (type.endsWith('[]') && direct(type.slice(0, -2)))
      return `${external ? 'ReadItems' : 'ReadArray'}<${clr(type.slice(0, -2))}>(${json}, item${depth} => ${read(type.slice(0, -2), 'item' + depth, external, depth + 1)})`;

    return `EventActionValue.FromJson(${json})`;
  }

  for (const { name, fields } of [...objects, ...mappings])
    for (const [field, type] of Object.entries(fields))
      if (!direct(type)
        && type !== 'self[]'
        && type !== 'boolean-map'
        && !type.split('|').every(t => eventActionValueTokens.includes(t.replace(/(\[\])+$/, ''))))
        throw new Error(`Unknown event/action field type ${name}.${field}: ${type}`);

  const validSource = (ids: string[]) =>
    ids?.length && ids.every(id => schema.provenance.some(p => p.id === id && p.package === 'echarts' && p.version === '6.1.0'));
  const usings = 'using System.Text.Json;\nusing BlazorECharts.Options;\nusing BlazorECharts.Serialization;\nusing BlazorECharts.Serialization.Generated;\nusing BlazorECharts.Values;\n';
  const typedUsings = (fields: Record<string, string>) =>
    (Object.values(fields).some(t => sourceModel(t)?.kind === 'function') ? 'using BlazorECharts.Values.Signatures;\n' : '');

  function emitObject(name: string, fields: Record<string, string>, discriminator?: string, classRemarks?: string, doc?: ApiDoc): void {
    const path = modelDir + name + '.g.cs';
    const properties = Object.entries(fields);

    // Read for an event, a nested payload object defers a field it cannot read to that property's getter; an action reads strictly.
    // self[]: a batch of complete payloads of this action.
    const own = (type: string) => type === 'self[]';
    const typeOf = (type: string) => own(type) ? `${name}[]` : clr(type);
    const readOf = (type: string, json: string) => own(type) ? `ReadArray<${name}>(${json}, item => Read${name}(item, context))` : read(type, json);
    files.set(path, header
      + usings
      + typedUsings(fields)
      + `\nnamespace BlazorECharts.Options;\n\n${discriminator ? classDoc(doc, `The <c>${discriminator}</c> action that ECharts 6.1.0 registers.`, 'Unknown fields are retained.') : '/// <summary>A part of an event or action payload. Unknown fields are retained.</summary>\n'}${remarks(classRemarks)}public sealed class ${name}${discriminator ? `() : ChartAction(${quote(discriminator)})` : ' : OptionObject'}\n{\n`
      + properties
        .map(([field, type], i) => `    private ${typeOf(type)}? _p${i};\n    /// <summary>Gets or sets <c>${field}</c>${own(type) ? ': one payload per item of a batched dispatch' : type.startsWith('type:') ? '' : ` (${type})`}.</summary>\n    public ${typeOf(type)}? ${property(field)} { get => ${discriminator ? `_p${i}` : `Readable(_p${i}, ${quote(field)})`}; set { ${own(type) || direct(type) ? '' : `value?.Validate(${quote(type)}); `}SetProperty(ref _p${i}, value, ${quote(field)}); } }`)
        .join('\n')
      + '\n}\n');
    symbols.set(path, [name, ...properties.map(([field]) => `${name}.${property(field)}`)]);
    registrations.push(`        context.Register(new OptionTypeRegistration<${name}>(Write${name}, Read${name}));`);
    metadata.push(`    internal static void Write${name}(Utf8JsonWriter writer, ${name} value, EChartsSerializationContext context, string path)\n    {\n${discriminator ? '        context.WriteProperty(writer, value, "type", value.Type, path);\n' : ''}${properties.map(([field]) => `        context.WriteProperty(writer, value, ${quote(field)}, value.${property(field)}, path);`).join('\n')}\n    }\n    /// <summary>Reads ${name} and preserves additional properties.</summary>\n    public static ${name} Read${name}(JsonElement json, EChartsSerializationContext? context = null)\n    {\n        if (json.ValueKind != JsonValueKind.Object) throw new JsonException("Expected ${name} object.");\n        context ??= ReadContext;\n        var value = new ${name}();\n        foreach (var p in json.EnumerateObject()) switch (p.Name)\n        {\n${discriminator ? `            case "type": if (p.Value.GetString() != ${quote(discriminator)}) throw new JsonException("Wrong action discriminator."); break;\n` : ''}${properties.map(([field, type]) => {
      const assign = `value.${property(field)} = p.Value.ValueKind == JsonValueKind.Null ? (${typeOf(type)}?)null : ${readOf(type, 'p.Value')};`;
      return `            case ${quote(field)}: ${discriminator ? assign : `try { ${assign} } catch (Exception error) when (context.DefersFieldErrors && OptionReadError.Is(error)) { value.DeferReadError(${quote(field)}, error); }`} break;`;
    }).join('\n')}\n            default: value.AdditionalProperties[p.Name] = EChartsValue.FromJson(p.Value); break;\n        }\n        return value;\n    }`);
    publicApi.push(`${name} : ${discriminator ? 'ChartAction(' + discriminator + ')' : 'OptionObject'}\n`
      + properties.map(([field, type]) => `  ${typeOf(type)}? ${property(field)} { get; set; } [${field}: ${type}]`).join('\n'));
  }

  for (const object of objects) {
    if (!validSource(object.contractSources))
      throw new Error(`Stale nested event/action source: ${object.name}`);

    emitObject(object.name, object.fields);
  }

  const emittedContracts = new Map<string, string>();
  const signatureHash = createSignatureHasher(schema);
  const records = new Map(schema.records.map(r => [r.id, r]));
  for (const m of mappings) {
    const r = records.get(m.recordId);
    if (!r
      || signatureHash(r) !== m.expectedSignature
      || !m.reason
      || !m.source.length
      || !m.source.every(p => r.provenance.includes(p))
      || !validSource(m.contractSources))
      throw new Error(`Stale event/action mapping: ${m.recordId}`);

    if (r.inventory?.runtimeName && r.inventory.runtimeName !== m.runtimeName)
      throw new Error(`Stale event/action runtime name: ${m.recordId}`);

    const evidence = namedEvidenceErrors(m.runtimeName, m.evidence ?? []);
    if (evidence.length)
      throw new Error(`Stale event/action evidence: ${evidence.join('; ')}`);

    const runtimePayload = m.runtimePayload;
    const runtimeMapped = !!(m.runtimePayload
      || m.runtimeNodePayload
      || m.runtimeAxisPayload
      || m.runtimeSunburstPayload
      || m.runtimeTreePayload
      || m.runtimeRemainingPayload);
    if (m.runtimeTreePayload && m.fields.targetNode) {
      const targetPath = 'src/BlazorECharts/Values/Generated/TreemapNodeTarget.g.cs';
      if (!files.has(targetPath))
        publicApi.push('TreemapNodeTarget : IOptionValue\n  From(string) -> TreemapNodeTarget\n  From(EChartsObjectReference) -> TreemapNodeTarget\n  implicit string/EChartsObjectReference -> TreemapNodeTarget\n  Read(JsonElement) -> TreemapNodeTarget');

      files.set(targetPath, treemapTargetSource);
      symbols.set(targetPath, ['TreemapNodeTarget', 'TreemapNodeTarget.From', 'TreemapNodeTarget.Read']);
    }

    if (m.runtimeSunburstPayload) {
      const targetPath = 'src/BlazorECharts/Values/Generated/SunburstNodeTarget.g.cs';
      if (!files.has(targetPath))
        publicApi.push('SunburstNodeTarget : IOptionValue\n  From(string) -> SunburstNodeTarget\n  From(EChartsObjectReference) -> SunburstNodeTarget\n  implicit string/EChartsObjectReference -> SunburstNodeTarget\n  Read(JsonElement) -> SunburstNodeTarget');

      files.set(targetPath, sunburstTargetSource);
      symbols.set(targetPath, ['SunburstNodeTarget', 'SunburstNodeTarget.From', 'SunburstNodeTarget.Read']);
    }

    if (r.kind !== 'event' && r.kind !== 'action' && !runtimeMapped)
      throw new Error(`Event/action mapping requires an explicit runtime payload: ${r.id}`);

    const event = r.kind === 'event' || !!runtimePayload || runtimeMapped && m.recordId.startsWith('public:runtime.event.');
    const path = (event ? eventDir : modelDir) + m.name + '.g.cs';
    const contract = JSON.stringify({ runtimeName: m.runtimeName, fields: m.fields });
    if (emittedContracts.has(path) && emittedContracts.get(path) !== contract)
      throw new Error(`Conflicting shared action: ${m.recordId}`);

    const alreadyEmitted = emittedContracts.has(path);
    emittedContracts.set(path, contract);
    if (runtimePayload) {
      if (!runtimePayload.typeId || Object.keys(m.fields).length)
        throw new Error(`Runtime event must use its independent typed payload: ${r.id}`);

      const payload = shapes.get(runtimePayload.typeId);
      if (payload?.kind !== 'model')
        throw new Error(`Missing typed runtime payload: ${r.id}`);

      const fields = payload.properties!.filter(p => p.name !== 'type');
      const extra = [...(m.runtimeName === 'showtip' ? [['dataIndexInside', 'double', 'Number']] : []), ['escapeConnect', 'bool', 'Boolean']];

      // Use the same explicit metadata as options; callable/native fields stay
      // separate borrowed references in ChartEventPayload.NativeReferences.
      const read = (shape: Shape, json: string) => readShape(shape, json, 'PayloadSerialization')
        .replace(/(?<![.\w])Read([A-Z]\w*)(?=[(<])/g, (_, name: string) => name === 'Array' ? 'ReadItems' : `GeneratedOptionMetadata.Read${name}`);
      files.set(path, header
        + shapeUsings
        + 'using System.Linq;\nusing BlazorECharts.Serialization.Generated;\n\nnamespace BlazorECharts.Events;\n\n'
        + classDoc(docOf(r), `The <c>${m.runtimeName}</c> event that ECharts 6.1.0 emits.`, 'Native callbacks are separate borrowed references.')
        + `public sealed class ${m.name}(JsonElement json) : ChartEventPayload(json)\n{\n`
        + `    /// <summary>Gets the emitted lowercase event discriminator.</summary>\n    public string? Type => Text("type");\n`
        + fields.map(p => `    /// <summary>Gets the optional upstream ${p.name} field.</summary>\n    public ${nullable(p.shape)} ${p.csName} => Raw.TryGetProperty(${quote(p.name)}, out var value) && value.ValueKind != JsonValueKind.Null ? ${read(p.shape, 'value')} : null;`).join('\n')
        + '\n'
        + extra.map(
          ([f, t, reader]) =>
            `    /// <summary>Gets the optional runtime ${f} field.</summary>\n    public ${t}? ${property(f)} => ${reader}(${quote(f)});`
        ).join('\n')
        + '\n'
        + `    /// <summary>Gets the native batch envelope when present.</summary>\n    public ${m.name}[]? Batch => ReadField("batch", value => ReadItems(value, item => new ${m.name}(item)));\n}\n`);
      symbols.set(path, [
        m.name,
        `${m.name}.Write`,
        `${m.name}.ctor`,
        `${m.name}.Type`,
        `${m.name}.Batch`,
        ...fields.map(p => `${m.name}.${p.csName}`),
        ...extra.map(([f]) => `${m.name}.${property(f)}`),
      ]);
      descriptors.push(`    /// <summary>Subscribes to ${m.runtimeName}.</summary>\n    public static ChartEvent<${m.name}> ${descriptorName(m)} { get; } = new(${quote(m.runtimeName)}, json => new ${m.name}(json));`);
      publicApi.push(`${m.name} : ChartEventPayload [${m.runtimeName}]\n  string? Type { get; }\n`
        + fields.map(p => `  ${nullable(p.shape)} ${p.csName} { get; } [${p.name}]`).join('\n')
        + '\n'
        + extra.map(([f, t]) => `  ${t}? ${property(f)} { get; } [${f}]`).join('\n')
        + `\n  ${m.name}[]? Batch { get; }`);
    } else if (event) {
      const fieldType = (type: string) => type === 'self[]' ? `${m.name}[]` : clr(type);
      files.set(path, header
        + usings
        + typedUsings(m.fields)
        + `\nnamespace BlazorECharts.Events;\n\n${classDoc(docOf(r), `The <c>${m.runtimeName}</c> event that ECharts 6.1.0 emits.`, 'Unknown JSON fields are retained.')}${remarks(m.remarks)}public sealed class ${m.name}(JsonElement json) : ChartEventPayload(json)\n{\n`
        + Object.entries(m.fields).map(([field, type]) => {
          const expression = type === 'self[]' ? `ReadField(${quote(field)}, json => ReadItems(json, item => new ${m.name}(item)))`
            : primitive[type]
              ? `${type === 'string' ? 'Text' : type === 'number' ? 'Number' : type === 'integer' ? 'Integer' : 'Boolean'}(${quote(field)})`
              : type === 'json' ? `JsonValue(${quote(field)})`
                : sourceModel(type)?.kind === 'union' ? `ReadValue(${quote(field)}, json => ${read(type, 'json', true)})`
                  : direct(type) ? `ReadField(${quote(field)}, json => ${read(type, 'json', true)})`
                    : type === 'boolean-map' ? `BooleanMap(${quote(field)})` : `ReadUnion(${quote(field)}, ${quote(type)})`;
          return `    /// <summary>Gets <c>${field}</c>${type.startsWith('type:') ? '' : ` (${type === 'self[]' ? m.name + '[]' : type})`}.</summary>\n${remarks(m.fieldRemarks?.[field], '    ')}    public ${fieldType(type)}? ${property(field)} => ${expression};`;
        }).join('\n')
        + '\n}\n');
      symbols.set(path, [m.name, `${m.name}.Write`, `${m.name}.ctor`, ...Object.keys(m.fields).map(f => `${m.name}.${property(f)}`)]);
      descriptors.push(`    /// <summary>Subscribes to ${m.runtimeName}.</summary>\n    public static ChartEvent<${m.name}> ${descriptorName(m)} { get; } = new(${quote(m.runtimeName)}, json => new ${m.name}(json));`);
      publicApi.push(`${m.name} : ChartEventPayload [${m.runtimeName}]\n`
        + Object.entries(m.fields).map(([f, t]) => `  ${fieldType(t)}? ${property(f)} { get; } [${f}: ${t}]`).join('\n'));
    } else if (!alreadyEmitted)
      emitObject(m.name, m.fields, m.runtimeName, m.remarks, docOf(r));

    const t = schema.types.find(t => t.id === r.type)!;
    entries.push({
      sourceId: r.id,
      typeId: r.type,
      family: r.family,
      families: [r.family],
      status: 'generated',
      runtimeName: m.runtimeName,
      symbol: event ? `ChartEvents.${descriptorName(m)}` : m.name,
      file: event ? eventDir + 'ChartEvents.g.cs' : path,
      serializer: event ? `${m.name}.Write` : `GeneratedOptionMetadata.Write${m.name}`,
      reader: event ? `${m.name}.ctor` : `GeneratedOptionMetadata.Read${m.name}`,
      alternatives: t.alternatives ?? [t.id],
    });
  }

  files.set(eventDir + 'ChartEvents.g.cs', header
    + 'namespace BlazorECharts.Events;\n\n/// <summary>Pinned public ECharts event descriptors.</summary>\npublic static class ChartEvents\n{\n'
    + descriptors.join('\n')
    + '\n}\n');
  symbols.set(eventDir + 'ChartEvents.g.cs', entries.filter(e => e.file === eventDir + 'ChartEvents.g.cs').map(e => e.symbol));
  files.set(metadataPath, header
    + usings
    + typedUsings(Object.assign({}, ...objects.map(o => o.fields), ...mappings.map(m => m.fields)))
    + '\nnamespace BlazorECharts.Serialization.Generated;\n\ninternal static partial class GeneratedOptionMetadata\n{\n    private static void RegisterActions(EChartsSerializationContext context)\n    {\n'
    + registrations.join('\n')
    + '\n    }\n'
    + metadata.join('\n')
    + '\n}\n');
  symbols.set(
    metadataPath,
    [
      ...objects.map(o => o.name),
      ...mappings.filter(m => m.recordId.startsWith('public:action.') || m.recordId.startsWith('public:runtime.action.') && (m.runtimeNodePayload
        || m.runtimeAxisPayload
        || m.runtimeSunburstPayload
        || m.runtimeTreePayload
        || m.runtimeRemainingPayload)).map(m => m.name),
    ].flatMap(
      name => [`GeneratedOptionMetadata.Read${name}`, `GeneratedOptionMetadata.Write${name}`]
    )
  );
  files.set(
    'docs/api-coverage/events-actions-6.1.0.md',
    '# ECharts 6.1.0 events and actions\n\nGenerated from signature-pinned overrides. Serializable open fields are retained. Native event references have callback-scoped borrowed leases; executable function hydration belongs to the native binding bridge.\n\n'
    + 'Every contract is checked by `EventActionContractTests` and `events.test.ts`; `event-conformance.spec.ts` compares every event payload of the real ECharts with its typed members. '
    + 'Browser evidence names the Playwright tests under `tests/browser` that dispatch the typed action or receive the typed event through `EChart`, in Server and WebAssembly; `contract only` means no browser test does.\n\n'
    + '| Inventory record | CLR contract | Runtime name | Source | Browser evidence |\n|---|---|---|---|---|\n'
    + mappings.map(m => `| ${m.recordId} | ${m.name} | ${m.runtimeName} | ${[...m.source, ...m.contractSources].join(', ')} | ${m.evidence?.length ? m.evidence.map(e => e.replace(/^tests\/browser\//, '')).join('; ') : 'contract only'} |`).join('\n')
    + '\n\n## Closed nested payloads\n\n'
    + objects.map(o => `- ${o.name}: ${Object.keys(o.fields).join(', ')}. Source: ${o.contractSources.join(', ')}.`).join('\n')
    + '\n'
  );
  return { files, entries, symbols, publicApi: publicApi.join('\n') };
}
