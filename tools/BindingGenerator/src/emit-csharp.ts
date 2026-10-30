import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ApiSchema, TypeNode } from './schema.ts';
import type { MappingOverrides } from './validate-overrides.ts';
import { validateMappings } from './validate-mappings.ts';
import {
  header,
  usings,
  identifier,
  nullable,
  manyElement,
  quote,
  generatedJson,
  manifestPath,
  manifestShards,
  loadTypeNameLock,
  typeNameLockPath,
  type TypeNameLock,
  type Shape,
  type GenerationResult,
  type ManifestEntry,
} from './generation-model.ts';
import { shardJson } from './sharded-json.ts';
import { anyOf, emitRegistry, emitSerializer, matches, nullOr, read } from './emit-serializers.ts';
import { emitSignature } from './emit-signatures.ts';
import { emitEventsActions } from './emit-events-actions.ts';
import { createInstanceMethodReport, instanceMethodMarkdown } from './instance-methods.ts';
import { emitGlobalMethods } from './global-methods.ts';
import { emitNativeGraphics } from './native-graphics.ts';
import { prepareComponentTypes } from './component-types.ts';
import { componentRoute } from './component-routes.ts';
import { componentEntries } from './component-coverage.ts';
import { optionGroup } from './option-partition.ts';
import {
  buildOriginIndex,
  DeclarationIndex,
  deriveScope,
  scopeSummary,
  serializeOriginIndex,
  serializeScopeCategories,
  upstreamSourceReader,
} from './scope-categories.ts';
import { manualCoverageMappings } from './validate-mappings.ts';
import { validateEmittedUnions, validateManualMappings } from './coverage.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { emitSeriesTests } from './emit-series-tests.ts';
import { removeStaleFiles, type OutputScope } from './generated-files.ts';
import { chooseTypeNames, hintText, reservedTypeNames, routeKey, type NameHint } from './type-names.ts';
import { upstreamAlias } from './type-aliases.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const child = (hint: NameHint, suffix: string): NameHint => ({ owner: hint.owner, property: hint.property, suffix: hint.suffix + suffix });
const rootHint = (name: string): NameHint => ({ owner: name, property: '', suffix: '' });
const modelDir = 'src/BlazorECharts/Options/Generated/';
const serializerDir = 'src/BlazorECharts/Serialization/Generated/';
const valueDir = 'src/BlazorECharts/Values/Generated/';

/** Types declared by hand in the libraries, partial and internal ones too; generated types must not take their names. */
export function handWrittenTypes(root = process.cwd()): string[] {
  const names: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }

    for (const e of entries) {
      if (e.isDirectory()) {
        if (!['Generated', 'bin', 'obj', 'wwwroot', 'JavaScript'].includes(e.name))
          walk(join(dir, e.name));
      } else if (e.name.endsWith('.cs'))
        for (const m of readFileSync(join(root, dir, e.name), 'utf8').matchAll(
          /\b(?:public|internal)\s+(?:(?:sealed|abstract|static|readonly|record|partial)\s+)*(?:class|struct|record|enum|interface)\s+([A-Z]\w*)/g
        ))
          names.push(m[1]);
    }
  };
  walk('src/BlazorECharts');
  walk('src/BlazorECharts.WordCloud');
  return names;
}

/**
 * The array of `X | X[]`: the one array alternative whose element has exactly the other alternatives. Every array is checked,
 * so the choice does not depend on the content-hash order of the alternatives; with two such arrays there is none.
 */
export function manyArray(ids: string[], types: Map<string, TypeNode>): string | undefined {
  const flattened = (id: string): string[] => types.get(id)?.kind === 'union' ? types.get(id)!.alternatives!.flatMap(flattened) : [id];
  const arrays = ids.filter(a => types.get(a)!.kind === 'array').filter(array => {
    const scalar = flattened(types.get(array)!.element!).filter(a => types.get(a)!.kind !== 'undefined');
    const rest = ids.filter(a => a !== array);
    return rest.length && scalar.length === rest.length && scalar.every(a => rest.includes(a));
  });
  return arrays.length === 1 ? arrays[0] : undefined;
}

/** Deterministic projection of the schema and verified pinned declaration inputs. Unsupported alternatives remain diagnostics. */
export function generate(
  schema: ApiSchema,
  overrides: MappingOverrides,
  typeNameLock: TypeNameLock | undefined = loadTypeNameLock()
): GenerationResult {
  validateMappings(schema, overrides);
  const config = overrides.csharp!;
  const types = prepareComponentTypes(schema, config);
  const records = new Map(schema.records.map(r => [r.id, r]));
  const fixedNames = new Map(config.names.map(n => [n.typeId, n.name]));
  const mainTypeMarker = (t: TypeNode) =>
    t.kind === 'object' && t.properties?.length === 1 && t.properties[0].name === 'mainType' && types.get(t.properties[0].type)?.kind === 'literal';
  const discriminatorLiteral = (t: TypeNode): string | undefined => {
    const member = t.properties?.find(p => p.name === 'type');
    const node = member && types.get(member.type);
    if (!node)
      return undefined;

    const values = (node.kind === 'union' ? node.alternatives! : [node.id])
      .map(a => types.get(a)!)
      .filter(n => n.kind !== 'undefined' && n.kind !== 'null');
    return values.length === 1 && values[0].kind === 'literal' && typeof values[0].value === 'string' ? values[0].value : undefined;
  };
  const deprecation = upstreamDeprecation(schema);
  const usedDefaults = new Set<object>();
  const usedVariantDefaults = new Set<object>();
  const defaultFor = (typeId: string, property: string) => {
    const d = config.defaults.find(d => d.typeId === typeId && d.property === property);
    if (d)
      usedDefaults.add(d);

    return d?.value;
  };

  // Two projections: the first records where every named type is reached under provisional names,
  // the second projects again with the stable names chosen from those contexts.
  let shapes = new Map<string, Shape>();
  let names = new Map<string, string>();
  let usedNames = new Map<string, string>();
  let diagnostics: GenerationResult['diagnostics'] = [];
  let failures = new Map<string, string>();
  let pending = new Set<string>();
  let contexts = new Map<string, NameHint[]>();
  let chosen: Map<string, string> | undefined;
  const files = new Map<string, string>();
  const roots = config.roots.map(r => ({ ...r, typeId: records.get(r.recordId)!.type }));
  for (const r of config.projectedRoots ?? []) {
    if (!types.has(r.typeId))
      throw new Error(`Unknown projected root ${r.typeId}`);

    roots.push({ ...r, recordId: '' });
  }

  for (const r of config.graphicVariants ?? [])
    roots.push({ recordId: '', typeId: r.typeId, name: r.name });

  const series = new Map<string, string>();

  // Use the same declaration entry as ChartOptions; do not combine separate bundled module identities.
  for (const s of schema.series) {
    const r = schema.records.find(r => r.kind === 'export'
      && r.id.startsWith('export:echarts/index.d.ts::')
      && types.get(r.type)?.properties?.some(p => p.name === 'type' && types.get(p.type)?.value === s.name));
    if (r) {
      roots.push({ recordId: r.id, name: r.name, typeId: r.type });
      series.set(r.type, s.name);
    }
  }

  for (const r of roots)
    fixedNames.set(r.typeId, r.name);

  function nameFor(id: string, hint: NameHint): string {
    if (names.has(id))
      return names.get(id)!;

    const stable = chosen?.get(id);
    if (stable) {
      usedNames.set(stable, id);
      names.set(id, stable);
      return stable;
    }

    const t = types.get(id)!;
    let name = /^[A-Za-z][A-Za-z0-9_$]*$/.test(t.display) ? identifier(t.display.replace(/\$\d+$/, '')) : identifier(hintText(hint));
    if (usedNames.has(name) && usedNames.get(name) !== id)
      name += '_' + digest(id).slice(0, 10);

    usedNames.set(name, id);
    names.set(id, name);
    return name;
  }

  const flattened = (id: string): string[] => types.get(id)?.kind === 'union' ? types.get(id)!.alternatives!.flatMap(flattened) : [id];

  // An optional type literal selects the form where another alternative of a union has a different optional literal, as component
  // subtypes do. Elsewhere (patterns, textContent, matrix dimensions) ECharts recognizes the object by its other members: no type matches.
  const optionalLiteral = (t: TypeNode) => t.properties?.find(p => p.name === 'type')?.optional ? discriminatorLiteral(t) : undefined;
  const subtypes = new Set<string>();
  for (const t of types.values()) {
    if (t.kind !== 'union')
      continue;

    const literals = flattened(t.id).flatMap(id => {
      const literal = types.get(id) && optionalLiteral(types.get(id)!);
      return literal ? [[id, literal]] : [];
    });
    for (const [id, literal] of literals)
      if (literals.some(([, other]) => other !== literal))
        subtypes.add(id);
  }

  // Unions with the same alternatives (bundle copies, `X | undefined`) are one C# type; the named or fixed declaration represents them.
  const unionTwins = new Map<string, string>();
  const unionGroups = new Map<string, string[]>();
  for (const t of types.values()) {
    if (t.kind !== 'union' || config.valueTypes?.some(m => m.typeId === t.id))
      continue;

    const ids = [...new Set(flattened(t.id).filter(a => !['undefined', 'null', 'never'].includes(types.get(a)!.kind)))].sort();
    if (ids.length > 1)
      (unionGroups.get(ids.join('|')) ?? unionGroups.set(ids.join('|'), []).get(ids.join('|'))!).push(t.id);
  }

  const twinNames: string[] = [];
  for (const ids of unionGroups.values()) {
    if (ids.length < 2)
      continue;

    const fixed = [...new Set(ids.map(id => fixedNames.get(id)).filter(Boolean))];
    if (fixed.length > 1) {
      twinNames.push(fixed.join(', '));
      continue;
    }

    const rank = (id: string) => (fixedNames.has(id) ? 0 : 2) + (/^[A-Za-z][A-Za-z0-9_$]*$/.test(types.get(id)!.display) ? 0 : 1);
    const [canonical, ...twins] = [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en'));
    for (const id of twins)
      unionTwins.set(id, canonical);
  }

  if (twinNames.length)
    throw new Error(`Unions with the same alternatives need one csharp.names entry: ${twinNames.join('; ')}`);

  // Transition states (enterFrom, leaveTo, keyframes) are Partial<ElementProps>, but ECharts animates only transform props, style,
  // shape and extra from them (customGraphicTransition.js:123-160, customGraphicKeyframeAnimation.js:50-110): no zrender internals.
  const animatedMembers = new Set([
    'x', 'y', 'originX', 'originY', 'anchorX', 'anchorY', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY', 'style', 'shape', 'extra', 'percent',
    'easing',
  ]);
  const transitionStates = (() => {
    const reach = (id: string) => flattened(id).flatMap(a => types.get(a)?.kind === 'array' ? [a, ...flattened(types.get(a)!.element!)] : [a]);
    const states = new Set<string>();
    const other = new Set<string>();
    for (const t of types.values())
      for (const p of t.properties ?? []) {
        const reached = reach(p.type);
        for (const id of reached)
          (['enterFrom', 'leaveTo', 'keyframes'].includes(p.name) ? states : other).add(id);
      }

    return new Set([...states].filter(id => ['object', 'intersection'].includes(types.get(id)!.kind) && !other.has(id)));
  })();

  // Bundle copies whose alternatives are themselves different copies (OptionDataValue[] of another declaration file).
  const alternativeNames = (id: string, depth = 0): string => depth > 8 ? id : [
    ...new Set(flattened(id)
      .map(a => types.get(a)!)
      .filter(a => !['undefined', 'null', 'never'].includes(a.kind))
      .map(a => a.kind === 'array' ? `(${alternativeNames(a.element!, depth + 1)})[]` : a.display)),
  ].sort().join(' | ');
  for (const twin of config.unionTwins ?? []) {
    if (types.get(twin.typeId)?.kind !== 'union' || types.get(twin.canonicalTypeId)?.kind !== 'union' || !twin.reason?.trim()
      || alternativeNames(twin.typeId) !== alternativeNames(twin.canonicalTypeId))
      throw new Error(`Stale union twin ${twin.typeId}`);

    unionTwins.set(twin.typeId, unionTwins.get(twin.canonicalTypeId) ?? twin.canonicalTypeId);
  }

  function project(id: string, hint: NameHint): Shape {
    (contexts.get(id) ?? contexts.set(id, []).get(id)!).push(hint);
    const existing = shapes.get(id);
    if (existing)
      return existing;

    if (failures.has(id))
      throw new Error(failures.get(id));

    if (pending.has(id))
      throw new Error(`Recursive value alias ${id}`);

    const t = types.get(id);
    if (!t)
      throw new Error(`Missing type ${id}`);

    pending.add(id);
    try {
      let shape: Shape;
      const valueMapping = config.valueTypes?.find(m => m.typeId === id);
      if (valueMapping && valueMapping.kind !== 'data') {
        shape = { id, kind: valueMapping.kind, cs: valueMapping.kind === 'date' ? 'DateTimeOffset' : 'EChartsObjectReference' };
        shapes.set(id, shape);
        return shape;
      }

      switch (t.kind) {
        case 'generic-reference': {
          const target = types.get(t.target!);
          if (target?.name === 'ArrayLike' && t.typeArguments?.length === 1) {
            const element = project(t.typeArguments[0], child(hint, 'Item'));
            shape = { id, kind: 'arraylike', cs: `OptionArrayLike<${nullable(element)}>`, element };
            break;
          }

          if (!target?.signatures?.length || target.properties?.length || (target.typeParameters?.length ?? 0) !== (t.typeArguments?.length ?? 0))
            throw new Error(`Unsupported generic-reference ${id} (${t.display.slice(0, 80)})`);

          const bindings = new Map((target.typeParameters ?? []).map((p, i) => [p.type, t.typeArguments![i]]));
          const signatures = target.signatures.map(s => ({
            ...s,
            parameters: s.parameters.map(p => ({ ...p, type: bindings.get(p.type) ?? p.type })),
            returnType: bindings.get(s.returnType) ?? s.returnType,
          }));
          const name = nameFor(id, child(hint, 'Signature'));
          shape = { id, name, cs: `JsFunction<${name}>`, kind: 'function', signatures };
          break;
        }
        case 'string':
        case 'number':
        case 'boolean':
          shape = { id, kind: t.kind, cs: t.kind === 'number' ? 'double' : t.kind === 'boolean' ? 'bool' : 'string' };
          break;
        case 'any':
        case 'unknown':
          shape = { id, kind: 'dynamic', cs: 'EChartsValue' };
          break;
        case 'never':
        case 'undefined':
          shape = { id, kind: 'never', cs: 'NeverValue' };
          break;
        case 'literal': {
          const name = nameFor(id, hint);
          shape = {
            id,
            name,
            cs: name,
            kind: 'union',
            alternatives: [
              {
                id,
                kind: typeof t.value === 'boolean' ? 'boolean' : typeof t.value === 'number' ? 'number' : 'string',
                cs: typeof t.value === 'boolean' ? 'bool' : typeof t.value === 'number' ? 'double' : 'string',
                literal: t.value,
              },
            ],
          };
          break;
        }
        case 'array': {
          // Anchor before descending: a recursive node can be reached through its children array first.
          shape = { id, kind: 'array', cs: '' };
          shapes.set(id, shape);
          const element = project(t.element!, child(hint, 'Item'));
          shape.element = element;
          shape.cs = nullable(element) + '[]';
          break;
        }
        case 'union': {
          const twin = unionTwins.get(id);
          if (twin) {
            shape = project(twin, hint);
            break;
          }

          const ids = flattened(id).filter(a => !['undefined', 'null', 'never'].includes(types.get(a)!.kind));
          if (!ids.length) {
            shape = { id, kind: 'never', cs: 'NeverValue' };
            break;
          }

          const array = manyArray(ids, types);
          if (array) {
            const element = project(types.get(array)!.element!, child(hint, 'Item'));

            // OneOrMany<X?> would need two user-defined conversions from a scalar alternative of X.
            const struct = element.kind === 'union' && element.alternatives!.some(a => a.kind !== 'model') ? element.name + 'OneOrMany' : undefined;
            shape = { id, kind: 'many', cs: struct ?? `OneOrMany<${manyElement(element)}>`, element, ...(struct ? { struct } : {}) };
            break;
          }

          if (ids.length === 1) {
            shape = project(ids[0], hint);
            break;
          }

          const discriminator = (a: string) => types.get(types.get(a)?.properties?.find(p => p.name === 'type')?.type ?? '')?.value;
          if (ids.some(a => series.has(a)) && ids.every(a => typeof discriminator(a) === 'string')) {
            shape = { id, kind: 'series', cs: 'SeriesOption' };
            for (const a of ids)
              if (series.has(a))
                project(a, rootHint(names.get(a)!));

            break;
          }

          if (ids.every(a => types.get(a)!.kind === 'literal' && typeof types.get(a)!.value === 'boolean') && ids.length === 2) {
            shape = { id, kind: 'boolean', cs: 'bool' };
            break;
          }

          const name = nameFor(id, hint);
          shape = { id, name, cs: name, kind: 'union', alternatives: [] };
          shapes.set(id, shape); // Recursive data unions are anchored by their object alternatives.

          // Project all alternatives before committing this union. A failed one cannot disappear.
          const alternatives = ids.map(a => {
            const node = types.get(a)!;
            return node.kind === 'literal' ? {
              id: a,
              kind: typeof node.value === 'boolean' ? 'boolean' : typeof node.value === 'number' ? 'number' : 'string',
              cs: typeof node.value === 'boolean' ? 'bool' : typeof node.value === 'number' ? 'double' : 'string',
              literal: node.value,
            } as Shape : project(a, { owner: name, property: '', suffix: 'Alternative', union: hint });
          });

          // A never alternative (string & callback intersections) cannot be constructed; it goes when another remains.
          const possible = alternatives.filter(a => a.kind !== 'never');
          shape.alternatives = possible.length ? possible : alternatives;
          break;
        }
        case 'tuple': {
          if (t.elements!.some(e => e.optional || e.rest))
            throw new Error(`Optional/rest tuple ${id}`);

          const elements = t.elements!.map((e, i) => project(e.type, child(hint, 'Item' + i)));
          const name = nameFor(id, hint);
          shape = { id, name, cs: name, kind: 'tuple', elements };
          break;
        }
        case 'object':
        case 'intersection': {
          // X & { mainType?: '<literal>' } is X: ECharts does not read mainType from options.
          if (t.kind === 'intersection') {
            const rest = t.constituents!.filter(c => !mainTypeMarker(types.get(c)!));
            if (rest.length === 1 && rest.length < t.constituents!.length) {
              shape = project(rest[0], hint);
              break;
            }
          }

          if (t.kind === 'intersection' && t.constituents?.every(id => types.get(id)?.kind === 'array')) {
            const arrays = t.constituents.map(id => types.get(id)!);
            const narrow = arrays.find(a => arrays.every(b => flattened(a.element!).every(id => flattened(b.element!).includes(id))));
            if (narrow) {
              shape = project(narrow.id, hint);
              break;
            }
          }

          if (t.kind === 'intersection' && t.constituents?.some(c => ['string', 'number', 'boolean', 'literal'].includes(types.get(c)?.kind ?? ''))) {
            const primitive = t.constituents.find(c => ['string', 'number', 'boolean', 'literal'].includes(types.get(c)?.kind ?? ''))!;
            const others = t.constituents.filter(c => c !== primitive).map(c => types.get(c)!);
            if (others.every(c => c.kind === 'object'
              && !c.signatures?.length
              && !c.constructSignatures?.length
              && !c.indexes?.length
              && c.properties?.every(p => p.optional))) {
              shape = project(primitive, hint);
              break;
            }

            if (others.some(c => c.kind === 'array' || c.signatures?.length || c.kind === 'object')) {
              shape = { id, kind: 'never', cs: 'NeverValue' };
              break;
            }
          }

          const dynamicIndex = t.indexes?.every(
            i => types.get(i.key)?.kind === 'string' && ['any', 'unknown'].includes(types.get(i.value)?.kind ?? '')
          );
          if (t.typeParameters?.length || t.constructSignatures?.length || t.indexes?.some(i => types.get(i.key)?.kind !== 'string'))
            throw new Error(`Open generic/index/constructor contract ${id} (${t.display.slice(0, 80)})`);

          if (t.signatures?.length) {
            if (t.properties?.some(p => !p.optional))
              throw new Error(`Callable with required properties ${id}`);

            const name = nameFor(id, child(hint, 'Signature'));
            shape = { id, name, cs: `JsFunction<${name}>`, kind: 'function', signatures: t.signatures };
            break;
          }

          if (valueMapping?.kind !== 'data' && t.properties?.some(p => !p.optional && types.get(p.type)?.signatures?.length))
            throw new Error(`Required methods need an explicit native-reference/data mapping ${id} (${t.display.slice(0, 80)})`);

          if (t.indexes?.length && !t.properties?.length && !dynamicIndex) {
            shape = { id, kind: 'dictionary', cs: '' };
            shapes.set(id, shape);
            const element = project(t.indexes[0].value, child(hint, 'Entry'));
            shape.element = element;
            shape.cs = `OptionDictionary<${nullable(element)}>`;
            break;
          }

          const name = nameFor(id, hint);
          const graphic = config.graphicVariants?.find(v => v.typeId === id);

          // A variant whose upstream type member is one string literal writes it itself; ECharts would otherwise pick its default component.
          const variant = graphic?.discriminator
            ?? config.variantTypes?.find(v => v.typeId === id)?.type
            ?? (series.get(id) ? undefined : discriminatorLiteral(t));
          const variantDefault = variant ? config.variantDefaults?.find(v => v.typeId === id) : undefined;
          if (variantDefault)
            usedVariantDefaults.add(variantDefault);

          const explicit = !!graphic?.discriminator || !!config.variantTypes?.some(v => v.typeId === id);
          const absentType = variantDefault?.when ?? (variant && !explicit && optionalLiteral(t) && !subtypes.has(id) ? 'always' : undefined);
          shape = {
            id,
            name,
            cs: name,
            kind: 'model',
            properties: [],
            discriminator: series.get(id),
            ...(variant ? { initialValues: { type: variant } } : {}),
            ...(absentType ? { absentType } : {}),
          };
          shapes.set(id, shape); // Object recursion is legal and remains typed.
          if (t.indexes?.length && !dynamicIndex)
            shape.index = project(t.indexes[0].value, child(hint, 'Entry'));

          const memberNames = new Set<string>();
          for (const p of t.properties ?? []) {
            if (p.name === 'type' && shape.discriminator)
              continue;

            // ECharts reads mainType from its component classes, not from options.
            if (p.name === 'mainType')
              continue;

            if (transitionStates.has(id) && !animatedMembers.has(p.name))
              continue;

            // Private upstream members (__value of animation keyframes) are not options.
            if (p.name.startsWith('__'))
              continue;

            const jsonName = config.memberRenames?.find(r => r.typeId === id && r.property === p.name)?.jsonName ?? p.name;

            // Series skip type above; on every other model it is a plain Type property.
            let csName = p.name === 'type' ? 'Type' : domMemberNames[jsonName] ?? identifier(jsonName);
            if (csName === name || memberNames.has(csName))
              csName += '_' + digest(p.name).slice(0, 8);

            memberNames.add(csName);
            const sourceId = `property:${id}/${p.name}`;
            try {
              const runtimeType = config.runtimePropertyTypes?.find(m => m.typeId === id && m.property === p.name);
              let propertyShape = project(runtimeType?.replacementTypeId ?? p.type, { owner: name, property: csName, suffix: '' });

              // `textStyle?: never` forbids the member; an empty never[] array stays.
              if (propertyShape.kind === 'never')
                continue;

              if (config.normalizedArrays?.some(m => m.typeId === id && m.property === p.name) && propertyShape.kind !== 'many') {
                propertyShape = { id: p.type, kind: 'many', cs: `OneOrMany<${manyElement(propertyShape)}>`, element: propertyShape };
              }

              // Preserve literal restrictions in readers too.
              const summary = config.componentProperties?.find(c => c.parent === id && c.name === p.name)?.summary;
              const deprecated = deprecation(p.provenance);
              shape.properties!.push({
                name: jsonName,
                csName,
                shape: propertyShape,
                sourceId,
                defaultValue: defaultFor(id, p.name),
                ...(summary ? { summary } : {}),
                ...(deprecated !== undefined ? { deprecated } : {}),
              });
            } catch (error) {
              diagnostics.push({ code: 'UNSUPPORTED_MAPPING', sourceId, typeId: p.type, message: String(error) });
            }
          }

          break;
        }
        default:
          throw new Error(`Unsupported ${t.kind} ${id} (${t.display.slice(0, 80)})`);
      }

      shapes.set(id, shape);
      return shape;
    } catch (error) {
      shapes.delete(id);
      failures.set(id, String(error));
      throw error;
    } finally {
      pending.delete(id);
    }
  }

  const projectRoots = (stable?: Map<string, string>) => {
    shapes = new Map();
    names = new Map(fixedNames);
    usedNames = new Map([...names].map(([id, name]) => [name, id]));
    diagnostics = [];
    failures = new Map();
    pending = new Set();
    contexts = new Map();
    chosen = stable;
    for (const root of roots) {
      try {
        project(root.typeId, rootHint(root.name));
      } catch (error) {
        diagnostics.push({ code: 'UNSUPPORTED_ROOT', sourceId: root.recordId, typeId: root.typeId, message: String(error) });
      }
    }
  };
  projectRoots();
  const named = [...contexts.keys()].filter(id => shapes.get(id)?.name);
  const read = upstreamSourceReader();
  projectRoots(chooseTypeNames({
    order: [...new Set([...fixedNames.keys(), ...named])].filter(id => names.has(id)),
    provisional: names,
    fixed: fixedNames,
    contexts,
    types,
    sourceTypes: new Map(schema.types.map(t => [t.id, t])),
    kinds: new Map(named.map(id => [id, shapes.get(id)!.kind])),
    alias: (t: TypeNode) => upstreamAlias(schema, t, read),
    reserved: new Set([
      ...reservedTypeNames,
      ...handWrittenTypes(),
      'SeriesOption',
      'GeneratedOptionMetadata',
      'EChartsTransportJsonContext',
      ...(overrides.eventActions ?? []).map(e => e.name),
      ...(overrides.eventActionObjects ?? []).map(e => e.name),
    ]),
    locked: new Map(Object.entries(typeNameLock ?? {}).map(([name, route]) => [route, name])),
    twins: [...unionTwins].reduce((map, [twin, canonical]) => map.set(canonical, [...map.get(canonical) ?? [], twin]), new Map<string, string[]>()),
  }));
  const provisional = [...names].filter(([, name]) => /_[0-9a-f]{10}$/.test(name));
  if (provisional.length)
    throw new Error(`CSHARP_NAME_COLLISION unnamed in the stable projection: ${provisional.map(([id, name]) => `${name} (${id})`).join(', ')}`);

  // Members reached by an echarts-doc option path; the rest exist only in the TypeScript declarations.
  // Each member keeps the shortest echarts-doc path that ends at it, with its documented default.
  const documentedMembers = new Map<string, MemberDoc>();
  const modelPaths = new Map<string, Map<string, number>>();
  const optionRoot = records.get(config.roots[0].recordId)!.type;
  for (const r of schema.records)
    if (r.kind === 'documented' && r.publicPath.startsWith('option.')) {
      const route = componentRoute(types, optionRoot, r.publicPath, config.componentVariants, config.optionRouteAliases);
      route.forEach(e => {
        const key = `${e.parent}/${e.name}`;
        const doc = documentedMembers.get(key) ?? {};
        const path = r.publicPath.slice('option.'.length);
        if (e.name !== '@' && (!doc.path || path.length < doc.path.length || path.length === doc.path.length && path < doc.path)) {
          doc.path = path;
          doc.defaultValue = r.inventory?.defaultValue;
        }

        documentedMembers.set(key, doc);
        if (e.name !== '@') {
          const prefix = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '';
          const counts = modelPaths.get(e.parent) ?? modelPaths.set(e.parent, new Map()).get(e.parent)!;
          counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
        }
      });
    }

  const unique = [...new Map([...shapes.values()].filter(s => s.name).map(s => [s.name!, s])).values()].sort(
    (a, b) => a.name!.localeCompare(b.name!, 'en')
  );
  const models = unique.filter(s => s.kind === 'model');

  // A locked name stays published: keep its route while the type is still reached through it.
  const lockOut: TypeNameLock = {};
  for (const shape of unique) {
    const routes = [...new Set((contexts.get(shape.id) ?? []).map(h => routeKey(h, types.get(shape.id), types)))].sort();
    const old = typeNameLock?.[shape.name!];
    lockOut[shape.name!] = old && routes.includes(old) ? old : routes[0];
  }

  // The struct of X | X[] follows the name of its union X.
  const manyStructs = [...new Map([...shapes.values()].filter(s => s.struct).map(s => [s.struct!, s])).values()].sort(
    (a, b) => a.struct!.localeCompare(b.struct!, 'en')
  );
  for (const shape of manyStructs)
    lockOut[shape.struct!] = `${lockOut[shape.element!.name!]}|one-or-many`;

  const lost = Object.entries(typeNameLock ?? {}).filter(([name]) => !(name in lockOut));
  if (lost.length)
    throw new Error(`TYPE_NAME_LOCK ${lost.map(([name, route]) => `${name} (${route})`).join(', ')} no longer generated. A removed or renamed public type is a breaking change: remove the entry from ${typeNameLockPath} deliberately.`);

  files.set(
    typeNameLockPath,
    JSON.stringify(Object.fromEntries(Object.entries(lockOut).sort(([a], [b]) => a.localeCompare(b, 'en'))), null, 2) + '\n'
  );

  // A variant of a component union converts to the component list itself: XAxis = new XAxisCategoryOption().
  const componentLists = new Map<string, string[]>();
  for (const model of models)
    for (const p of model.properties!) {
      if (p.shape.kind !== 'many' || p.shape.element?.kind !== 'union' || p.shape.struct)
        continue;

      for (const alternative of p.shape.element.alternatives!)
        if (alternative.kind === 'model' && !alternative.discriminator) {
          const lists = componentLists.get(alternative.name!) ?? componentLists.set(alternative.name!, []).get(alternative.name!)!;
          if (!lists.includes(p.shape.cs))
            lists.push(p.shape.cs);
        }
    }

  for (const lists of componentLists.values())
    lists.sort();

  for (const shape of unique) {
    if (shape.kind === 'model') {
      shape.file = modelDir + shape.name + '.cs';
      files.set(shape.file, emitModel(shape, documentedMembers, modelPaths.get(shape.id), componentLists.get(shape.name!) ?? []));
      files.set(serializerDir + shape.name + '.Serializer.g.cs', emitSerializer(shape));
    } else if (shape.kind === 'union' || shape.kind === 'tuple') {
      shape.file = valueDir + shape.name + '.g.cs';
      files.set(shape.file, emitValue(shape));
    } else if (shape.kind === 'function') {
      shape.file = valueDir + 'Signatures/' + shape.name + '.g.cs';
      files.set(shape.file, emitSignature(shape));
    }
  }

  files.set(
    modelDir + 'SeriesOption.cs',
    header + 'using BlazorECharts.Serialization;\n\nnamespace BlazorECharts.Options;\n\n/// <summary>Extensible series base. Register concrete writers and discriminator factories explicitly.</summary>\npublic abstract partial class SeriesOption : OptionObject\n{\n    private string _type;\n    /// <summary>Creates a series with an exact, immutable runtime discriminator.</summary>\n    protected SeriesOption(string type)\n    {\n        ArgumentException.ThrowIfNullOrWhiteSpace(type);\n        _type = type;\n        SetProperty(ref _type, type, "type");\n    }\n    /// <summary>Gets the runtime series discriminator.</summary>\n    public string Type => _type;\n}\n'
  );
  const taken = new Set([...unique.map(s => s.name!), ...reservedTypeNames, ...handWrittenTypes()]);
  for (const shape of manyStructs) {
    if (taken.has(shape.struct!))
      throw new Error(`CSHARP_NAME_COLLISION ${shape.struct} of ${shape.element!.name} | ${shape.element!.name}[]`);

    files.set(valueDir + shape.struct + '.g.cs', emitManyStruct(shape));
  }

  const unionArrays = [
    ...new Set([...shapes.values()]
      .filter(s => s.kind === 'array' && (s.element?.kind === 'union' || s.element?.kind === 'tuple') && s.element.name)
      .map(s => s.element!.name!)),
  ].sort((a, b) => a.localeCompare(b, 'en'));
  files.set(serializerDir + 'GeneratedOptionMetadata.g.cs', emitRegistry(models, unionArrays));
  files.set(
    serializerDir + 'EChartsTransportJsonContext.g.cs',
    header + 'using System.Text.Json.Serialization;\n\nnamespace BlazorECharts.Serialization.Generated;\n\n/// <summary>Reflection-free JSON transport metadata; options use the explicit writer registry.</summary>\n[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]\n[JsonSerializable(typeof(PreparedOption))]\n[JsonSerializable(typeof(JsBinding))]\ninternal partial class EChartsTransportJsonContext : JsonSerializerContext;\n'
  );

  // Derived typed graphic subtypes refine an existing broad source alternative.
  // Keep the source denominator exact rather than reporting refinements as new upstream API.
  const sourceTypes = new Map(schema.types.map(t => [t.id, t]));
  const fullAlternatives = (t: TypeNode) => {
    const source = sourceTypes.get(t.id) ?? t;
    return source.kind === 'union' ? [...source.alternatives!] : [source.id];
  };
  const members = new Map(models.flatMap(s => s.properties!.map(p => [p.sourceId, { model: s, member: p }] as const)));
  const diagnosticRecords = new Map(diagnostics.map(d => [d.sourceId, d.message]));
  const partialTypes = new Set(diagnostics.map(d => d.sourceId.slice(9, d.sourceId.lastIndexOf('/'))));
  const entries: ManifestEntry[] = schema.records.map((r): ManifestEntry => {
    const m = members.get(r.id);
    const shape = shapes.get(r.type);

    // A property is represented even when the target model still has a partial surface; the model record remains unresolved.
    const complete = shape && !partialTypes.has(r.type) && !['function', 'series'].includes(shape.kind);
    const supported = !!m || (['export', 'definition'].includes(r.kind) && complete && !!shape.name);
    const file = m?.model.file ?? shape?.file ?? '';
    const symbol = m ? `${m.model.name}.${m.member.csName}` : shape?.name ?? '';
    return {
      sourceId: r.id,
      typeId: r.type,
      family: r.family,
      families: [r.family],
      status: supported ? 'generated' : 'unresolved',
      symbol: supported ? symbol : '',
      file: supported ? file : '',
      serializer: supported
        ? m || shape?.kind === 'model' ? `GeneratedOptionMetadata.Write${m?.model.name ?? shape?.name}` : `${shape?.name}.IOptionValue.Write`
        : '',
      reader: supported ? m || shape?.kind === 'model' ? `GeneratedOptionMetadata.Read${m?.model.name ?? shape?.name}` : `${shape?.name}.Read` : '',
      alternatives: supported ? fullAlternatives(types.get(r.type)!) : [],
      ...(!supported ? { reason: diagnosticRecords.get(r.id) ?? 'Awaiting specialized family mapping or runtime implementation.' } : {}),
    };
  }).filter(e => e.status === 'generated' || diagnosticRecords.has(e.sourceId));

  // Dedicated DTO gates include their full reachable source graph, not a convenient subset of emitted fields.
  const familyGroups = roots.filter(r => r.family).map(r => {
    const seen = new Set<string>();

    function visit(id: string): void {
      if (seen.has(id))
        return;

      seen.add(id);
      const t = types.get(id)!;
      for (const p of t.properties ?? [])
        visit(p.type);

      for (const a of t.alternatives ?? [])
        visit(a);

      if (t.element)
        visit(t.element);
    }

    visit(r.typeId);
    const sourceIds = schema.records
      .filter(e => e.id === r.recordId || (e.id.startsWith('property:') && seen.has(e.id.slice(9, e.id.lastIndexOf('/')))))
      .map(e => e.id);
    for (const e of entries)
      if (sourceIds.includes(e.sourceId))
        e.families.push(r.family!);

    return { id: r.family!, rootSourceId: r.recordId, sourceIds };
  });
  const events = emitEventsActions(schema, overrides.eventActions, overrides.eventActionObjects, shapes);
  for (const [path, content] of events.files)
    files.set(path, content);

  for (const entry of events.entries) {
    const i = entries.findIndex(e => e.sourceId === entry.sourceId);
    if (i >= 0)
      entries.splice(i, 1);

    entries.push(entry);
  }

  const routed = (['graphic-custom', 'components', 'standard', 'advanced'] as const).flatMap(
    group => componentEntries(schema, config, types, shapes, group)
  );
  const routedIds = new Set(routed.map(e => e.sourceId));
  for (let i = entries.length - 1; i >= 0; i--)
    if (routedIds.has(entries[i].sourceId))
      entries.splice(i, 1);

  entries.push(...routed);
  const group = schema.records.find(r => r.id === 'public:echartsInstance.group');
  if (group)
    entries.push({
      sourceId: group.id,
      typeId: group.type,
      family: group.family,
      families: [group.family],
      status: 'generated',
      symbol: 'EChartInstance.GetGroupAsync',
      file: 'src/BlazorECharts/Runtime/EChartInstance.Groups.cs',
      serializer: 'EChartInstance.SetGroupAsync',
      reader: 'EChartInstance.GetGroupAsync',
      alternatives: fullAlternatives(types.get(group.type)!),
    });

  const globals = overrides.globalMethods ? emitGlobalMethods(schema, overrides.globalMethods, {
    twins: config.globalTypeTwins,
    models: id => shapes.get(id)?.kind === 'model' ? shapes.get(id)!.cs : undefined,
  }) : undefined;
  if (globals)
    for (const [path, content] of globals.files)
      files.set(path, content);

  const nativeGraphics = emitNativeGraphics(schema);
  for (const [path, content] of nativeGraphics.files)
    files.set(path, content);

  const signatures = unique.filter(s => s.kind === 'function').map(s => {
    const t = types.get(s.id)!;
    return {
      typeId: s.id,
      symbol: s.name!,
      signatures: s.signatures!,
      ...(t.target && t.typeArguments?.length ? { genericTarget: t.target, typeArguments: t.typeArguments } : {}),
    };
  });
  const manifest: GenerationResult['manifest'] = {
    formatVersion: 1,
    sourceHash: digest(JSON.stringify(schema)),
    entries,
    files: [...files].map(([path, content]) => ({
      path,
      sha256: digest(content),
      symbols: [
        ...events.symbols.get(path) ?? [],
        ...unique.flatMap(s =>
          s.file === path ? [
            s.name!,
            ...(s.kind === 'model'
              ? s.properties!.map(p => `${s.name}.${p.csName}`)
              : s.kind === 'union' || s.kind === 'tuple' ? [`${s.name}.IOptionValue.Write`, `${s.name}.Read`] : []),
          ]
            : path === serializerDir + s.name + '.Serializer.g.cs'
              ? [`GeneratedOptionMetadata.Write${s.name}`, `GeneratedOptionMetadata.Read${s.name}`]
              : []),
      ],
    })),
    signatures,
    families: familyGroups,
  };
  for (const shape of models.filter(s => s.index))
    manifest.files.find(f => f.path === shape.file)!.symbols.push(`${shape.name}.Entries`);

  for (const shape of manyStructs)
    manifest.files
      .find(f => f.path === valueDir + shape.struct + '.g.cs')!
      .symbols.push(shape.struct!, `${shape.struct}.IOptionValue.Write`, `${shape.struct}.Read`);

  for (const shape of models.filter(s => s.discriminator))
    manifest.files.find(f => f.path === shape.file)!.symbols.push(`${shape.name}.Type`);

  const standard = [...series]
    .filter(([, name]) => optionGroup(`option.series.${name}`).group === 'standard')
    .map(([typeId, name]) => ({ name, typeId }));
  const advanced = [...series]
    .filter(([, name]) => optionGroup(`option.series.${name}`).group === 'advanced')
    .map(([typeId, name]) => ({ name, typeId }));
  files.set('tests/BlazorECharts.Tests/GeneratedContracts/PublicContractCases.g.cs', emitSeriesTests(models, 'PublicContractCases'));
  if (group)
    manifest.files.push({
      path: 'src/BlazorECharts/Runtime/EChartInstance.Groups.cs',
      sha256: digest(readFileSync('src/BlazorECharts/Runtime/EChartInstance.Groups.cs', 'utf8')),
      symbols: ['EChartInstance.GetGroupAsync', 'EChartInstance.SetGroupAsync'],
    });

  const registry = schema.series.map(s => ({ name: s.name, typeId: s.type, ...optionGroup(`option.series.${s.name}`) }));
  if (new Set(registry.map(s => s.name)).size !== registry.length
    || registry.some(s => !['standard', 'advanced'].includes(s.group))
    || standard.length + advanced.length !== registry.length)
    throw new Error('Incomplete or duplicate whole series registry partition');

  files.set('docs/api-coverage/series-partition.json', generatedJson({
    formatVersion: 1,
    version: '6.1.0',
    series: registry,
    extensions: [{ name: 'wordCloud', group: 'wordcloud', family: 'wordcloud' }],
  }));
  for (const path of ['docs/api-coverage/series-partition.json']) {
    const content = files.get(path);
    if (content)
      manifest.files.push({ path, sha256: digest(content), symbols: [] });
  }

  // Completeness boundary: S sets must be mapped; every other record falls into a mechanical category.
  // Untyped: EChartsValue/NeverValue, a collection of them, or a model whose every member is one.
  const untyped = (shape: Shape): boolean => ['dynamic', 'never'].includes(shape.kind)
    || (['many', 'array', 'arraylike', 'dictionary'].includes(shape.kind) && !!shape.element && untyped(shape.element));
  const loose = (shape: Shape) =>
    untyped(shape) || (shape.kind === 'model' && !shape.index && shape.properties!.length > 0 && shape.properties!.every(p => untyped(p.shape)));
  const looseSymbols = new Set([
    ...models.filter(loose).map(s => s.name!),
    ...models.flatMap(s => s.properties!.filter(p => loose(p.shape)).map(p => `${s.name}.${p.csName}`)),
  ]);
  const manual = validateManualMappings(schema, manualCoverageMappings(overrides)).ids;
  const origin = buildOriginIndex();
  const scope = deriveScope({ schema, overrides, manifest, manual, declarations: new DeclarationIndex(schema, origin, read), looseSymbols, read });
  manifest.scopeCategories = scopeSummary(scope.assignments, id => scope.status.get(id)!).sets;
  files.set('docs/api-coverage/scope-categories-6.1.0.json', serializeScopeCategories(scope));
  files.set('docs/api-coverage/scope-origin-index-6.1.0.json', serializeOriginIndex(origin));
  for (const [file, content] of shardJson(manifest, manifestShards))
    files.set(`${manifestPath}/${file}`, content);

  // Compiled-contract tests need only the claimed CLR symbols, not the whole manifest.
  const generatedEntries = manifest.entries.filter(e => e.status === 'generated');
  files.set('tests/BlazorECharts.Tests/GeneratedContracts/ManifestSymbols.g.json', generatedJson({
    formatVersion: 1,
    eventActions: generatedEntries
      .filter(e => /^public:(events|action|runtime)\./.test(e.sourceId))
      .map(e => ({ sourceId: e.sourceId, runtimeName: e.runtimeName, symbol: e.symbol })),
    symbols: [...new Set(generatedEntries.flatMap(e => [e, ...e.targets ?? []].flatMap(t => [t.symbol, t.serializer, t.reader])))].sort(),
    signatures: manifest.signatures.map(s => ({ typeId: s.typeId, symbol: s.symbol })),
  }));

  // The snapshot is a mandatory checked-in baseline, independent of Roslyn's generated-code filtering.
  files.set('schemas/generated/public-api.txt', [...unique.map(s => [s.name!, s] as const), ...manyStructs.map(s => [s.struct!, s] as const)]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([, s]) => s.struct ? manyStructApi(s) : s.kind === 'model'
      ? `${s.cs}${s.discriminator ? ' : SeriesOption(' + s.discriminator + ')' : ' : OptionObject'}\n${s.initialValues ? '  .ctor initializes ' + JSON.stringify(s.initialValues) + '\n' : ''}${s.properties!.map(p => `  ${nullable(p.shape)} ${p.csName} [${p.name}]`).join('\n')}`
      : s.kind === 'function' ? `${s.name} : IJsFunctionSignature\n  static string Id [${s.id}]`
        : `${s.name} : IOptionValue, IJsonOnSerializing\n` + (s.kind === 'tuple'
          ? `  static ${s.name} Create(${s.elements!.map(nullable).join(', ')})\n  object? Value\n`
          + s.elements!.map((e, i) => `  ${nullable(e)} Item${i}`).join('\n')
          : [...new Set(s.alternatives!.map(a => a.cs))].map(
            cs => `  static ${s.name} From(${cs})\n  static implicit operator ${s.name}(${cs})`
          ).join('\n') + '\n  object? Value\n'
          + [...new Set(s.alternatives!.map(a => a.cs))]
            .map(cs => `  bool TryGet(out ${cs}${s.alternatives!.filter(a => a.cs === cs).every(isValueType) ? '' : '?'})`)
            .join('\n')
          + (builderElement(s) ? `\n  [CollectionBuilder] static ${s.name} Create(ReadOnlySpan<${builderElement(s)}>)\n  IEnumerator<${builderElement(s)}> GetEnumerator()` : '')))
    .join('\n')
    + '\nSeriesOption : OptionObject\n  protected SeriesOption(string type)\n  string Type { get; }\n' + events.publicApi + '\n');
  files.set('schemas/generated/public-api.txt', files.get('schemas/generated/public-api.txt')!
    + '\nIndexed option contracts\n'
    + models.filter(s => s.index).map(s => `${s.name}\n  OptionDictionary<${nullable(s.index!)}> Entries { get; }`).join('\n')
    + '\n');
  if (overrides.instanceMethods)
    files.set('docs/api-coverage/instance-methods-6.1.0.md', instanceMethodMarkdown(createInstanceMethodReport(schema, overrides.instanceMethods)));

  if (globals)
    files.set('schemas/generated/public-api.txt', files.get('schemas/generated/public-api.txt')! + '\nGlobal helper contracts\n' + globals.publicApi);

  files.set(
    'schemas/generated/public-api.txt',
    files.get('schemas/generated/public-api.txt')! + '\nNative browser contracts\n' + nativeGraphics.publicApi
  );
  files.set(
    'schemas/generated/public-api.txt',
    files.get('schemas/generated/public-api.txt')!
    + '\nTyped function binding reader\nJsFunction\n  static JsFunction<TSignature> FromBinding<TSignature>(JsBinding binding) where TSignature : IJsFunctionSignature\n'
  );
  const emittedNames = new Set([...shapes.values()].map(s => s.name));
  const warnings = [
    ...config.names.filter(n => !emittedNames.has(n.name)).map(n => `UNUSED_CSHARP_NAME ${n.name} ${n.typeId}`),
    ...config.defaults.filter(d => !usedDefaults.has(d)).map(d => `UNUSED_CSHARP_DEFAULT ${d.typeId}/${d.property}`),
    ...(config.variantDefaults ?? []).filter(d => !usedVariantDefaults.has(d)).map(d => `UNUSED_CSHARP_VARIANT_DEFAULT ${d.typeId}`),
    ...scope.warnings,
  ];
  const unions = [...shapes.values()].filter(s => s.kind === 'union' && s.file);
  return {
    files: new Map([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))),
    manifest,
    diagnostics: diagnostics.sort((a, b) => a.sourceId.localeCompare(b.sourceId, 'en')),
    scope,
    warnings,
    unions,
    emissionErrors: validateEmittedUnions(unions, files),
  };
}

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

interface MemberDoc {
  path?: string;
  defaultValue?: unknown;
}

/** The anchor of an echarts-doc path on the ECharts site, which joins variants with a hyphen: series-bar, dataZoom-inside, graphic.elements-rect. */
const optionAnchor = (path: string) =>
  path.replace(/^(series|dataZoom|visualMap)\.(\w+)/, '$1-$2').replace(/^graphic\.elements\.(\w+)/, 'graphic.elements-$1');

const optionPage = (path: string) => 'https://echarts.apache.org/en/option.html' + (path ? '#' + encodeURI(optionAnchor(path)) : '');

/** The echarts-doc default, written as echarts-doc gives it. */
const defaultRemark = (value?: unknown) => {
  const text = value === undefined || value === null ? undefined : String(value).replace(/\s+/g, ' ').trim();
  return text && text !== '-' && text.length <= 80 ? `\n    /// <remarks>ECharts default: <c>${escapeXml(text)}</c>.</remarks>` : '';
};

/** The alternatives of a union in words: literals by value, the rest by kind or C# type. */
function describeAlternatives(shape: Shape): string {
  const literals = shape.alternatives!.filter(a => a.literal !== undefined).map(a => `<c>${escapeXml(JSON.stringify(a.literal))}</c>`);
  const kind = (s: Shape): string => s.kind === 'number' ? 'a number' : s.kind === 'string' ? 'a string' : s.kind === 'boolean' ? 'a boolean'
    : s.kind === 'date' ? 'a date' : s.kind === 'reference' ? 'a browser object reference' : s.kind === 'dynamic' ? 'any JSON value'
      : s.kind === 'function'
        ? `a browser callback (<c>${escapeXml(s.cs)}</c>)`
        : s.kind === 'array' ? `an array of ${s.element ? kind(s.element).replace(/^an? /, '') : 'values'}`
          : `<c>${escapeXml(s.cs)}</c>`;
  const order = ['number', 'string', 'boolean', 'date'];
  const others = [
    ...new Set(shape.alternatives!
      .filter(a => a.literal === undefined)
      .sort((a, b) => (order.indexOf(a.kind) + 1 || 9) - (order.indexOf(b.kind) + 1 || 9))
      .map(kind)),
  ];
  if (!others.length)
    return literals.length === 1 ? `The value ${literals[0]}.` : `One of ${list(literals)}.`;

  const parts = [...others, ...(literals.length > 1 ? [`one of ${list(literals)}`] : literals)];
  return parts.length === 1
    ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)}.`
    : `${(parts.slice(0, -1).join(', '))[0].toUpperCase()}${parts.slice(0, -1).join(', ').slice(1)} or ${parts.at(-1)}.`;
}

const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

const tsOnly =
  '\n    /// <remarks>Not described by echarts-doc; the contract follows the pinned TypeScript declarations of the upstream release.</remarks>';

function emitModel(shape: Shape, documented: Map<string, MemberDoc>, paths: Map<string, number> | undefined, componentLists: string[]): string {
  // The option page of a model: the path most of its documented members are under.
  const path = [...paths ?? []].sort(([a, x], [b, y]) => y - x || a.length - b.length || a.localeCompare(b, 'en'))[0]?.[0];
  const summary = path === undefined ? 'An ECharts option object that the TypeScript declarations describe.'
    : path === '' ? 'The ECharts option object.' : paths!.size > 1
      ? `An ECharts option object, for example <c>${escapeXml(optionAnchor(path))}</c>.`
      : `The ECharts <c>${escapeXml(optionAnchor(path))}</c> option.`;
  return header + usings + `\nnamespace BlazorECharts.Options;\n\n/// <summary>${summary}</summary>\n${path === undefined ? '' : `/// <seealso href="${optionPage(path)}"/>\n`}public sealed partial class ${shape.name} : ${shape.discriminator ? 'SeriesOption' : 'OptionObject'}\n{\n`
    + (shape.discriminator ? `    /// <summary>Creates the ${shape.discriminator} series.</summary>\n    public ${shape.name}() : base(${quote(shape.discriminator)}) { }\n` : '')
    + (shape.initialValues ? `    /// <summary>Creates the ${escapeXml(shape.initialValues.type)} variant; it writes its type itself.</summary>\n    public ${shape.name}() : this(true) { }\n    internal ${shape.name}(bool initializeDefaults) { if (initializeDefaults) { ${Object.entries(shape.initialValues).map(([key, value]) => `${shape.properties!.find(p => p.name === key)!.csName} = ${quote(value)};`).join(' ')} } }\n` : '')
    + componentLists.map(list => `    /// <summary>Converts the variant to a single component, as <c>${escapeXml(list)}.One</c> does.</summary>\n    public static implicit operator ${list}(${shape.name} value) => ${list}.One(value);\n`).join('')
    + (shape.index ? `    /// <summary>Gets typed entries allowed by the upstream string index signature.</summary>\n    public OptionDictionary<${nullable(shape.index)}> Entries { get; } = new();\n` : '')
    + shape.properties!.map((p, i) => {
      // A variant writes its own type: reading a snapshot sets it, an author cannot reset it.
      const variantType = !!shape.initialValues && p.name === 'type';
      const summary = p.summary
        ? escapeXml(p.summary)
        : variantType ? 'Gets <c>type</c>, which the variant writes itself.' : `Gets or sets <c>${escapeXml(p.name)}</c>.`;
      const obsolete = p.deprecated === undefined
        ? ''
        : `\n    [Obsolete(${quote(`Deprecated in ECharts 6.1.0${p.deprecated ? ': ' + p.deprecated : '.'}`)})]`;
      return `    private ${nullable(p.shape)} _p${i}${p.defaultValue === undefined ? '' : ' = ' + p.defaultValue};\n    /// <summary>${summary}</summary>${documented.has(`${shape.id}/${p.name}`) ? defaultRemark(documented.get(`${shape.id}/${p.name}`)!.defaultValue) : tsOnly}${obsolete}\n    public ${nullable(p.shape)} ${p.csName} { get => _p${i}; ${variantType ? 'internal ' : ''}set => SetProperty(ref _p${i}, value, ${quote(p.name)}); }`;
    }).join('\n') + '\n}\n';
}

const valueKinds = new Set(['union', 'tuple', 'many', 'arraylike', 'dynamic', 'never', 'number', 'boolean', 'date']);
const isValueType = (s: Shape) => valueKinds.has(s.kind);
const valueDoc = '    /// <summary>Gets the stored alternative: the value passed to <c>From</c>; for a value read from JSON, such as a getOption snapshot, the alternative that <c>TryGet</c> decoded, otherwise its <see cref="EChartsValue"/> JSON.</summary>\n    public object? Value => _value is ReadValue read ? read.Current : _value;\n';

/** Typed read access to one alternative, also when the value was read from JSON. Functions and native values only exist as constructed. */
function emitTryGet(cs: string, shapes: Shape[], condition = '', json = true): string {
  const valueType = shapes.every(isValueType);
  const declaration = valueType ? `out ${cs} value` : `[NotNullWhen(true)] out ${cs}? value`;
  const expression = read(shapes[0], 'json', 'ReadContext');

  // Value-type reads are nullable for JSON null, which the branch already excludes.
  const assigned = !valueType ? `(${expression})!` : shapes[0].kind === 'dynamic' ? expression : `(${expression}).GetValueOrDefault()`;
  const valid = shapes.map(s => matches(s, 'json'));
  const fromJson = !json || shapes.every(s => ['function', 'reference', 'never'].includes(s.kind)) ? ''
    : (valueType ? '' : `        if (_value is ReadValue { Decoded: ${cs} cached }) { value = cached; return true; }\n`)
    + `        if (ReadValue.TryGetJson(_value, out var json) && json.ValueKind != JsonValueKind.Null${valid.includes('true') ? '' : ` && (${valid.join(' || ')})`}${condition})\n        {\n`
    + `            value = ${assigned};\n${valueType ? '' : `            if (_value is ReadValue read) value = read.Materialize(value);\n`}            return true;\n        }\n`;
  return `    /// <summary>Gets the ${cs.replaceAll('<', '&lt;')} alternative, also from a value read from JSON.</summary>\n    public bool TryGet(${declaration})\n    {\n        if (_value is ${cs} typed) { value = typed; return true; }\n${fromJson}        value = default;\n        return false;\n    }\n`;
}

/**
 * The model alternative that a JSON object reads as, when several match: a variant whose type the JSON names comes first,
 * then the model that knows every JSON key with the fewest members. Models with the same members are one JSON shape.
 */
function modelResolution(models: Shape[]): string {
  if (models.length < 2)
    return '';

  const keys = models.map(m => [...new Set(m.properties!.map(p => p.name))].sort());
  return `    private static readonly (Func<JsonElement, bool> Matches, bool Variant, HashSet<string> Keys)[] Models =\n    [\n`
    + models.map((m, i) => `        (json => ${matches(m, 'json')}, ${m.initialValues?.type ? 'true' : 'false'}, new(StringComparer.Ordinal) { ${keys[i].map(k => quote(k)).join(', ')} }),\n`).join('')
    + `    ];\n    private static bool IsModel(JsonElement json, int index)\n    {\n`
    + `        var candidates = Enumerable.Range(0, Models.Length).Where(i => Models[i].Matches(json)).ToList();\n`
    + `        if (candidates.Any(i => Models[i].Variant)) candidates.RemoveAll(i => !Models[i].Variant);\n`
    + `        int Unknown(int i) => json.EnumerateObject().Count(p => !Models[i].Keys.Contains(p.Name));\n`
    + `        var best = candidates.OrderBy(Unknown).ThenBy(i => Models[i].Keys.Count).ThenBy(i => i).FirstOrDefault(-1);\n`
    + `        return best >= 0 && candidates.Contains(index) && Models[index].Keys.SetEquals(Models[best].Keys);\n    }\n`;
}

/** DateTime and DateOnly for a date alternative: Utc and Local are instants, Unspecified and DateOnly stay wall-clock values without offset. */
const dateConversions = (name: string) =>
  `    /// <summary>Creates the date alternative from a DateTime. A Utc or Local value is that instant; an Unspecified value is a wall-clock time without offset, which ECharts reads in the browser's time zone.</summary>\n`
  + `    public static ${name} From(DateTime value) => value.Kind == DateTimeKind.Unspecified ? new(value.ToString("yyyy-MM-ddTHH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture)) : new(new DateTimeOffset(value));\n`
  + `    /// <summary>Converts a DateTime as <see cref="From(DateTime)"/> does.</summary>\n    public static implicit operator ${name}(DateTime value) => From(value);\n`
  + `    /// <summary>Creates the date alternative from a DateOnly as yyyy-MM-dd, which ECharts reads as midnight in the browser's time zone.</summary>\n`
  + `    public static ${name} From(DateOnly value) => new(value.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture));\n`
  + `    /// <summary>Converts a DateOnly as <see cref="From(DateOnly)"/> does.</summary>\n    public static implicit operator ${name}(DateOnly value) => From(value);\n`;

/** .NET names of DOM-style lowercase upstream members: onclick -> OnClick, ondblclick -> OnDoubleClick, as for event names. */
const domMemberNames: Record<string, string> = Object.fromEntries([
  ['onclick', 'OnClick'],
  ['ondblclick', 'OnDoubleClick'],
  ['oncontextmenu', 'OnContextMenu'],
  ['onload', 'OnLoad'],
  ['onmousedown', 'OnMouseDown'],
  ['onmouseup', 'OnMouseUp'],
  ['onmousemove', 'OnMouseMove'],
  ['onmouseover', 'OnMouseOver'],
  ['onmouseout', 'OnMouseOut'],
  ['onmousewheel', 'OnMouseWheel'],
  ['ondrag', 'OnDrag'],
  ['ondragstart', 'OnDragStart'],
  ['ondragend', 'OnDragEnd'],
  ['ondragenter', 'OnDragEnter'],
  ['ondragleave', 'OnDragLeave'],
  ['ondragover', 'OnDragOver'],
  ['ondrop', 'OnDrop'],
]);

/** The text of the @deprecated JSDoc tag right above a pinned echarts or zrender declaration, or undefined without one. */
function upstreamDeprecation(schema: ApiSchema): (provenance: string[]) => string | undefined {
  const read = upstreamSourceReader();
  const sources = new Map(schema.provenance.map(p => [p.id, p]));
  const files = new Map<string, string[]>();
  const tag = (id: string) => {
    const source = sources.get(id);
    if (!source || !['echarts', 'zrender'].includes(source.package))
      return undefined;

    const key = source.package + '/' + source.file;
    if (!files.has(key))
      files.set(key, (read(source.package, source.file) ?? '').split('\n'));

    const lines = files.get(key)!;
    let i = source.start.line - 2;
    if (!lines[i]?.trim().endsWith('*/'))
      return undefined;

    const doc: string[] = [];
    for (; i >= 0 && !lines[i].includes('/**'); i--)
      doc.unshift(lines[i]);

    doc.unshift(lines[i] ?? '');
    const match = /@deprecated([^@]*)/.exec(doc.join('\n'));
    if (!match)
      return undefined;

    // The tag text up to its replacement hint; the rest of the comment describes the member.
    const sentences = match[1].replace(/\*\/\s*$/, '').replace(/\n\s*\*/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=\.)\s+/).filter(Boolean);
    const hint = sentences.findIndex(s => /\binstead\b|^use\b/i.test(s));
    const text = sentences.slice(0, hint < 0 ? 1 : hint + 1).join(' ');
    return text && !text.endsWith('.') ? text + '.' : text;
  };
  return provenance => provenance.map(tag).find(text => text !== undefined);
}

/** The implicit conversions of a union: one per CLR type of its alternatives, and DateTime/DateOnly for a date. */
const conversions = (union: Shape) => {
  const types = [...new Set(union.alternatives!.map(a => a.cs))];
  return types.includes('DateTimeOffset') ? [...types, 'DateTime', 'DateOnly'] : types;
};

function manyStructApi(shape: Shape): string {
  const name = shape.struct!;
  const item = nullable(shape.element!);
  return `${name} : IOptionValue, IJsonOnSerializing [CollectionBuilder]\n  static ${name} One(${item})\n  static ${name} Many(params ${item}[])\n  static ${name} Create(ReadOnlySpan<${item}>)\n`
    + [...conversions(shape.element!), shape.element!.cs, item + '[]'].map(cs => `  static implicit operator ${name}(${cs})`).join('\n')
    + `\n  bool IsMany\n  bool TryGetOne(out ${item})\n  IReadOnlyList<${item}> Items\n  IEnumerator<${item}> GetEnumerator()`;
}

function emitManyStruct(shape: Shape): string {
  const name = shape.struct!;
  const element = shape.element!;
  const union = element.name!;
  const item = nullable(element);
  const conversion = (cs: string, summary: string) =>
    `    /// <summary>${summary}</summary>\n    public static implicit operator ${name}(${cs} value) => One(value);\n`;
  return header + usings + 'using System.Linq;\nusing System.Runtime.CompilerServices;\nusing System.Text.Json.Serialization;\nusing BlazorECharts.Serialization.Generated;\nusing static BlazorECharts.Serialization.Generated.GeneratedOptionMetadata;\n\nnamespace BlazorECharts.Values;\n\n'
    + `/// <summary>One <see cref="${union}"/> or an array of them. A one-element array retains its array shape.</summary>\n`
    + `/// <remarks>Each alternative of <see cref="${union}"/> converts to <see cref="One"/>, an array or a collection expression to <see cref="Many"/>.\n/// The default struct value is uninitialized and cannot be serialized.</remarks>\n`
    + `[CollectionBuilder(typeof(${name}), nameof(Create))]\npublic readonly struct ${name} : IOptionValue, IJsonOnSerializing, IReadableOptionValue<${name}>\n{\n`
    + `    private readonly OneOrMany<${item}> _value;\n    private ${name}(OneOrMany<${item}> value) => _value = value;\n`
    + `    /// <summary>Creates the scalar form, including a null scalar.</summary>\n    public static ${name} One(${item} value) => new(OneOrMany<${item}>.One(value));\n`
    + `    /// <summary>Creates the array form, copying its container and preserving order, nulls and empty arrays.</summary>\n    public static ${name} Many(params ${item}[] values) => new(OneOrMany<${item}>.Many(values));\n`
    + `    /// <summary>Creates the array form of a collection expression, also for one or no element.</summary>\n    public static ${name} Create(ReadOnlySpan<${item}> values) => new(OneOrMany.Create(values));\n`
    + conversions(element)
      .map(cs => conversion(cs, `Converts the ${escapeXml(cs)} alternative to the scalar form, as <see cref="${union}"/> does.`))
      .join('')
    + conversion(union, 'Converts a value to the scalar form, as <see cref="One"/> does.')
    + `    /// <summary>Converts an array to the array form, as <see cref="Many"/> does.</summary>\n    public static implicit operator ${name}(${item}[] values) => Many(values);\n`
    + `    /// <summary>Gets whether this value is the array form, including a value read from JSON.</summary>\n    public bool IsMany => _value.IsMany;\n`
    + `    /// <summary>Gets the scalar form. Returns false for an array or an uninitialized value.</summary>\n    public bool TryGetOne(out ${item} value) => _value.TryGetOne(out value);\n`
    + `    /// <summary>Gets the array elements, or the scalar as a single item. Throws for an uninitialized value.</summary>\n    public IReadOnlyList<${item}> Items => _value.Items;\n`
    + `    /// <summary>Enumerates <see cref="Items"/>.</summary>\n    public IEnumerator<${item}> GetEnumerator() => _value.GetEnumerator();\n`
    + `    internal static bool Matches(JsonElement json) => ${matches({ ...shape, struct: undefined }, 'json')};\n`
    + `    internal static ${name} Read(JsonElement json) => new(ReadOneOrMany<${item}>(json, item => (${read(element, 'item', 'ReadContext')})!, itemOne => ${matches(element, 'itemOne')}));\n`
    + `    static bool IReadableOptionValue<${name}>.Matches(JsonElement json) => Matches(json);\n    static ${name} IReadableOptionValue<${name}>.Read(JsonElement json) => Read(json);\n`
    + `    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path) => ((IOptionValue)_value).Write(writer, context, path);\n`
    + `    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(typeof(${name}));\n}\n`;
}

/** The element of a series data union of an item array and a typed array (scatter, lines): a collection expression builds the item array. */
export const builderElement = (shape: Shape) => {
  const arrays = shape.kind === 'union' ? shape.alternatives!.filter(a => a.kind === 'array') : [];
  return arrays.length === 1 && shape.alternatives!.every(a => a.kind === 'array' || a.kind === 'arraylike')
    ? nullable(arrays[0].element!)
    : undefined;
};

function emitValue(shape: Shape): string {
  const name = shape.name!;
  const item = builderElement(shape);
  let body: string;
  if (shape.kind === 'tuple') {
    body = `    /// <summary>Creates a fixed-length tuple without collapsing its array shape.</summary>\n    public static ${name} Create(${shape.elements!.map((s, i) => `${nullable(s)} item${i}`).join(', ')}) => new(new object?[] { ${shape.elements!.map((_, i) => 'item' + i).join(', ')} });\n`
      + `    internal static bool Matches(JsonElement json) => json.ValueKind == JsonValueKind.Array && json.GetArrayLength() == ${shape.elements!.length}${shape.elements!.map((s, i) => nullOr(`json[${i}]`, matches(s, `json[${i}]`))).filter(c => c !== 'true').map(c => ` && (${c})`).join('')};\n`
      + valueDoc + shape.elements!
        .map((s, i) => `    /// <summary>Gets element ${i}, also from a value read from JSON.</summary>\n    public ${nullable(s)} Item${i} => _value is object?[] items ? (${nullable(s)})items[${i}] : ReadValue.TryGetJson(_value, out var json) && json.ValueKind == JsonValueKind.Array && json.GetArrayLength() > ${i} ? ${read(s, `json[${i}]`, 'ReadContext')} : default;\n`)
        .join('');
  } else {
    const groups = new Map<string, Shape[]>();
    for (const s of shape.alternatives!)
      groups.set(s.cs, [...groups.get(s.cs) ?? [], s]);

    const models = shape.alternatives!.filter(a => a.kind === 'model');

    // An ArrayLike reads a JSON array only when no plain array alternative reads it too.
    const arrays = (alternative: Shape) => alternative.kind !== 'arraylike'
      ? ''
      : shape.alternatives!.filter(a => a.kind === 'array' || a.kind === 'many').map(a => ` && !(${matches(a, 'json')})`).join('');
    body = [...groups].map(([cs, ss]) => {
      const validate = ss.every(s => s.literal !== undefined)
        ? `        if (!(${ss.map(s => 'value == ' + JSON.stringify(s.literal)).join(' || ')})) throw new ArgumentException("Value is outside the upstream literal union.", nameof(value));\n`
        : '';
      return `    /// <summary>Creates the ${cs.replaceAll('<', '&lt;')} alternative with exact literal validation.</summary>\n    public static ${name} From(${cs} value)\n    {\n${validate}        return new(value);\n    }\n    /// <summary>Converts a supported alternative, preserving its JSON shape.</summary>\n    public static implicit operator ${name}(${cs} value) => From(value);\n`;
    }).join('\n')
      + (groups.has('DateTimeOffset') ? dateConversions(name) : '')
      + `    internal static bool Matches(JsonElement json) => ${anyOf(shape.alternatives!.map(s => matches(s, 'json')))};\n`
      + valueDoc
      + [...groups].map(
        ([cs, ss]) => emitTryGet(cs, ss, models.length > 1 && ss[0].kind === 'model' ? ` && IsModel(json, ${models.indexOf(ss[0])})` : arrays(ss[0]))
      ).join('')
      + modelResolution(models)
      + (item ? `    /// <summary>Creates the item array of a collection expression.</summary>\n    public static ${name} Create(ReadOnlySpan<${item}> values) => From(values.ToArray());\n`
        + `    /// <summary>Enumerates the item array. The typed-array alternative has no items: read it with <c>TryGet</c>.</summary>\n`
        + `    public IEnumerator<${item}> GetEnumerator() => ((IEnumerable<${item}>)(TryGet(out ${item}[]? items) ? items : throw new InvalidOperationException("The typed-array alternative has no items; read it with TryGet."))).GetEnumerator();\n` : '');
  }

  return header + usings + 'using System.Diagnostics.CodeAnalysis;\nusing System.Linq;\nusing System.Text.Json.Serialization;\nusing BlazorECharts.Serialization.Generated;\nusing static BlazorECharts.Serialization.Generated.GeneratedOptionMetadata;\n\nnamespace BlazorECharts.Values;\n\n'
    + `/// <summary>${shape.kind === 'tuple' ? `A fixed-length array of ${shape.elements!.length} values.` : describeAlternatives(shape)}</summary>\n${item ? `[System.Runtime.CompilerServices.CollectionBuilder(typeof(${name}), nameof(Create))]\n` : ''}public readonly struct ${name} : IOptionValue, IJsonOnSerializing, IReadableOptionValue<${name}>, IScalarOptionValue\n{\n    private readonly object? _value;\n    private readonly bool _initialized;\n    private ${name}(object? value) { _value = value; _initialized = true; }\n${body}\n    void IJsonOnSerializing.OnSerializing() => throw new NestedOptionValueException(typeof(${name}));\n`
    + `    internal static ${name} Read(JsonElement json)\n    {\n        if (!Matches(json)) throw new JsonException("Invalid ${name} alternative.");\n        return new(new ReadValue(json));\n    }\n    static bool IReadableOptionValue<${name}>.Matches(JsonElement json) => Matches(json);\n    static ${name} IReadableOptionValue<${name}>.Read(JsonElement json) => Read(json);\n    void IOptionValue.Write(Utf8JsonWriter writer, EChartsSerializationContext context, string path)\n    {\n        if (!_initialized) throw new OptionSerializationException("Uninitialized ${name}.", path, typeof(${name}));\n        context.WriteValue(writer, _value, path);\n    }\n    bool IScalarOptionValue.TryWriteScalar(Utf8JsonWriter writer, EChartsSerializationContext context) => _initialized && context.TryWriteScalar(writer, _value);\n}\n`;
}

/** Where the core generation writes: its Generated directories and manifest, and its own files beside hand-written ones. */
export const coreOutputs: OutputScope[] = [
  ...[modelDir, serializerDir, valueDir, 'src/BlazorECharts/Events/Generated/', 'src/BlazorECharts/Runtime/Generated/', manifestPath + '/'].map(
    dir => ({ dir, recursive: true })
  ),
  { dir: 'tests/BlazorECharts.Tests/GeneratedContracts/', owns: name => /\.g\.\w+$/.test(name) },
  { dir: 'src/BlazorECharts/JavaScript/', owns: name => name.endsWith('.generated.ts') },
  { dir: 'docs/api-coverage/', owns: name => name !== 'reconciliation.md' && !name.startsWith('wordcloud-') },
  { dir: 'schemas/generated/', owns: name => !name.startsWith('wordcloud-') },
];

/** Check mode never writes files; missing snapshots, stale output and unexpected files all fail. */
export async function writeGeneration(result: GenerationResult, root: string, check: boolean): Promise<void> {
  for (const [path, content] of result.files) {
    let actual: string | undefined;
    try {
      actual = await readFile(join(root, path), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw e;
    }

    if (check) {
      if (actual === undefined)
        throw new Error(`Missing generated baseline: ${path}`);

      if (actual !== content)
        throw new Error(`Generated drift: ${path}`);
    } else if (actual !== content) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
  }

  await removeStaleFiles(result.files.keys(), root, coreOutputs, check);
}
