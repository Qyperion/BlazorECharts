import { existsSync } from 'node:fs';
import type { ApiSchema } from './schema.ts';
import { createSignatureHasher } from './validate-overrides.ts';
import { evidenceErrors } from './evidence.ts';
import { identifier, header, type GlobalTypeTwin } from './generation-model.ts';

/** `parameters` renames upstream parameters of a generated helper, so that its overloads agree with the hand-written ones. */
export interface GlobalMapping {
  recordId: string;
  expectedSignature: string;
  owner: string;
  symbol: string;
  reason: string;
  implementation: string[];
  tests: string[];
  parameters?: Record<string, string>;
}

/** Generated option models by type ID let duplicate bundle declarations reuse one public class. */
export interface GlobalProjectionOptions {
  twins?: GlobalTypeTwin[];
  models?: (typeId: string) => string | undefined;
  parameters?: Map<string, Record<string, string>>;
}

const csPath = 'src/BlazorECharts/Runtime/Generated/GlobalHelpers.g.cs';
const jsPath = 'src/BlazorECharts/JavaScript/global-helpers.generated.ts';

/** Semantic graph projection for JSON-only helpers. Native objects and functions stay with the native bridge owner. */
export function projectGlobalHelpers(schema: ApiSchema, options: GlobalProjectionOptions = {}) {
  const types = new Map(schema.types.map(t => [t.id, t]));
  const twins = globalTwins(schema, options);
  const usedTwins = new Set<string>();
  const classes = new Map<string, string>();
  const unions = new Map<string, string>();

  interface Shape {
    cs: string;
    read: (v: string) => string;
    check: (v: string) => string;
  }

  const primitive = (cs: string, read: (v: string) => string, kind: string): Shape =>
    ({ cs, read, check: v => `${v}.ValueKind == JsonValueKind.${kind}` });
  const projected = new Map<string, Shape>();
  const active = new Set<string>();

  function shape(id: string): Shape {
    if (projected.has(id))
      return projected.get(id)!;

    const twin = twins.get(id);
    if (twin) {
      usedTwins.add(id);
      return { cs: twin, read: v => `GeneratedOptionMetadata.Read${twin}(${v})`, check: v => `${v}.ValueKind == JsonValueKind.Object` };
    }

    if (active.has(id))
      throw Error('recursive/native object');

    active.add(id);
    const t = types.get(id)!;
    try {
      let result: Shape;
      if (t.kind === 'number')
        result = { ...primitive('double', v => `MethodJson.Number(${v})`, 'Number'), check: v => `MethodJson.IsNumber(${v})` };
      else if (t.kind === 'string')
        result = primitive('string', v => `${v}.GetString()!`, 'String');
      else if (t.kind === 'boolean')
        result = {
          cs: 'bool',
          read: v => `(${v}.ValueKind != JsonValueKind.Null && ${v}.GetBoolean())`,
          check: v => `(${v}.ValueKind is JsonValueKind.True or JsonValueKind.False)`,
        };
      else if (t.kind === 'literal') {
        const p = shape(schema.types.find(x => x.kind === typeof t.value)!.id);
        result = { ...p, check: v => `(${p.check(v)} && ${p.read(v)} == ${JSON.stringify(t.value)})` };
      } else if (t.kind === 'void')
        result = { cs: 'bool', read: () => 'true', check: () => 'true' };
      else if (t.kind === 'type-parameter')
        result = t.constraint ? shape(t.constraint) : dynamic();
      else if (t.kind === 'intersection' && t.constituents?.every(id => ['type-parameter', 'any', 'unknown'].includes(types.get(id)!.kind)))
        result = dynamic();
      else if (t.kind === 'generic-reference' && /^Dictionary</.test(t.display))
        result = dynamic();
      else if (t.kind === 'generic-reference' && /^(ArrayLike|ReadonlyArray|Array)</.test(t.display)) {
        const e = shape(t.typeArguments![0]);
        const n = 'item' + id.slice(-6);
        result = {
          cs: e.cs + '[]',
          read: v => `${v}.EnumerateArray().Select(${n} => ${e.read(n)}).ToArray()`,
          check: v => `${v}.ValueKind == JsonValueKind.Array`,
        };
      } else if (t.display === 'KeyOfDistributive<T> & string')
        result = primitive('string', v => `${v}.GetString()!`, 'String');
      else if (['unknown', 'any', 'non-primitive'].includes(t.kind))
        result = dynamic();
      else if (t.display === 'Date')
        result = { cs: 'DateTimeOffset', read: v => `${v}.GetDateTimeOffset()`, check: v => `${v}.ValueKind == JsonValueKind.String` };
      else if (t.kind === 'array') {
        const e = shape(t.element!);
        const n = 'item' + id.slice(-6);
        result = {
          cs: e.cs + '[]',
          read: v => `${v}.EnumerateArray().Select(${n} => ${e.read(n)}).ToArray()`,
          check: v => `(${v}.ValueKind == JsonValueKind.Array && ${v}.EnumerateArray().All(${n} => ${e.check(n)}))`,
        };
      } else if (t.kind === 'tuple') {
        const elements = t.elements!.map(e => shape(e.type));
        if (!elements.every(e => e.cs === elements[0].cs))
          throw Error('heterogeneous native tuple');

        const e = elements[0];
        const optional = t.elements!.some(e => e.optional);
        result = {
          cs: e.cs + (optional ? '?[]' : '[]'),
          read: v => `${v}.EnumerateArray().Select(item => ${optional ? `item.ValueKind == JsonValueKind.Null ? (${e.cs}?)null : ` : ''}${e.read('item')}).ToArray()`,
          check: v => `(${v}.ValueKind == JsonValueKind.Array && ${v}.GetArrayLength() >= ${t.minLength ?? elements.length} && ${v}.GetArrayLength() <= ${elements.length} && ${elements.map((e, i) => t.elements![i].optional ? `(${v}.GetArrayLength() <= ${i} || ${v}[${i}].ValueKind == JsonValueKind.Null || ${e.check(`${v}[${i}]`)})` : e.check(`${v}[${i}]`)).join(' && ')})`,
        };
      } else if (t.kind === 'union') {
        const alternatives = t.alternatives!.filter(id => !['undefined', 'null'].includes(types.get(id)!.kind));
        const parts = alternatives.filter(id => !types.get(id)!.signatures?.length && !/^Model</.test(types.get(id)!.display)).map(shape);
        if (!parts.length)
          throw Error('native/function alternatives');

        if (parts.length === 1)
          result = parts[0];
        else if (alternatives.every(id => types.get(id)!.kind === 'literal' && typeof types.get(id)!.value === 'boolean'))
          result = {
            cs: 'bool',
            read: v => `(${v}.ValueKind != JsonValueKind.Null && ${v}.GetBoolean())`,
            check: v => `(${v}.ValueKind is JsonValueKind.True or JsonValueKind.False)`,
          };
        else {
          const name = 'GlobalUnion' + id.slice(-10);
          const unique = [...new Map(parts.map(p => [p.cs, p])).values()];
          const check = (v: string) => '(' + parts.map(p => p.check(v)).join(' || ') + ')';
          unions.set(name, `/// <summary>Source union: ${escape(t.display)}.</summary>\npublic readonly struct ${name} : IOptionValue {\n private readonly object? _value; private readonly bool _initialized;\n private ${name}(object? value) { _value = value; _initialized = true; }\n /// <summary>Creates the value from a JSON alternative that the source union accepts.</summary>\n public static ${name} FromJson(JsonElement json) { if (!${check('json')}) throw new ArgumentException("Invalid global union value."); return new(json.Clone()); }\n /// <summary>Gets the JSON form of the value.</summary>\n public JsonElement Json => ToJson();\n /// <summary>Serializes the value, using custom data registrations when a context is supplied.</summary>\n public JsonElement ToJson(EChartsSerializationContext? context = null) { if (!_initialized) throw new InvalidOperationException("Uninitialized global union."); var json = GlobalArgument.Json(_value, context); if (!${check('json')}) throw new ArgumentException("Invalid global union value."); return json; }\n ${unique.map(p => `/// <summary>Converts a supported alternative.</summary>\n public static implicit operator ${name}(${p.cs} value) => new(value);`).join('\n ')}\n void IOptionValue.Write(Utf8JsonWriter w, EChartsSerializationContext c, string p) => ToJson(c).WriteTo(w);\n}\n`);
          result = { cs: name, read: v => `${name}.FromJson(${v})`, check };
        }
      } else if (t.kind === 'object' && !t.signatures?.length && !t.constructSignatures?.length) {
        if (t.indexes?.length && t.indexes.every(i => ['any', 'unknown'].includes(types.get(i.value)!.kind)))
          result = dynamic();
        else if (t.indexes?.length && t.indexes.every(i => types.get(i.key)?.kind === 'number') && t.properties?.every(p => p.name === 'length')) {
          const e = shape(t.indexes[0].value);
          result = {
            cs: e.cs + '[]',
            read: v => `${v}.EnumerateArray().Select(item => ${e.read('item')}).ToArray()`,
            check: v => `${v}.ValueKind == JsonValueKind.Array`,
          };
        } else {
          if (t.indexes?.length || !t.properties?.length)
            throw Error('native/open model object');

          const props = t.properties.map(p => ({ ...p, shape: shape(p.type) }));
          const name = 'GlobalData' + id.slice(-10);
          classes.set(name, `/// <summary>Source data: ${escape(t.display)}.</summary>\npublic sealed class ${name} : IOptionValue {\n ${props.map(p => `/// <summary>Gets or sets the source ${escape(p.name)} property.</summary>
 public ${p.shape.cs}${p.optional ? '?' : ''} ${identifier(p.name)} { get; set; }${p.optional || ['double', 'bool', 'DateTimeOffset'].includes(p.shape.cs) || p.shape.cs.startsWith('GlobalUnion') && !p.shape.cs.endsWith('[]') ? '' : ' = default!;'}`).join('\n ')}\n internal static ${name} Read(JsonElement v) => new() { ${props.map(p => `${identifier(p.name)} = ${p.optional ? `v.TryGetProperty(${JSON.stringify(p.name)}, out var field${identifier(p.name)}) && field${identifier(p.name)}.ValueKind != JsonValueKind.Null ? ${p.shape.read('field' + identifier(p.name))} : (${p.shape.cs}?)null` : p.shape.read(`v.GetProperty(${JSON.stringify(p.name)})`)}`).join(', ')} };\n void IOptionValue.Write(Utf8JsonWriter w, EChartsSerializationContext c, string p) { w.WriteStartObject(); ${props.map(p => `${p.optional ? `if (${identifier(p.name)} is not null) { ` : ''}w.WritePropertyName(${JSON.stringify(p.name)}); GlobalArgument.Write(w, ${identifier(p.name)}, c, p);${p.optional ? ' }' : ''}`).join(' ')} w.WriteEndObject(); }\n}\n`);
          result = { cs: name, read: v => `${name}.Read(${v})`, check: v => `${v}.ValueKind == JsonValueKind.Object` };
        }
      } else
        throw Error(`native/function contract: ${t.display.slice(0, 100)}`);

      projected.set(id, result);
      return result;
    } finally {
      active.delete(id);
    }
  }

  function dynamic(): Shape {
    return { cs: 'EChartsValue', read: v => `EChartsValue.FromJson(${v})`, check: () => 'true' };
  }

  function wire(id: string, seen = new Set<string>()): unknown {
    if (seen.has(id))
      return null;

    const next = new Set(seen).add(id);
    const t = types.get(id)!;
    if (t.kind === 'number' || t.kind === 'literal' && typeof t.value === 'number')
      return 'number';

    if (t.kind === 'array')
      return { array: wire(t.element!, next) };

    if (t.kind === 'tuple')
      return { array: t.elements!.map(e => wire(e.type, next)) };

    if (t.kind === 'union')
      return t.alternatives!.map(a => wire(a, next)).filter(Boolean);

    if (t.kind === 'type-parameter' && t.constraint)
      return wire(t.constraint, next);

    if (t.kind === 'object' && !t.signatures?.length && !t.indexes?.length)
      return { properties: Object.fromEntries(t.properties!.map(p => [p.name, wire(p.type, next)])) };

    return null;
  }

  const numericArguments: Record<string, unknown[]> = {};
  const booleanResults = new Set<string>();
  const methods: string[] = [];
  const delivered = new Map<string, { symbols: string[]; pending: string[] }>();

  // Only documented globals become typed managed helpers; undocumented helpers stay callable through InvokeNativeAsync.
  for (const r of schema.records.filter(
    r => r.family === 'global-methods' && ['echarts.registerLocale', 'echarts.registerTheme'].includes(r.publicPath)
  )) {
    const symbols: string[] = [];
    const pending: string[] = [];
    const seen = new Set<string>();
    const renames = options.parameters?.get(r.id) ?? {};
    for (const name of Object.keys(renames))
      if (!(types.get(r.type)?.signatures ?? []).some(sig => sig.parameters.some(p => p.name === name)))
        throw Error(`Unknown global parameter ${name} of ${r.id}`);

    if (r.publicPath === 'echarts.zrUtil.setAsPrimitive') {
      delivered.set(r.id, { symbols, pending: ['Persistent native object identity mutation belongs to 14.'] });
      continue;
    }

    for (const sig of types.get(r.type)?.signatures ?? []) {
      try {
        const parameters = sig.parameters.map(p => ({ ...p, name: renames[p.name] ?? p.name, shape: shape(p.type) }));
        const output = shape(sig.returnType);
        let name = r.publicPath.split('.').slice(1).map(identifier).join('') + 'Async';
        const literal = parameters.filter(p => types.get(p.type)?.kind === 'literal');
        if (literal.length)
          name = name.replace('Async', literal.map(p => types.get(p.type)?.value === true ? 'AsString' : 'AsNumber').join('') + 'Async');

        const key = name + parameters.map(p => p.shape.cs).join(',');
        if (seen.has(key))
          continue;

        seen.add(key);
        const nullableReturn = !['double', 'bool', 'EChartsValue'].includes(output.cs) && !output.cs.startsWith('GlobalUnion');
        const declarations = parameters
          .filter(p => !literal.includes(p))
          .map(p => `${p.shape.cs}${p.optional ? '?' : ''} @${p.name}${p.optional ? ' = null' : ''}`);
        const args = parameters.map(p => literal.includes(p) ? JSON.stringify(types.get(p.type)!.value) : p.rest
          ? `.. @${p.name}.Select(item => GlobalArgument.Optional(item))`
          : p.optional ? `GlobalArgument.Optional(@${p.name})` : `@${p.name}`);
        const checks = parameters.map((p, index) => {
          if (literal.includes(p) || ['double', 'bool', 'DateTimeOffset', 'EChartsValue'].includes(p.shape.cs))
            return '';

          return `${p.optional ? `if (wireArgs[${index}].ValueKind != JsonValueKind.Null) ` : ''}GlobalArgument.Validate(${p.rest ? `GlobalArgument.Tail(wireArgs, ${index})` : `wireArgs[${index}]`}, json => ${p.shape.check('json')});`;
        }).join(' ');
        const read = nullableReturn ? `v.ValueKind == JsonValueKind.Null ? null : ${output.read('v')}` : output.read('v');
        const isVoid = types.get(sig.returnType)!.kind === 'void';
        methods.push(`/// <summary>Invokes ${r.publicPath}. Mutable JS output parameters are returned as managed copies.</summary>\n public ${isVoid ? 'async ValueTask' : `ValueTask<${output.cs}${nullableReturn ? '?' : ''}>`} ${name}(${[...declarations, 'CancellationToken cancellationToken = default'].join(', ')}) { ${isVoid ? 'await' : 'return'} GlobalReadAsync<${output.cs}${nullableReturn ? '?' : ''}>(${JSON.stringify(r.publicPath.slice(8))}, [${args.join(', ')}], v => ${read}, cancellationToken, wireArgs => { ${checks} })${isVoid ? '.ConfigureAwait(false)' : ''}; }`);
        symbols.push(name);
        numericArguments[r.publicPath.slice(8)] ??= sig.parameters.flatMap(
          p => p.rest && types.get(p.type)!.kind === 'tuple' ? types.get(p.type)!.elements!.map(e => wire(e.type)) : [wire(p.type)]
        );
        if (output.cs === 'bool' && !isVoid)
          booleanResults.add(r.publicPath.slice(8));

        if (parameters.some(p => types.get(p.type)!.display.includes('=>') || types.get(p.type)!.display.includes('Model<')))
          pending.push('Executable/native alternatives remain 14.');
      } catch (error) {
        pending.push(String(error));
      }
    }

    delivered.set(r.id, { symbols, pending });
  }

  for (const id of twins.keys())
    if (!usedTwins.has(id))
      throw Error(`Unused global type twin ${id}`);

  const publicApi = methods.map(m => m.slice(m.indexOf(' public ') + 1, m.indexOf(') {') + 1)).join('\n')
    + '\n'
    + [...unions.values(), ...classes.values()].flatMap(m => m.split('\n')
      .filter(line => line.includes('public ') && !line.includes('internal '))
      .map(line => line.split(' => ')[0].split(' {')[0].trim())).join('\n')
    + '\n';
  return {
    delivered,
    publicApi,
    files: new Map([
      [
        csPath,
        header
        + 'using System.Text.Json;\nusing BlazorECharts.Options;\nusing BlazorECharts.Values;\nusing BlazorECharts.Serialization;\nusing BlazorECharts.Serialization.Generated;\nnamespace BlazorECharts.Runtime;\npublic partial class EChartsRuntime {\n '
        + methods.join('\n ')
        + '\n}\n'
        + [...unions.values(), ...classes.values()].join('\n'),
      ],
      [
        jsPath,
        '// <auto-generated />\nexport const globalHelperNames: readonly string[] = '
        + JSON.stringify([...delivered].filter(([, d]) => d.symbols.length).map(([id]) => schema.records.find(r => r.id === id)!.publicPath.slice(8)))
        + ';\nexport const globalNumericArguments: Record<string, unknown[]> = '
        + JSON.stringify(numericArguments)
        + ';\nexport const globalBooleanResults: readonly string[] = '
        + JSON.stringify([...booleanResults])
        + ';\n',
      ],
    ]),
  };
}

/** A twin is the same declaration span in another bundle file, projected once as the canonical option model. */
function globalTwins(schema: ApiSchema, options: GlobalProjectionOptions) {
  const types = new Map(schema.types.map(t => [t.id, t]));
  const sources = new Map(schema.provenance.map(p => [p.id, p]));
  const span = (id: string) =>
    (types.get(id)?.provenance ?? []).map(p => sources.get(p)).filter(p => !!p).map(p => ({ file: p!.file, at: JSON.stringify([p!.start, p!.end]) }));
  const result = new Map<string, string>();
  for (const twin of options.twins ?? []) {
    const type = types.get(twin.typeId);
    const canonical = types.get(twin.canonicalTypeId);
    const [a, b] = [span(twin.typeId), span(twin.canonicalTypeId)];
    if (!type || !canonical || type.id === canonical.id || type.display !== canonical.display || !twin.reason || result.has(type.id)
      || a.length !== 1 || b.length !== 1 || a[0].at !== b[0].at || a[0].file === b[0].file)
      throw Error(`Invalid global type twin ${twin.typeId}`);

    const model = options.models?.(canonical.id);
    if (!model)
      throw Error(`Global type twin ${twin.typeId} has no generated option model`);

    result.set(type.id, model);
  }

  return result;
}

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function emitGlobalMethods(schema: ApiSchema, mappings: GlobalMapping[] = [], options: GlobalProjectionOptions = {}) {
  const inventory = schema.records.filter(
    r => r.inventory && ['global-method', 'graphic-namespace', 'graphic', 'custom-renderItem'].includes(r.inventory.category)
  );
  const hash = createSignatureHasher(schema);
  const seen = new Set<string>();
  for (const m of mappings) {
    const r = inventory.find(r => r.id === m.recordId);
    if (!r || seen.has(m.recordId) || hash(r) !== m.expectedSignature)
      throw Error(`Stale global mapping: ${m.recordId}`);

    seen.add(m.recordId);
    if (!m.reason
      || !m.owner
      || !m.symbol
      || ['managed', 'native'].includes(m.owner) && (!m.implementation.length || m.implementation.some(p => !existsSync(p))))
      throw Error(`Missing global evidence: ${m.recordId}`);

    const evidence = ['managed', 'native'].includes(m.owner) ? evidenceErrors(m.recordId, m.tests) : [];
    if (evidence.length)
      throw Error(`Missing global evidence: ${evidence.join('; ')}`);
  }

  for (const r of inventory)
    if (!seen.has(r.id))
      throw Error(`Missing global owner: ${r.id}`);

  const records = inventory.map(r => ({ ...mappings.find(m => m.recordId === r.id)!, name: r.name, source: r.provenance }));
  const projection = projectGlobalHelpers(schema, {
    ...options,
    parameters: new Map(mappings.filter(m => m.parameters).map(m => [m.recordId, m.parameters!])),
  });
  projection.files.set(
    'docs/api-coverage/global-methods-6.1.0.md',
    '# ECharts 6.1.0 global and graphic owners\n\nSignature-pinned ownership. `managed` members have typed JSON projections; `native` members use native reference invocation, browser callbacks and constructors. Native helpers use explicit upstream-order arguments. Model coverage and browser delivery are separate.\n\n| Native | Owner | Contract | Delivery |\n|---|---|---|---|\n'
    + records.map(r => `| ${r.recordId} | ${r.owner} | ${r.symbol} | ${r.reason.replaceAll('|', '/')} |`).join('\n')
    + '\n'
  );
  return { ...projection, records };
}
