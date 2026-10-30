import ts from 'typescript';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { TypeResolver, hash } from './resolve-types.ts';
import type { SourceLocation } from './resolve-types.ts';
import { discoverPublicRoots } from './public-roots.ts';
import { normalizeSchema, validateSchema } from './schema.ts';
import type { ApiSchema, ApiRecord, PublicRoot, Source } from './schema.ts';

const slash = (path: string) => path.replaceAll('\\', '/');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface ExtractionOptions {
  locate?: (file: string) => SourceLocation;
  roots?: PublicRoot[];
  sources?: Source[];
  paths?: Record<string, string[]>;
}

function family(name: string): string {
  if (name.includes('SeriesOption') || name === 'RegisteredSeriesOption')
    return 'series';

  if (/Option|Opts/.test(name))
    return 'options';

  if (/Event|Payload/.test(name))
    return 'events-actions';

  return 'declarations';
}

export function extractDeclarations(entries: string[], options: ExtractionOptions = {}): ApiSchema {
  if (ts.version !== '6.0.3')
    throw new Error(`Expected TypeScript 6.0.3, found ${ts.version}`);

  const locate = options.locate ?? ((file: string) => ({
    package: slash(file).includes('/typescript/lib/') ? 'typescript' : 'fixture',
    version: slash(file).includes('/typescript/lib/') ? ts.version : 'test',
    file: basename(file),
  }));
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    types: [],
    allowSyntheticDefaultImports: true,
    paths: options.paths,
  };
  const program = ts.createProgram([...new Set(entries)].sort(), compilerOptions);
  const checker = program.getTypeChecker();
  const schema: ApiSchema = {
    formatVersion: 1,
    compilerVersion: ts.version,
    sources: options.sources ?? [],
    roots: options.roots ?? [],
    records: [],
    types: [],
    series: [],
    diagnostics: [],
    provenance: [],
  };
  const resolver = new TypeResolver(checker, schema, locate);
  const canonical = (symbol: ts.Symbol): ts.Symbol => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const definitions = new Map<ts.Symbol, ApiRecord>();
  const exportedIds = new Set<string>();
  const namespaces = new Set<string>();
  const symbolType = (symbol: ts.Symbol): ts.Type =>
    symbol.flags & ts.SymbolFlags.Value ? checker.getTypeOfSymbol(symbol) : checker.getDeclaredTypeOfSymbol(symbol);
  const makeRecord = (
    id: string,
    kind: ApiRecord['kind'],
    name: string,
    publicPath: string,
    canonicalId: string,
    type: string,
    provenance: ApiRecord['provenance']
  ): ApiRecord =>
  ({
    id,
    kind,
    name,
    publicPath,
    canonicalId,
    type,
    provenance,
    family: family(name),
    status: 'unresolved',
    implementationReferences: [],
    testReferences: [],
  });
  const addExport = (alias: ts.Symbol, publicPath: string): void => {
    const symbol = canonical(alias);
    if (!symbol.declarations?.length) {
      schema.diagnostics.push({ code: 'UNRESOLVED_EXPORT', message: publicPath, provenance: resolver.provenance(alias.declarations) });
      return;
    }

    let definition = definitions.get(symbol);
    if (!definition) {
      const id = `symbol:${resolver.symbolKey(symbol)}`;
      definition = makeRecord(
        id,
        'definition',
        symbol.name,
        resolver.symbolKey(symbol),
        id,
        resolver.resolve(symbolType(symbol)),
        resolver.provenance(symbol.declarations)
      );
      definitions.set(symbol, definition);
      schema.records.push(definition);
    }

    const id = `export:${publicPath}`;
    if (!exportedIds.has(id)) {
      const aliasProvenance = resolver.provenance(alias.declarations);
      const record = makeRecord(
        id,
        'export',
        alias.name,
        publicPath,
        definition.id,
        definition.type,
        aliasProvenance.length ? aliasProvenance : definition.provenance
      );
      record.exportSpace = symbol.flags & ts.SymbolFlags.Namespace ? 'namespace' : symbol.flags & ts.SymbolFlags.Value ? 'value' : 'type';
      schema.records.push(record);
      exportedIds.add(id);
    }

    if (symbol.flags & ts.SymbolFlags.Namespace && !namespaces.has(definition.id)) {
      namespaces.add(definition.id);
      for (const child of checker.getExportsOfModule(symbol))
        addExport(child, `${publicPath}.${child.name}`);
    }
  };
  for (const entry of [...new Set(entries)].sort()) {
    const sourceFile = program.getSourceFile(entry);
    if (!sourceFile)
      throw new Error(`Missing declaration: ${entry}`);

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol)
      continue;

    const assignment = moduleSymbol.exports?.get(ts.InternalSymbolName.ExportEquals);
    const module = assignment ? canonical(assignment) : moduleSymbol;
    const location = locate(entry);
    for (const symbol of checker.getExportsOfModule(module))
      addExport(symbol, `${location.package}/${location.file}::${symbol.name}`);

    // Module augmentations are exports of a nested module, not of the file itself.
    for (const statement of sourceFile.statements)
      if (ts.isModuleDeclaration(statement) && ts.isStringLiteral(statement.name)) {
        const augmentation = checker.getSymbolAtLocation(statement.name);
        if (augmentation)
          for (const symbol of checker.getExportsOfModule(augmentation)) {
            if (symbol.declarations?.some(d => d.getSourceFile() === sourceFile))
              addExport(symbol, `${location.package}/${location.file}::${statement.name.text}.${symbol.name}`);
          }
      }
  }

  resolver.flush();

  // Properties are graph edges on resolved types: one record per edge, no infinite recursive public paths.
  for (const type of schema.types)
    for (const property of type.properties ?? []) {
      const id = `property:${type.id}/${encodeURIComponent(property.name)}`;
      const provenance = property.provenance.length ? property.provenance : type.provenance;
      if (provenance.length)
        schema.records.push(makeRecord(id, 'property', property.name, `graph:${type.id}.${property.name}`, id, property.type, provenance));

      const target = resolver.byId.get(property.type)!;
      if (target.kind === 'any' || target.kind === 'unknown')
        schema.diagnostics.push({
          code: `UPSTREAM_${target.kind.toUpperCase()}`,
          message: `${type.display}.${property.name}`,
          type: property.type,
          provenance,
        });
    }

  // The registry is discovered from the root export, never a hard-coded list of chart kinds.
  const registry = schema.records.find(
    r => r.kind === 'export' && r.name === 'RegisteredSeriesOption' && r.publicPath.startsWith('echarts/types/dist/all.d.ts::')
  );
  if (registry)
    for (const property of resolver.byId.get(registry.type)!.properties ?? []) {
      const seriesType = resolver.byId.get(property.type)!;
      const discriminator = seriesType.properties?.find(p => p.name === 'type');
      const literalValues = (id: string): string[] => {
        const node = resolver.byId.get(id)!;
        return node.kind === 'literal' && typeof node.value === 'string' ? [node.value] : (node.alternatives ?? []).flatMap(literalValues);
      };
      schema.series.push({
        name: property.name,
        type: property.type,
        discriminator: discriminator ? literalValues(discriminator.type) : [],
        registry: registry.id,
      });
    }

  for (const diagnostic of ts.getPreEmitDiagnostics(program))
    schema.diagnostics.push({
      code: `TS${diagnostic.code}`,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      provenance: diagnostic.file ? [
        resolver.intern({
          ...locate(diagnostic.file.fileName),
          sha256: hash(diagnostic.file.text),
          start: (() => {
            const p = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
            return { line: p.line + 1, column: p.character + 1 };
          })(),
          end: (() => {
            const p = diagnostic.file!.getLineAndCharacterOfPosition((diagnostic.start ?? 0) + (diagnostic.length ?? 0));
            return { line: p.line + 1, column: p.character + 1 };
          })(),
        }),
      ] : [],
    });

  for (const sourceFile of program.getSourceFiles()) {
    const location = locate(sourceFile.fileName);
    let source = schema.sources.find(s => s.name === location.package);
    if (!source) {
      source = { name: location.package, version: location.version, sha256: '', integrityKind: 'file-set', files: [] };
      schema.sources.push(source);
    }

    if (!source.files.some(f => f.path === location.file))
      source.files.push({ path: location.file, sha256: hash(sourceFile.text) });
  }

  normalizeSchema(schema);
  for (const source of schema.sources)
    if (source.integrityKind === 'file-set')
      source.sha256 = hash(JSON.stringify(source.files));

  validateSchema(schema);
  return schema;
}

/** Revalidates locked archives AND every consumed cached input against a fresh archive extraction. */
export async function extractContract(sourceLockPath: string): Promise<ApiSchema> {
  const root = resolve(dirname(sourceLockPath), '../..');
  const sourceLock = JSON.parse(readFileSync(sourceLockPath, 'utf8'));
  if (sourceLock.formatVersion !== 1)
    throw new Error('Unsupported source lock version');

  const output = join(root, 'artifacts/generator');
  mkdirSync(output, { recursive: true });
  const verified = mkdtempSync(join(output, 'verified-'));
  try {
    // A scoped package name holds a slash: its archive and extraction use the unscoped directory of sources.lock.json.
    const directories = new Map<string, string>(sourceLock.packages.map((p: { name: string; directory?: string }) => [p.name, p.directory ?? p.name]));
    const sources: Source[] = [];
    for (const pkg of sourceLock.packages) {
      const archive = join(root, 'artifacts/upstream', `${directories.get(pkg.name)}-${pkg.version}.tgz`);
      const bytes = readFileSync(archive);
      if (hash(bytes) !== pkg.sha256 || `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== pkg.integrity)
        throw new Error(`${pkg.name}: archive integrity mismatch; use assets:acquire`);

      const dir = join(verified, directories.get(pkg.name)!);
      mkdirSync(dir, { recursive: true });
      execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', dir]);
      const metadata = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (metadata.name !== pkg.name || metadata.version !== pkg.version)
        throw new Error(`${pkg.name}: package identity mismatch`);

      sources.push({
        name: pkg.name,
        version: pkg.version,
        sha256: pkg.sha256,
        integrityKind: 'archive',
        url: pkg.url,
        integrity: pkg.integrity,
        upstreamCommit: pkg.upstreamCommit,
        files: [],
      });
    }

    const locate = (file: string): SourceLocation => {
      const normalized = slash(resolve(file));
      for (const pkg of sourceLock.packages) {
        const prefix = slash(join(verified, directories.get(pkg.name)!)) + '/';
        if (normalized.startsWith(prefix))
          return { package: pkg.name, version: pkg.version, file: normalized.slice(prefix.length) };
      }

      const compilerDir = slash(join(projectRoot, 'node_modules/typescript/lib')) + '/';
      if (normalized.startsWith(compilerDir))
        return { package: 'typescript', version: ts.version, file: normalized.slice(compilerDir.length) };

      throw new Error(`Unexpected source outside pinned packages/compiler: ${file}`);
    };
    // Only ECharts: the WordCloud declarations augment the ECharts module types, so in one program they would change the core
    // contract. The WordCloud contract has its own inventory (tools/BindingGenerator/src/wordcloud.ts).
    const roots = discoverPublicRoots(join(verified, 'echarts'));
    const entries = roots.filter(r => r.status === 'declaration').map(r => join(verified, directories.get(r.package)!, r.declaration!));
    const paths: Record<string, string[]> = {};
    for (const pkg of sourceLock.packages) {
      const dir = join(verified, directories.get(pkg.name)!);
      const metadata = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      paths[pkg.name] = [join(dir, pkg.name === 'echarts' ? 'types/dist/all.d.ts' : metadata.types ?? metadata.typings ?? 'index.d.ts')];
      paths[`${pkg.name}/*`] = [slash(join(dir, '*'))];
    }

    const schema = extractDeclarations(entries, { locate, roots, sources, paths });
    for (const source of schema.sources)
      for (const file of source.files)
        if (source.name !== 'typescript') {
          const cached = join(root, 'artifacts/upstream', directories.get(source.name)!, file.path);
          if (hash(readFileSync(cached)) !== file.sha256)
            throw new Error(`${source.name}/${file.path}: cached input integrity mismatch; restore with assets:acquire`);
        }

    for (const pkg of sourceLock.packages) {
      const source = schema.sources.find(s => s.name === pkg.name)!;
      const metadata = readFileSync(join(verified, directories.get(pkg.name)!, 'package.json'));
      if (hash(readFileSync(join(root, 'artifacts/upstream', directories.get(pkg.name)!, 'package.json'))) !== hash(metadata))
        throw new Error(`${pkg.name}: cached metadata integrity mismatch`);

      source.files.push({ path: 'package.json', sha256: hash(metadata) });
    }

    for (const root of roots.filter(r => r.status === 'declaration-gap'))
      schema.diagnostics.push({ code: 'DECLARATION_GAP', message: `${root.package}${root.exportPath.slice(1)}: ${root.reason}`, provenance: [] });

    return normalizeSchema(schema);
  } finally {
    rmSync(verified, { recursive: true, force: true });
  }
}
