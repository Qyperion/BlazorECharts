import type { Shape } from './generation-model.ts';
import { header, nullable } from './generation-model.ts';

/** Compiled conformance corpus: all reachable value alternatives and every model property. */
export function emitSeriesTests(roots: Shape[], className = 'StandardSeriesContractCases') {
  const reachable = new Map<string, Shape>();
  const visit = (s: Shape): void => {
    if (reachable.has(s.id))
      return;

    reachable.set(s.id, s);
    for (const p of s.properties ?? [])
      visit(p.shape);

    for (const a of s.alternatives ?? s.elements ?? [])
      visit(a);

    if (s.element)
      visit(s.element);

    if (s.index)
      visit(s.index);
  };
  roots.forEach(visit);
  type Sample = { cs: string; json: unknown; bindings: number };

  function sample(s: Shape, depth = 0): Sample | undefined {
    if (s.literal !== undefined)
      return { cs: JSON.stringify(s.literal) + (typeof s.literal === 'number' ? 'd' : ''), json: s.literal, bindings: 0 };

    switch (s.kind) {
      case 'string':
        return { cs: '"sample"', json: 'sample', bindings: 0 };
      case 'number':
        return { cs: '2d', json: 2, bindings: 0 };
      case 'boolean':
        return { cs: 'false', json: false, bindings: 0 };
      case 'dynamic':
        return { cs: 'SampleData()', json: { value: 2 }, bindings: 0 };
      case 'reference':
        return { cs: '(EChartsObjectReference)null!', json: null, bindings: 0 };
      case 'date':
        return { cs: 'new DateTimeOffset(2026, 10, 19, 14, 0, 0, 500, new TimeSpan(5, 30, 0))', json: '2026-10-19T08:30:00.500Z', bindings: 0 };
      case 'model': {
        if (!s.required?.length)
          return { cs: `new ${s.cs}()`, json: s.discriminator ? { type: s.discriminator } : s.initialValues ?? {}, bindings: 0 };

        if (depth > 12)
          return;

        const fields = s.properties!.filter(p => s.required!.includes(p.name)).map(p => ({ p, value: sample(p.shape, depth + 1) }));
        if (fields.some(f => !f.value))
          return;

        return {
          cs: `new ${s.cs} { ${fields.map(f => `${f.p.csName} = ${f.value!.cs}`).join(', ')} }`,
          json: Object.fromEntries(fields.map(f => [f.p.name, f.value!.json])),
          bindings: fields.reduce((n, f) => n + f.value!.bindings, 0),
        };
      }
      case 'series': {
        const series = roots.find(s => s.discriminator);
        return series && { cs: `new ${series.cs}()`, json: { type: series.discriminator }, bindings: 0 };
      }
      case 'function':
        return { cs: `JsFunction.Module<${s.name}>("/modules/series-functions.js", "format")`, json: null, bindings: 1 };
      case 'array':
        return { cs: `new ${nullable(s.element!)}[0]`, json: [], bindings: 0 };
      case 'arraylike':
        return { cs: `${s.cs}.From(new ${nullable(s.element!)}[0])`, json: [], bindings: 0 };
      case 'dictionary':
        return { cs: `new ${s.cs}()`, json: {}, bindings: 0 };
      case 'many': {
        // A non-empty array element: an empty [] cannot tell one array from many.
        const inner = s.element!.kind === 'array' ? sample(s.element!.element!, depth + 1) : undefined;
        if (inner)
          return { cs: `${s.cs}.One(new ${nullable(s.element!.element!)}[] { ${inner.cs} })`, json: [inner.json], bindings: inner.bindings };

        const v = sample(s.element!, depth + 1);
        return v && { cs: `${s.cs}.One(${v.cs})`, json: v.json, bindings: v.bindings };
      }
      case 'tuple': {
        const all = s.elements!.map(e => sample(e, depth + 1));
        if (all.some(v => !v))
          return;

        return {
          cs: `${s.name}.Create(${all.map(v => v!.cs).join(', ')})`,
          json: all.map(v => v!.json),
          bindings: all.reduce((n, v) => n + v!.bindings, 0),
        };
      }
      case 'union': {
        if (depth > 12)
          return;

        for (const a of s.alternatives!) {
          const v = sample(a, depth + 1);
          if (v)
            return { cs: `${s.name}.From(${v.cs})`, json: v.json, bindings: v.bindings };
        }

        return;
      }
      default:
        return;
    }
  }

  const values: string[] = [];
  const native: string[] = [];
  const properties: string[] = [];
  for (const s of reachable.values()) {
    if (s.kind === 'union')
      for (const a of s.alternatives!) {
        if (a.kind === 'never') {
          native.push(`    public static ${s.name} Alternative${native.length}(${a.cs} value) => ${s.name}.From(value);`);
          continue;
        }

        const v = sample(a);
        if (!v)
          throw new Error(`No standard union conformance sample ${s.id}/${a.id}`);

        values.push(`        yield return (${JSON.stringify(s.id + '/' + a.id)}, EChartsValue.From(${s.name}.From(${v.cs})), ${JSON.stringify(JSON.stringify(v.json))}, ${v.bindings});`);
      }

    if (s.kind === 'tuple') {
      const v = sample(s);
      if (!v)
        throw new Error(`No standard tuple conformance sample ${s.id}`);

      values.push(
        `        yield return (${JSON.stringify(s.id)}, EChartsValue.From(${v.cs}), ${JSON.stringify(JSON.stringify(v.json))}, ${v.bindings});`
      );
    }

    if (s.kind === 'model')
      for (const p of s.properties ?? []) {
        const v = sample(p.shape);
        if (!v) {
          if (['reference', 'never'].includes(p.shape.kind))
            continue;

          throw new Error(`No standard member conformance sample ${p.sourceId}`);
        }

        const required = s.properties!
          .filter(other => other !== p && s.required?.includes(other.name))
          .map(other => ({ p: other, value: sample(other.shape) }));
        if (required.some(f => !f.value))
          throw new Error(`No required member conformance sample ${p.sourceId}`);

        const fields = [...required.map(f => `${f.p.csName} = ${f.value!.cs}`), `${p.csName} = ${v.cs}`].join(', ');
        properties.push(`        yield return (${JSON.stringify(p.sourceId)}, new ${s.cs} { ${fields} }, ${JSON.stringify(p.name)}, ${JSON.stringify(JSON.stringify(v.json))}, ${v.bindings + required.reduce((n, f) => n + f.value!.bindings, 0)}, json => GeneratedOptionMetadata.Read${s.name}(json));`);
      }
  }

  const usings = 'using System.Text.Json;\nusing BlazorECharts.Options;\nusing BlazorECharts.Runtime;\nusing BlazorECharts.Serialization;\nusing BlazorECharts.Serialization.Generated;\nusing BlazorECharts.Values;\nusing BlazorECharts.Values.Signatures;\n';

  // Bound each iterator's JIT frame. A single corpus-wide MoveNext can exhaust
  // the Windows testhost stack before yielding even its first property.
  const batches = (name: string, type: string, lines: string[]): string => {
    const chunks = Array.from({ length: Math.ceil(lines.length / 128) }, (_, i) => lines.slice(i * 128, (i + 1) * 128));
    return `    public static IEnumerable<${type}> ${name}()\n    {\n`
      + chunks.map((_, i) => `        foreach (var item in ${name}${i}()) yield return item;`).join('\n') + '\n    }\n'
      + chunks.map((chunk, i) => `    private static IEnumerable<${type}> ${name}${i}()\n    {\n${chunk.join('\n')}\n    }\n`).join('');
  };

  // The corpus covers upstream-deprecated members too.
  return header
    + '#pragma warning disable CS0618\n'
    + usings
    + `\nnamespace BlazorECharts.Tests.GeneratedContracts;\n\ninternal static class ${className}\n{\n`
    + batches('Values', '(string Id, EChartsValue Value, string Json, int Bindings)', values)
    + batches(
      'Properties',
      '(string Id, OptionObject Value, string Key, string Json, int Bindings, Func<JsonElement, OptionObject> Read)',
      properties
    )
    + `    public static SeriesOption[] CreateSeries() => [${roots.filter(s => s.discriminator).map(s => `new ${s.cs}()`).join(', ')}];\n`
    + '    private static EChartsValue SampleData() { using var document=JsonDocument.Parse("{\\\"value\\\":2}"); return EChartsValue.FromJson(document.RootElement); }\n'
    + native.join('\n')
    + '\n}\n';
}
