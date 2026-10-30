import { header, usings, nullable, manyElement, quote, type Shape } from './generation-model.ts';

export function read(shape: Shape, json: string, ctx = 'context'): string {
  const nullCase = (value: string) => `${json}.ValueKind == JsonValueKind.Null ? (${nullable(shape)})null : ${value}`;
  const item = 'item' + shape.id.slice(-8).replace(/[^A-Za-z0-9_]/g, '_');
  switch (shape.kind) {
    case 'string':
      return `${json}.GetString()`;
    case 'number':
      return nullCase(`${json}.GetDouble()`);
    case 'boolean':
      return nullCase(`${json}.GetBoolean()`);
    case 'date':
      return nullCase(`${json}.GetDateTimeOffset()`);
    case 'reference':
      return `${json}.ValueKind == JsonValueKind.Null ? null : throw new JsonException("Native values require separate bindings.")`;
    case 'never':
      return `${json}.ValueKind == JsonValueKind.Null ? (NeverValue?)null : throw new JsonException("Uninhabitable upstream value.")`;
    case 'dictionary':
      return nullCase(`GeneratedOptionMetadata.ReadDictionary<${nullable(shape.element!)}>(${json}, ${item} => ${read(shape.element!, item, ctx)})`);
    case 'arraylike':
      return nullCase(`OptionArrayLike<${nullable(shape.element!)}>.From(ReadArray<${nullable(shape.element!)}>(${json}, ${item} => ${read(shape.element!, item, ctx)}))`);
    case 'dynamic':
      return `EChartsValue.FromJson(${json})`;
    case 'series':
      return nullCase(`${ctx}.ReadSeries(${json})`);
    case 'model':
      return nullCase(`Read${shape.name}(${json}, ${ctx})`);
    case 'union':
    case 'tuple':
      return nullCase(`${shape.name}.Read(${json})`);
    case 'function':
      return `${json}.ValueKind == JsonValueKind.Null ? null : throw new JsonException("Function values require separate binding descriptors.")`;
    case 'array':
      return nullCase(`ReadArray<${nullable(shape.element!)}>(${json}, ${item} => ${read(shape.element!, item, ctx)})`);
    // The same order as the matcher: a value of the element itself, such as a flat array of an array element, is one.
    case 'many':
      if (shape.struct)
        return nullCase(`${shape.struct}.Read(${json})`);

      return nullCase(`ReadOneOrMany<${manyElement(shape.element!)}>(${json}, ${item} => (${read(shape.element!, item, ctx)})!, ${item}One => ${matches(shape.element!, item + 'One')})`);
  }
}

// Constant matchers ('true' for any JSON, 'false' for never) fold away: no emitted condition has an always-true operand or an unreachable branch.
export const anyOf = (conditions: string[]) =>
  conditions.includes('true') ? 'true' : conditions.filter(c => c !== 'false').map(c => `(${c})`).join(' || ') || 'false';

export const nullOr = (json: string, condition: string) =>
  condition === 'true'
    ? 'true'
    : condition === 'false' ? `${json}.ValueKind == JsonValueKind.Null` : `${json}.ValueKind == JsonValueKind.Null || (${condition})`;

const all = (items: string, item: string, json: string, element: Shape) => {
  const condition = nullOr(json, matches(element, json));
  return condition === 'true' ? '' : ` && ${items}.All(${item} => ${condition})`;
};

// Shape validation is generated from alternatives, not inferred from a C# runtime type.
export function matches(shape: Shape, json: string): string {
  const item = 'item' + shape.id.slice(-8).replace(/[^A-Za-z0-9_]/g, '_');
  if (shape.literal !== undefined)
    return `${json}.ValueKind == JsonValueKind.${typeof shape.literal === 'string' ? 'String' : typeof shape.literal === 'boolean' ? shape.literal ? 'True' : 'False' : 'Number'}${typeof shape.literal === 'boolean' ? '' : ` && ${json}.${typeof shape.literal === 'string' ? 'GetString()' : 'GetDouble()'} == ${JSON.stringify(shape.literal)}`}`;

  switch (shape.kind) {
    case 'string':
      return `${json}.ValueKind == JsonValueKind.String`;
    case 'number':
      return `${json}.ValueKind == JsonValueKind.Number`;
    case 'boolean':
      return `(${json}.ValueKind is JsonValueKind.True or JsonValueKind.False)`;
    // An instant only with an explicit offset; ECharts reads other date strings in the browser's time zone.
    case 'date':
      return `IsInstant(${json})`;
    case 'reference':
      return `${json}.ValueKind == JsonValueKind.Null`;
    case 'never':
      return 'false';
    case 'dictionary':
      return `(${json}.ValueKind == JsonValueKind.Object${all(`${json}.EnumerateObject()`, item, item + '.Value', shape.element!)})`;
    case 'arraylike':
      return `(${json}.ValueKind == JsonValueKind.Null || (${json}.ValueKind == JsonValueKind.Array${all(`${json}.EnumerateArray()`, item, item, shape.element!)}))`;
    case 'dynamic':
      return 'true';
    case 'model':
      return `GeneratedOptionMetadata.Matches${shape.name}(${json})`;
    case 'series':
      return `${json}.ValueKind == JsonValueKind.Object`;
    case 'union':
    case 'tuple':
      return `${shape.name}.Matches(${json})`;
    case 'function':
      return `${json}.ValueKind == JsonValueKind.Null`;
    case 'array':
      return `(${json}.ValueKind == JsonValueKind.Array${all(`${json}.EnumerateArray()`, item, item, shape.element!)})`;
    case 'many': {
      if (shape.struct)
        return `${shape.struct}.Matches(${json})`;

      const condition = anyOf([
        matches(shape.element!, json),
        `${json}.ValueKind == JsonValueKind.Array${all(`${json}.EnumerateArray()`, item, item, shape.element!)}`,
      ]);
      return condition === 'true' ? condition : `(${condition})`;
    }
  }
}

export function emitSerializer(shape: Shape): string {
  const props = shape.properties!;
  const name = shape.name!;
  const required = props.filter(p => shape.required?.includes(p.name));
  const writeGuards = required.map(
    p => `        if (!value.IsAssigned(${quote(p.name)})${shape.requiredNonNull?.includes(p.name) ? ` || value.${p.csName} is null` : ''}) throw new OptionSerializationException(${quote(`Required upstream property ${p.name} is missing or null.`)}, path + ${quote('.' + p.name)}, typeof(${name}));`
  ).join('\n');
  const readGuards = required.map(
    (p, i) => `        if (!json.TryGetProperty(${quote(p.name)}, out var required${i})${shape.requiredNonNull?.includes(p.name) ? ` || required${i}.ValueKind == JsonValueKind.Null` : ''}) throw new JsonException(${quote(`Required upstream property ${p.name} is missing or null.`)});`
  ).join('\n');
  const writes = props.map(p => `        context.WriteProperty(writer, value, ${quote(p.name)}, value.${p.csName}, path);`).join('\n') + (shape.index
    ? `\n        foreach (var pair in value.Entries)\n        {\n            if (value.IsAssigned(pair.Key) || value.AdditionalProperties.ContainsKey(pair.Key)) throw new JsonException("Conflicting indexed property.");\n            context.WritePropertyValue(writer, pair.Value, path, pair.Key);\n        }`
    : '');
  const cases = props.map(p => `                case ${quote(p.name)}: value.${p.csName} = ${read(p.shape, 'property.Value')}; break;`).join('\n');
  const typeCase = shape.discriminator
    ? `                case "type": if (property.Value.GetString() != ${quote(shape.discriminator)}) throw new JsonException("Wrong series discriminator."); break;\n`
    : '';
  const literalValidation = props.map(p => {
    const json = 'p' + p.csName;
    const valid = matches(p.shape, json);
    const orNull = nullOr(json, valid);
    if (!shape.required?.includes(p.name))
      return orNull === 'true' ? '' : ` && (!json.TryGetProperty(${quote(p.name)}, out var ${json}) || ${orNull})`;

    const condition = !shape.requiredNonNull?.includes(p.name) ? orNull : valid === 'true' ? valid : `(${valid})`;
    return condition === 'true'
      ? ` && json.TryGetProperty(${quote(p.name)}, out _)`
      : ` && json.TryGetProperty(${quote(p.name)}, out var ${json}) && (${condition})`;
  }).join('');

  // A variant matches its own type; without type only the variant that ECharts' subtype defaulter picks.
  const absent = {
    always: 'true',
    'has-data': 'json.TryGetProperty("data", out var pVariantData) && pVariantData.ValueKind != JsonValueKind.Null',
    'no-data': '!(json.TryGetProperty("data", out var pVariantData) && pVariantData.ValueKind != JsonValueKind.Null)',
    continuous: 'ContinuousVisualMapDefault(json)',
    piecewise: '!ContinuousVisualMapDefault(json)',
  } as const;
  const variantValidation = shape.initialValues?.type
    ? ` && (json.TryGetProperty("type", out var pVariantType) && pVariantType.ValueKind != JsonValueKind.Null ? pVariantType.ValueKind == JsonValueKind.String && pVariantType.GetString() == ${quote(shape.initialValues.type)} : ${shape.absentType ? absent[shape.absentType] : 'false'})`
    : '';

  // Readers and writers keep the upstream-deprecated members of the contract.
  return header
    + (props.some(p => p.deprecated !== undefined) ? '#pragma warning disable CS0618\n' : '')
    + usings
    + 'using System.Linq;\n\nnamespace BlazorECharts.Serialization.Generated;\n\ninternal static partial class GeneratedOptionMetadata\n{\n'
    + `    internal static void Write${name}(Utf8JsonWriter writer, ${name} value, EChartsSerializationContext context, string path)\n    {\n${shape.discriminator ? '        context.WriteProperty(writer, value, "type", value.Type, path);\n' : ''}${writeGuards ? writeGuards + '\n' : ''}${writes}\n    }\n\n`
    + `    /// <summary>Reads ${name} with explicit presence and retained unknown JSON fields.</summary>\n    public static ${name} Read${name}(JsonElement json, EChartsSerializationContext? context = null)\n    {\n        if (json.ValueKind != JsonValueKind.Object) throw new JsonException("Expected ${name} object.");\n${readGuards ? readGuards + '\n' : ''}        context ??= ReadContext;\n        var value = new ${name}(${shape.initialValues ? 'false' : ''});\n        foreach (var property in json.EnumerateObject())\n        {\n            try\n            {\n${indentBlock(`            switch (property.Name)\n            {\n${typeCase}${cases}\n                default: ${shape.index ? `value.Entries[property.Name] = ${read(shape.index, "property.Value")}` : "value.AdditionalProperties[property.Name] = EChartsValue.FromJson(property.Value)"}; break;\n            }`)}\n            }\n            catch (Exception error) when (OptionReadError.Is(error)) { throw OptionReadError.AtProperty(property.Name, error); }\n        }\n        return value;\n    }\n\n    internal static bool Matches${name}(JsonElement json) => json.ValueKind == JsonValueKind.Object${literalValidation}${variantValidation};\n}\n`;
}

const indentBlock = (text: string) => text.replace(/^(?=.)/gm, '    ');

export function emitRegistry(models: Shape[], unionArrays: string[] = []): string {
  const registrations = models.map(s => s.discriminator
    ? `        context.RegisterSeries(${quote(s.discriminator)}, new OptionTypeRegistration<${s.name}>(Write${s.name}, Read${s.name}));`
    : `        context.Register(new OptionTypeRegistration<${s.name}>(Write${s.name}, Read${s.name}));`)
    .concat(unionArrays.map(name => `        context.RegisterUnionArray<${name}>();`))
    .join('\n');
  return header + usings + `\nnamespace BlazorECharts.Serialization.Generated;\n\n// Generated writers, readers and series factories behind OptionMetadata and EChartsSerializationContext.Read.\ninternal static partial class GeneratedOptionMetadata\n{\n    internal static EChartsSerializationContext CreateContext()\n    {\n        var context = new EChartsSerializationContext();\n        Register(context);\n        return context;\n    }\n\n    private static readonly Lazy<EChartsSerializationContext> s_readContext = new(() => { var context = CreateContext(); context.MakeReadOnly(); return context; });\n    // Readers without an explicit context share one read-only registry instead of building every registration per call.\n    internal static EChartsSerializationContext ReadContext => s_readContext.Value;\n\n    internal static void Register(EChartsSerializationContext context)\n    {\n${registrations}\n        RegisterActions(context);\n        context.Register(new OptionTypeRegistration<RawSeriesOption>((w, v, c, p) => c.WriteProperty(w, v, "type", v.Type, p)));\n    }\n\n    internal static OptionDictionary<T> ReadDictionary<T>(JsonElement json, Func<JsonElement, T> read)\n    {\n        if (json.ValueKind != JsonValueKind.Object) throw new JsonException("Expected dictionary object.");\n        var result = new OptionDictionary<T>();\n        foreach (var property in json.EnumerateObject())\n        {\n            try { result.Add(property.Name, read(property.Value)); }\n            catch (Exception error) when (OptionReadError.Is(error)) { throw OptionReadError.AtProperty(property.Name, error); }\n        }\n        return result;\n    }\n\n    internal static T[] ReadArray<T>(JsonElement json, Func<JsonElement, T> read)\n    {\n        if (json.ValueKind != JsonValueKind.Array) throw new JsonException("Expected array.");\n        var values = new T[json.GetArrayLength()];\n        var i = 0;\n        foreach (var item in json.EnumerateArray())\n        {\n            try { values[i] = read(item); }\n            catch (Exception error) when (OptionReadError.Is(error)) { throw OptionReadError.AtIndex(i, error); }\n            i++;\n        }\n        return values;\n    }\n\n    // The visualMap subtype defaulter of ECharts 6.1.0 (component/visualMap/installCommon.js).\n    internal static bool ContinuousVisualMapDefault(JsonElement json)\n    {\n        static bool Has(JsonElement json, string name, out JsonElement value) => json.TryGetProperty(name, out value) && value.ValueKind != JsonValueKind.Null;\n        var split = Has(json, \"pieces\", out var pieces) ? pieces.ValueKind == JsonValueKind.Array && pieces.GetArrayLength() > 0 : Has(json, \"splitNumber\", out var number) && number.ValueKind == JsonValueKind.Number && number.GetDouble() > 0;\n        return !Has(json, \"categories\", out _) && (!split || Has(json, \"calculable\", out var calculable) && calculable.ValueKind == JsonValueKind.True);\n    }\n\n    internal static bool IsInstant(JsonElement json)\n    {\n        if (json.ValueKind != JsonValueKind.String || !json.TryGetDateTimeOffset(out _)) return false;\n        var text = json.GetString()!;\n        var time = text.IndexOfAny(['T', 't', ' ']);\n        return time > 0 && (text.EndsWith('Z') || text.EndsWith('z') || text.AsSpan(time).IndexOfAny('+', '-') > 0);\n    }\n\n    internal static OneOrMany<T> ReadOneOrMany<T>(JsonElement json, Func<JsonElement, T> read, Func<JsonElement, bool> one) =>\n        json.ValueKind == JsonValueKind.Array && !one(json) ? OneOrMany<T>.Many(ReadArray(json, read)) : OneOrMany<T>.One(read(json));\n}\n`;
}
