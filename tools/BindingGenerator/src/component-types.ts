import ts from 'typescript';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiSchema, TypeNode } from './schema.ts';
import { TypeResolver, hash } from './resolve-types.ts';
import type { CSharpConfiguration } from './generation-model.ts';
import { execFileSync } from 'node:child_process';
import { componentRoute } from './component-routes.ts';
import { projectGraphicVariants } from './graphic-options.ts';

const cache = new Map<string, {
  types: TypeNode[];
  inputs: { file: string; sha256: string; package: string; path: string }[];
}>();

/** Projection nodes repaired by their content-hash ID. A release whose declarations no longer produce one fails instead of skipping the repair. */
export const componentRepairs = { valueLabelOpt: 'type:3f26bcaa92d88bb17bdc4456', tooltipOption: 'type:2d65be744bdd7291a7fcc0b7' };

const projectionKey = (schema: ApiSchema, targets: string[], repairs = componentRepairs) => JSON.stringify([
  schema.sources.filter(s => ['echarts', 'zrender', 'typescript'].includes(s.name)).map(s => [s.name, s.version, s.sha256]),
  targets,
  repairs,
]);

/** Materialize closed option generics with the pinned checker, never by interpreting TS display text. */
export function componentTypes(schema: ApiSchema, targets: string[], repairs = componentRepairs): TypeNode[] {
  if (!targets.length)
    return [];

  if (ts.version !== schema.compilerVersion)
    throw new Error('Component projection compiler version mismatch');

  const source = schema.sources.find(s => s.name === 'echarts')!;
  const path = resolve('artifacts/upstream/echarts/types/dist/echarts.d.ts');
  const expected = source.files.find(f => f.path === 'types/dist/echarts.d.ts')!.sha256;
  if (hash(readFileSync(path)) !== expected)
    throw new Error('Component declarations hash mismatch');

  const key = projectionKey(schema, targets, repairs);
  const cached = cache.get(key);
  if (cached) {
    for (const p of cached.inputs)
      if (hash(readFileSync(p.file)) !== p.sha256)
        throw new Error(`Component input changed: ${p.file}`);

    return cached.types;
  }

  const extra = [
    'types/src/component/transform/filterTransform.d.ts', 'types/src/component/transform/sortTransform.d.ts',
    'types/src/component/tooltip/TooltipView.d.ts',
  ];
  const program = ts.createProgram([path, ...extra.map(p => resolve('artifacts/upstream/echarts', p))], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    exactOptionalPropertyTypes: true,
    types: [],
    noEmit: true,
    allowSyntheticDefaultImports: true,
    paths: { 'zrender/*': [resolve('artifacts/upstream/zrender/*')] },
  });
  const checker = program.getTypeChecker();
  const projection: ApiSchema = {
    formatVersion: 1,
    compilerVersion: ts.version,
    sources: [],
    roots: [],
    records: [],
    types: [],
    provenance: [],
    diagnostics: [],
    series: [],
  };
  const selected = new Set(targets);
  const repaired = new Set<string>();

  class ClosedOptions extends TypeResolver {
    override fill(type: ts.Type, node: TypeNode): void {
      if (this.schema.types.length > 30_000)
        throw new Error('Non-finite component generic expansion');

      super.fill(type, node);

      // The upstream indexed access crosses optional tooltipConfig and becomes
      // checker-any (TS2339). Resolve the actual non-null owner member instead.
      if (node.display === 'ShowTipPayload' && node.properties) {
        const owner = program.getSourceFile(resolve('artifacts/upstream/echarts/types/src/util/innerStore.d.ts'))!;
        const declaration = owner.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'ECData')!;
        const config = checker.getPropertyOfType(checker.getTypeAtLocation(declaration), 'tooltipConfig')!;
        const configType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(config, declaration));
        const option = checker.getPropertyOfType(configType, 'option')!;
        const optionType = this.resolve(checker.getTypeOfSymbolAtLocation(option, declaration));
        const textType = this.resolve(checker.getStringType());

        // TooltipView._showComponentItemTooltip also accepts a plain string.
        const id = 'type:runtime-tooltip-content-6.1.0';
        this.schema.types.push({
          id,
          kind: 'union',
          display: 'string | ComponentItemTooltipOption<unknown>',
          alternatives: [textType, optionType],
          provenance: [...node.properties.find(p => p.name === 'tooltip')!.provenance],
        });
        node.properties.find(p => p.name === 'tooltip')!.type = id;
      }

      // DataByAxis.valueLabelOpt has the same optional indexed-access issue.
      // Preserve precision's literal union and formatter's callback signature.
      if (node.id === repairs.valueLabelOpt && node.properties) {
        repaired.add(node.id);
        const owner = program.getSourceFile(resolve('artifacts/upstream/echarts/types/src/component/axisPointer/AxisPointerModel.d.ts'))!;
        const declaration = owner.statements.find(s => ts.isInterfaceDeclaration(s) && s.name.text === 'AxisPointerOption')!;
        const label = checker.getPropertyOfType(checker.getTypeAtLocation(declaration), 'label')!;
        const labelType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(label, declaration));
        for (const name of ['precision', 'formatter']) {
          const member = checker.getPropertyOfType(labelType, name)!;
          node.properties.find(p => p.name === name)!.type = this.resolve(checker.getTypeOfSymbolAtLocation(member, declaration));
        }
      }

      if (node.kind === 'generic-reference' && node.target === repairs.tooltipOption)
        repaired.add(node.target);

      if (node.kind !== 'generic-reference' || !(selected.has(node.target!) || node.target === repairs.tooltipOption))
        return;

      node.kind = 'object';
      node.properties = this.properties(type);
      node.signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call).map(s => this.signature(s));
      node.constructSignatures = [];
      node.indexes = checker.getIndexInfosOfType(type).map(
        i => ({ key: this.resolve(i.keyType), value: this.resolve(i.type), readonly: i.isReadonly })
      );
    }
  }

  const resolver = new ClosedOptions(checker, projection, file => {
    const normalized = resolve(file).replaceAll('\\', '/');
    const compiler = resolve('node_modules/typescript/lib').replaceAll('\\', '/') + '/';
    if (normalized.startsWith(compiler))
      return { package: 'typescript', version: ts.version, file: normalized.slice(compiler.length) };

    const upstream = resolve('artifacts/upstream/echarts').replaceAll('\\', '/') + '/';
    if (normalized.startsWith(upstream))
      return { package: 'echarts', version: source.version, file: normalized.slice(upstream.length) };

    const zr = resolve('artifacts/upstream/zrender').replaceAll('\\', '/') + '/';
    if (normalized.startsWith(zr))
      return { package: 'zrender', version: schema.sources.find(s => s.name === 'zrender')!.version, file: normalized.slice(zr.length) };

    throw new Error(`Unexpected component projection source ${file}`);
  });
  const file = program.getSourceFile(path)!;
  const root = file.statements.find(s => (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) && s.name.text === 'EChartsOption')!;
  resolver.resolve(checker.getTypeAtLocation(root));

  // EChartsOption injects marker fields into series. Public standalone series exports
  // also need their own closed generic instantiations, with the same pinned identity.
  const moduleSymbol = checker.getSymbolAtLocation(file)!;
  for (const exported of checker.getExportsOfModule(moduleSymbol).filter(s => s.name.endsWith('SeriesOption'))) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    resolver.resolve(checker.getDeclaredTypeOfSymbol(symbol));
  }

  for (const statement of file.statements)
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && /SeriesOption$/.test(statement.name.text))
      resolver.resolve(checker.getTypeAtLocation(statement));

  for (const p of extra) {
    const file = program.getSourceFile(resolve('artifacts/upstream/echarts', p))!;
    for (const statement of file.statements)
      if (ts.isInterfaceDeclaration(statement)
        && ['FilterTransformOption', 'SortTransformOption', 'ShowTipPayload', 'HideTipPayload'].includes(statement.name.text))
        resolver.resolve(checker.getTypeAtLocation(statement));
  }

  resolver.flush();
  const unrepaired = Object.values(repairs).filter(id => !repaired.has(id));
  if (unrepaired.length)
    throw new Error(`Component projection repairs ${unrepaired.join(', ')}, which the pinned declarations no longer produce; update componentRepairs in component-types.ts`);

  // Match the extraction pipeline: capture diagnostic checking after semantic graph resolution.
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  const unresolved = errors.filter(d => [2304, 2307, 2688].includes(d.code) || d.code >= 1000 && d.code < 2000);
  if (unresolved.length)
    throw new Error('Component source diagnostics: ' + unresolved.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));

  const archives = new Map<string, string>();
  const inputs: { file: string; sha256: string; package: string; path: string }[] = [];
  const temp = mkdtempSync(resolve('artifacts/generator/components-'));
  try {
    for (const input of program.getSourceFiles()) {
      const normalized = resolve(input.fileName).replaceAll('\\', '/');
      const compiler = resolve('node_modules/typescript/lib').replaceAll('\\', '/') + '/';
      const pkg = normalized.startsWith(compiler)
        ? 'typescript'
        : normalized.startsWith(resolve('artifacts/upstream/zrender').replaceAll('\\', '/')) ? 'zrender' : 'echarts';
      const relative = normalized.startsWith(compiler)
        ? normalized.slice(compiler.length)
        : normalized.slice(resolve('artifacts/upstream', pkg).length + 1);
      const pin = schema.sources.find(s => s.name === pkg)?.files.find(f => f.path === relative);
      let expected = pin?.sha256;
      if (!expected && pkg !== 'typescript') {
        let archive = archives.get(pkg);
        if (!archive) {
          const source = schema.sources.find(s => s.name === pkg)!;
          archive = resolve('artifacts/upstream', `${pkg}-${source.version}.tgz`);
          if (hash(readFileSync(archive)) !== source.sha256)
            throw new Error(`Component archive integrity mismatch: ${pkg}`);

          archives.set(pkg, archive);
          const destination = resolve(temp, pkg);
          mkdirSync(destination);
          execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', destination]);
        }

        expected = hash(readFileSync(resolve(temp, pkg, relative)));
      }

      if (!expected || hash(input.text) !== expected)
        throw new Error(`Unpinned component input ${pkg}/${relative}`);

      inputs.push({ file: input.fileName, sha256: expected, package: pkg, path: relative });
    }
  } finally {
    if (!temp.startsWith(resolve('artifacts/generator') + '\\') && !temp.startsWith(resolve('artifacts/generator') + '/'))
      throw new Error('Invalid component scratch directory');

    rmSync(temp, { recursive: true, force: true });
  }

  cache.set(key, { types: projection.types, inputs });
  return projection.types;
}

export function prepareComponentTypes(schema: ApiSchema, config: CSharpConfiguration): Map<string, TypeNode> {
  const types = new Map(schema.types.map(t => [t.id, t]));
  for (const t of componentTypes(schema, config.specializeGenerics ?? []))
    if (!types.has(t.id) || types.get(t.id)!.kind === 'generic-reference' && t.kind === 'object')
      types.set(t.id, t);

  const provenance = new Set(schema.provenance.map(s => s.id));
  const verified = (ids: string[]) => ids.length > 0 && ids.every(id => provenance.has(id));
  for (const t of config.componentNodes ?? []) {
    const plain = t.kind === 'object' && !t.constructSignatures?.length && !t.typeParameters?.length;
    const documentedObject = plain
      && !!t.properties?.length
      && !t.indexes?.length
      && !t.signatures?.length
      && t.properties.every(p => p.optional && verified(p.provenance));
    const dictionary = plain
      && !t.properties?.length
      && !t.signatures?.length
      && t.indexes?.length === 1
      && types.get(t.indexes[0].key)?.kind === 'string'
      && verified(t.provenance);
    const callable = plain && !t.properties?.length && !t.indexes?.length && !!t.signatures?.length && verified(t.provenance)
      && t.signatures.every(s => !s.typeParameters.length && !s.thisType && s.parameters.every(p => !p.rest) && verified(s.provenance));
    const references = [
      ...t.alternatives ?? [],
      ...t.element ? [t.element] : [],
      ...t.properties?.map(p => p.type) ?? [],
      ...t.indexes?.flatMap(i => [i.key, i.value]) ?? [],
      ...t.signatures?.flatMap(s => [...s.parameters.map(p => p.type), s.returnType]) ?? [],
    ];
    if (types.has(t.id)
      || !(['union', 'array'].includes(t.kind) || documentedObject || dictionary || callable)
      || references.some(id => !types.has(id)))
      throw new Error(`Invalid component node ${t.id}`);

    types.set(t.id, t);
  }

  const parents = new Map<string, TypeNode>();
  const supplied = new Set<string>();
  for (const p of config.componentProperties ?? []) {
    const key = p.parent + '/' + p.name;
    if (supplied.has(key))
      throw new Error(`Duplicate component supplement ${key}`);

    supplied.add(key);
    const original = types.get(p.parent);
    if (!original
      || hash(JSON.stringify(original)) !== p.sha256
      || original.properties?.some(v => v.name === p.name)
      || !types.has(p.type)
      || !p.reason.trim()
      || !p.docs.length
      || p.docs.some(id => !schema.records.some(r => r.id === id && r.name === p.name && r.inventory?.category === 'option')))
      throw new Error(`Stale component supplement ${p.parent}/${p.name}`);

    let target = parents.get(p.parent);
    if (!target) {
      target = structuredClone(original);
      parents.set(p.parent, target);
    }

    target.properties!.push({
      name: p.name,
      type: p.type,
      optional: true,
      readonly: false,
      provenance: p.docs.flatMap(id => schema.records.find(r => r.id === id)!.provenance),
    });
  }

  for (const [id, t] of parents)
    types.set(id, t);

  for (const r of config.componentReplacements ?? []) {
    const original = types.get(r.parent);
    const p = original?.properties?.find(p => p.name === r.name);
    if (!p || p.type !== r.expected || !types.has(r.type) || !r.reason.trim())
      throw new Error(`Stale component replacement ${r.parent}/${r.name}`);

    const target = structuredClone(original!);
    target.properties!.find(p => p.name === r.name)!.type = r.type;
    types.set(r.parent, target);
  }

  const root = schema.records.find(r => r.id === config.roots[0].recordId)!.type;
  const aliases = new Set<string>();
  for (const a of config.optionRouteAliases ?? []) {
    if (aliases.has(a.path)
      || !a.reason.trim()
      || !schema.records.some(r => r.id === 'public:' + a.path)
      || !componentRoute(types, root, a.target, config.componentVariants).length)
      throw new Error(`Stale option route alias ${a.path}`);

    aliases.add(a.path);
  }

  for (const [path, ids] of Object.entries(config.componentVariants ?? {})) {
    if (!schema.records.some(r => r.id === 'public:' + path))
      throw new Error(`Unknown component variant ${path}`);

    const reachable = new Set<string>();
    const visit = (id: string): void => {
      if (reachable.has(id))
        return;

      reachable.add(id);
      const t = types.get(id);
      if (!t)
        return;

      for (const a of t.alternatives ?? [])
        visit(a);

      if (t.element)
        visit(t.element);

      if (t.kind === 'generic-reference')
        visit(t.target!);
    };
    for (const edge of componentRoute(types, root, path.slice(0, path.lastIndexOf('.')), config.componentVariants))
      visit(edge.type);

    if (!ids.length || ids.some(id => !reachable.has(id)))
      throw new Error(`Stale component variant ${path}`);
  }

  projectGraphicVariants(types, config.graphicVariants ?? [], schema);
  return types;
}
