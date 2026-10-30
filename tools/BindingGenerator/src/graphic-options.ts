import type { TypeNode } from './schema.ts';
import { hash } from './resolve-types.ts';
import type { ApiSchema } from './schema.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const runtimeCache = new Map<string, { supported: string[]; reserved: string[]; sources: { file: string; sha256: string }[] }>();

/** Verify runtime evidence against archive bytes, including cached source files. */
export function graphicRuntimeContracts(schema: ApiSchema) {
  const pkg = schema.sources.find(s => s.name === 'echarts')!;
  const archive = resolve('artifacts/upstream', `echarts-${pkg.version}.tgz`);
  if (hash(readFileSync(archive)) !== pkg.sha256)
    throw new Error('Graphic runtime archive integrity mismatch');

  let result = runtimeCache.get(pkg.sha256);
  if (!result) {
    const files = ['lib/util/graphic.js', 'lib/component/graphic/GraphicView.js'];
    const supported: string[] = [];
    const reserved: string[] = [];
    const sources = files.map(file => {
      const bytes = execFileSync('tar', ['-xOf', archive, 'package/' + file]);
      const source = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === 'registerShape'
          && ts.isStringLiteral(node.arguments[0]))
          supported.push(node.arguments[0].text);

        if (ts.isVariableDeclaration(node)
          && ts.isIdentifier(node.name)
          && node.name.text === 'nonShapeGraphicElements'
          && node.initializer
          && ts.isObjectLiteralExpression(node.initializer))
          for (const property of node.initializer.properties)
            if (ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.NullKeyword)
              reserved.push(property.name.getText(source).replaceAll(/['"]/g, ''));

        ts.forEachChild(node, visit);
      };
      visit(source);
      return { file, sha256: hash(bytes) };
    });
    result = { supported: supported.sort(), reserved: reserved.sort(), sources };
    runtimeCache.set(pkg.sha256, result);
  }

  for (const input of result.sources)
    if (hash(readFileSync(resolve('artifacts/upstream/echarts', input.file))) !== input.sha256)
      throw new Error(`Graphic runtime cached source drift ${input.file}`);

  return structuredClone(result);
}

export interface GraphicVariantMapping {
  name: string;
  discriminator: string;
  typeId: string;
  shapeName: string;
  baseTypeId: string;
  baseHash: string;
  nativeTypeId: string;
  nativeHash: string;
  shapeHash: string;
  reason: string;
}

/** GraphicView consumes the same pinned PathProps/shape transition contracts as
 * custom series. Preserve graphic-specific layout/IDs/events and specialize only
 * geometry and geometry-bearing transition values; this is not a ZRender facade. */
export function projectGraphicVariants(types: Map<string, TypeNode>, mappings: GraphicVariantMapping[], schema: ApiSchema): void {
  if (!mappings.length)
    return;

  const runtime = graphicRuntimeContracts(schema);
  const originals = [...types.values()];
  const added = new Map<string, string[]>();
  const names = new Set<string>();
  for (const mapping of mappings) {
    if (!runtime.supported.includes(mapping.discriminator) || runtime.reserved.includes(mapping.discriminator))
      throw new Error(`Unsupported pinned graphic variant ${mapping.discriminator}`);

    const base = types.get(mapping.baseTypeId);
    const native = types.get(mapping.nativeTypeId);
    const shapeProperty = native?.properties?.find(p => p.name === 'shape');
    const nativeShape = shapeProperty && types.get(shapeProperty.type);
    const typeProperty = native?.properties?.find(p => p.name === 'type');
    if (!base || !native || !nativeShape || !typeProperty || types.get(typeProperty.type)?.value !== mapping.discriminator
      || hash(JSON.stringify(base)) !== mapping.baseHash || hash(JSON.stringify(native)) !== mapping.nativeHash
      || hash(JSON.stringify(nativeShape)) !== mapping.shapeHash || !mapping.reason.trim() || types.has(mapping.typeId) || names.has(mapping.name)
      || !/^[A-Z][A-Za-z0-9_]*$/.test(mapping.name) || !/^[A-Z][A-Za-z0-9_]*$/.test(mapping.shapeName))
      throw new Error(`Stale graphic variant ${mapping.typeId}`);

    names.add(mapping.name);
    const shapeId = mapping.typeId + ':shape';
    const shape: TypeNode = { ...structuredClone(nativeShape), id: shapeId, name: mapping.shapeName, display: mapping.shapeName, kind: 'object' };
    delete shape.constituents;
    types.set(shapeId, shape);
    const properties = base.properties!.map(property => {
      if (property.name === 'shape')
        return { ...shapeProperty, type: shapeId };

      if (['type', 'enterFrom', 'leaveTo', 'keyframeAnimation'].includes(property.name))
        return { ...native.properties!.find(p => p.name === property.name)! };

      return structuredClone(property);
    });
    const during = native.properties!.find(p => p.name === 'during');
    if (during)
      properties.push(structuredClone(during));

    types.set(mapping.typeId, {
      ...structuredClone(base),
      id: mapping.typeId,
      name: mapping.name,
      display: mapping.name,
      properties,
      provenance: [...new Set([...base.provenance, ...native.provenance])],
    });
    const group = added.get(mapping.baseTypeId) ?? [];
    group.push(mapping.typeId);
    added.set(mapping.baseTypeId, group);
  }

  for (const [baseId, variants] of added) {
    const base = types.get(baseId)!;

    // Only widen unions containing the complete graphic contract. Omit<...>
    // clip paths and other deliberately restricted projections remain unchanged.
    const compatible = new Set(originals
      .filter(t => t.properties && base.properties!.every(p => t.properties!.some(q => q.name === p.name && q.type === p.type)))
      .map(t => t.id));
    let containers = 0;
    for (const original of originals)
      if (original.kind === 'union' && original.alternatives!.some(id => compatible.has(id))) {
        const node = types.get(original.id)!;
        types.set(node.id, { ...node, alternatives: [...new Set([...node.alternatives!, ...variants])] });
        containers++;
      }

    if (!containers)
      throw new Error(`No graphic variant container ${baseId}`);
  }
}
