import ts from 'typescript';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { ApiRecord, ApiSchema, Provenance, TypeNode } from './schema.ts';
import type { GeneratedManifest } from './generation-model.ts';
import type { MappingOverrides } from './validate-overrides.ts';

/** In-scope sets: the completeness boundary of the typed API. */
export const scopeSets = ['S1', 'S2', 'S3', 'S5'] as const;

/** Mechanical exclusion categories, in precedence order after the S sets. */
export const scopeCategories = ['K5d', 'K9', 'K3', 'K1', 'K7', 'K2', 'K4', 'K7m', 'K5a', 'K5r', 'K6', 'K6b', 'K8'] as const;
export type ScopeSet = typeof scopeSets[number] | typeof scopeCategories[number] | 'BONUS' | 'RESIDUAL';

export interface ScopeK9Span {
  package: string;
  file: string;
  sha256: string;
  startLine: number;
  endLine: number;
}

export interface ScopeK9Group {
  id: string;
  reason: string;
  paths: string[];

  /** The decisive runtime code: one span, or several when it is spread over places or files. */
  runtime: ScopeK9Span | ScopeK9Span[];
}

export interface ScopeOverrides {
  /** Documented option paths whose pinned runtime has no implementation; each group cites its runtime span. */
  k9?: ScopeK9Group[];

  /** Documented paths whose upstream type is `any`/`unknown`, so an untyped C# value is exact. */
  looseValues?: { path: string; reason: string }[];

  /** Documented globals delivered only through the `*NativeAsync` bridge. */
  nativeOnly?: { recordId: string; reason: string }[];
}

export interface OriginDeclaration {
  package: string;
  file: string;
  kind: string;
  name: string;
  exact: string;
  loose: string;
  anon: string;
}

export interface OriginIndex {
  formatVersion: 1;
  sources: { package: string; version: string; archiveSha256: string; root: string; files: [string, string][] }[];
  declarations: OriginDeclaration[];
}

export type SourceReader = (pkg: string, file: string) => string | undefined;

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const short = (value: string) => digest(value).slice(0, 16);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** Bundle renames (`Name$1`), facade prefixes and qualifiers never change the declared contract. */
export function normalizeDeclaration(text: string): string {
  return text.replace(/\$\d+\b/g, '')
    .replace(/\becharts__ECUMDEXPT___/g, '')
    .replace(/import\("[^"]*"\)\./g, '')
    .replace(/\b(export|default|declare)\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const looseText = (text: string) =>
  normalizeDeclaration(text).replace(/\b[A-Za-z_$][\w$]*\.(?=[A-Za-z_$])/g, '').replace(/[;,]\s*}/g, '}').replace(/;/g, '');

const baseName = (name: string) => name.replace(/\$\d+$/, '').replace(/^echarts__ECUMDEXPT___/, '');
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stripComments(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  let out = '';
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
    out += kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia ? ' ' : scanner.getTokenText();

  return out;
}

interface Statement {
  names: string[];
  kind: string;
  start: number;
  end: number;
  prefix: string;
  exact: string;
  loose: string;
  anon: string;
}

function statements(file: ts.SourceFile): Statement[] {
  const out: Statement[] = [];
  const visit = (list: ts.NodeArray<ts.Statement>, prefix: string) => {
    for (const statement of list) {
      const names = ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(d => d.name.getText(file))
        : (statement as ts.Statement & { name?: ts.Node }).name ? [(statement as ts.Statement & { name: ts.Node }).name.getText(file)] : [];
      const namespace = ts.isModuleDeclaration(statement) && statement.body && ts.isModuleBlock(statement.body);
      if (namespace)
        visit((statement.body as ts.ModuleBlock).statements, prefix + (names[0] ?? '') + '.');

      if (!names.length)
        continue;

      let text: string;
      if (namespace)
        text = 'namespace ' + names[0];
      else {
        try {
          text = printer.printNode(ts.EmitHint.Unspecified, statement, file);
        } catch {
          text = statement.getText(file);
        }
      }

      out.push({
        names,
        kind: ts.SyntaxKind[statement.kind],
        start: statement.getStart(file),
        end: statement.end,
        prefix,
        exact: normalizeDeclaration(text),
        loose: looseText(text),
        anon: looseText(text.replace(new RegExp('\\b' + escape(names[0]) + '\\b'), '@')),
      });
    }
  };
  visit(file.statements, '');
  return out;
}

const originRoots = [{ package: 'zrender', root: 'lib' }, { package: 'echarts', root: 'types/src' }];

export interface OriginSource {
  package: string;
  version: string;
  archiveSha256: string;
  root: string;
  files: { path: string; text: string }[];
}

/** Declarations of the unbundled pinned sources, keyed by name and normalized text. */
export function createOriginIndex(sources: OriginSource[]): OriginIndex {
  const index: OriginIndex = { formatVersion: 1, sources: [], declarations: [] };
  for (const source of sources) {
    const files = [...source.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    for (const { path, text } of files) {
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      for (const d of statements(file))
        if (!d.prefix)
          for (const name of d.names)
            index.declarations.push({
              package: source.package === 'echarts' ? 'echarts-src' : source.package,
              file: path,
              kind: d.kind,
              name: baseName(name),
              exact: short(d.exact),
              loose: short(d.loose),
              anon: short(d.anon),
            });
    }

    index.sources.push({
      package: source.package,
      version: source.version,
      archiveSha256: source.archiveSha256,
      root: source.root,
      files: files.map(f => [f.path, digest(f.text)]),
    });
  }

  const key = (d: OriginDeclaration) => [d.package, d.file, d.name, d.kind, d.exact, d.loose, d.anon].join('|');
  index.declarations.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return index;
}

/** Reads the extracted pinned archives after checking each archive against sources.lock.json. */
export function buildOriginIndex(root = process.cwd()): OriginIndex {
  const lock = JSON.parse(
    readFileSync(resolve(root, 'schemas/upstream/sources.lock.json'), 'utf8')
  ) as { packages: { name: string; version: string; sha256: string }[] };
  return createOriginIndex(originRoots.map(({ package: pkg, root: sourceRoot }) => {
    const locked = lock.packages.find(p => p.name === pkg);
    if (!locked)
      throw new Error(`Missing locked source ${pkg}`);

    const archive = resolve(root, 'artifacts/upstream', `${pkg}-${locked.version}.tgz`);
    if (!existsSync(archive) || digest(readFileSync(archive)) !== locked.sha256)
      throw new Error(`Origin archive integrity mismatch: ${pkg}`);

    return {
      package: pkg,
      version: locked.version,
      archiveSha256: locked.sha256,
      root: sourceRoot,
      files: originFiles(archive, resolve(root, 'artifacts/upstream', pkg, sourceRoot), sourceRoot),
    };
  }));
}

/** The declaration files of an origin root as the pinned archive lists them; a stale file of the extracted directory is not an input. */
export function originFiles(archive: string, dir: string, sourceRoot: string): { path: string; text: string }[] {
  const prefix = sourceRoot + '/';
  const listed = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/)
    .map(entry => entry.replace(/^[^/]+\//, ''))
    .filter(path => path.startsWith(prefix) && path.endsWith('.d.ts'))
    .map(path => path.slice(prefix.length));
  return [...new Set(listed)].sort().map(path => {
    try {
      return { path, text: readFileSync(join(dir, path), 'utf8') };
    } catch {
      throw new Error(`Origin file ${path} of ${archive} is not extracted in ${dir}; run npm run assets:acquire`);
    }
  });
}

export function serializeOriginIndex(index: OriginIndex): string {
  return '{\n  "formatVersion": 1,\n  "sources": [\n'
    + index.sources.map(s => '    ' + JSON.stringify({ ...s, files: undefined }).slice(0, -1) + ',"files":[\n'
      + s.files.map(f => '      ' + JSON.stringify(f)).join(',\n') + '\n    ]}').join(',\n')
    + '\n  ],\n  "declarations": [\n'
    + index.declarations.map(d => '    ' + JSON.stringify([d.package, d.file, d.kind, d.name, d.exact, d.loose, d.anon])).join(',\n')
    + '\n  ]\n}\n';
}

export interface Origin {
  package: string;
  file?: string;
  kind?: string;
  how?: string;
}

interface BundleDeclaration {
  name: string;
  kind: string;
  start: number;
  end: number;
  origin: Origin;
}

interface Bundle {
  text: string;
  lines: number[];
  declarations: BundleDeclaration[];
}

export interface SpanInfo {
  file: string;
  package: string;
  text?: string;
  declaration?: BundleDeclaration;
}

const shimName = (name: string) => /^[a-zA-Z]+_d(\$\d+)?(_|\.|$)/.test(name) || /echarts__ECUMDEXPT__/.test(name);

/** Resolves provenance spans to their enclosing bundled declaration and its unbundled origin. */
export class DeclarationIndex {
  private bundles = new Map<string, Bundle | null>();
  private spans = new Map<string, SpanInfo>();
  private exact = new Map<string, OriginDeclaration[]>();
  private loose = new Map<string, OriginDeclaration[]>();
  private anon = new Map<string, OriginDeclaration[]>();
  private named = new Map<string, OriginDeclaration[]>();
  private provenance: Map<string, Provenance & { id: string }>;
  private read: SourceReader;
  readonly errors: string[] = [];

  constructor(schema: ApiSchema, origin: OriginIndex, read: SourceReader) {
    this.read = read;
    this.provenance = new Map(schema.provenance.map(p => [p.id, p]));
    const add = (map: Map<string, OriginDeclaration[]>, key: string, value: OriginDeclaration) => {
      const list = map.get(key);
      if (list)
        list.push(value);
      else
        map.set(key, [value]);
    };
    for (const d of origin.declarations) {
      add(this.exact, d.name + '\0' + d.exact, d);
      add(this.loose, d.name + '\0' + d.loose, d);
      add(this.anon, d.anon, d);
      add(this.named, d.name, d);
    }
  }

  private bundle(pkg: string, file: string, sha256: string): Bundle | null {
    const key = pkg + '/' + file;
    if (this.bundles.has(key))
      return this.bundles.get(key)!;

    let result: Bundle | null = null;
    if (!['echarts-doc', 'typescript'].includes(pkg) && (file.endsWith('.d.ts') || file.endsWith('.d.cts'))) {
      const text = this.read(pkg, file);
      if (text === undefined)
        this.errors.push(`MISSING_DECLARATION_SOURCE ${key}`);
      else if (digest(text) !== sha256)
        this.errors.push(`DECLARATION_SOURCE_HASH_MISMATCH ${key}`);
      else {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const lines = [0];
        for (let i = 0; i < text.length; i++)
          if (text.charCodeAt(i) === 10)
            lines.push(i + 1);

        const declarations = statements(source)
          .map(d => ({ name: d.prefix + d.names[0], kind: d.kind, start: d.start, end: d.end, origin: this.resolve(d) }))
          .sort((a, b) => a.start - b.start);
        result = { text, lines, declarations };
      }
    }

    this.bundles.set(key, result);
    return result;
  }

  private resolve(d: Statement): Origin {
    if (d.kind === 'ModuleDeclaration' || shimName(d.names[0]))
      return { package: 'shim' };

    const name = baseName(d.names[0]);
    const choose = (candidates: OriginDeclaration[] | undefined, how: string): Origin | undefined => {
      if (!candidates?.length)
        return undefined;

      const packages = [...new Set(candidates.map(c => c.package))];
      return packages.length > 1 ? { package: 'both', how } : { package: packages[0], file: candidates[0].file, kind: candidates[0].kind, how };
    };
    return choose(this.exact.get(name + '\0' + short(d.exact)), 'exact') ?? choose(this.loose.get(name + '\0' + short(d.loose)), 'loose')
      ?? choose(this.anon.get(short(d.anon)), 'anon') ?? choose(this.named.get(name), 'name') ?? { package: 'unknown' };
  }

  span(id: string): SpanInfo {
    const cached = this.spans.get(id);
    if (cached)
      return cached;

    const p = this.provenance.get(id);
    let info: SpanInfo;
    if (!p)
      info = { file: '?', package: '?' };
    else {
      const bundle = this.bundle(p.package, p.file, p.sha256);
      info = { file: p.package + '/' + p.file, package: p.package };
      if (bundle) {
        const start = bundle.lines[p.start.line - 1] + p.start.column - 1;
        const end = bundle.lines[p.end.line - 1] + p.end.column - 1;
        info.text = normalizeDeclaration(stripComments(bundle.text.slice(start, end)));
        let best: BundleDeclaration | undefined;
        for (const d of bundle.declarations) {
          if (d.start > start)
            break;

          if (d.end >= end && (!best || d.start >= best.start))
            best = d;
        }

        info.declaration = best;
      }
    }

    this.spans.set(id, info);
    return info;
  }
}

/** Reads sources referenced by provenance or K9 spans from the pinned upstream archives' extraction. */
export function upstreamSourceReader(root = process.cwd()): SourceReader {
  return (pkg, file) => {
    if (!['echarts', 'zrender'].includes(pkg))
      return undefined;

    const path = resolve(root, 'artifacts/upstream', pkg, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };
}

export interface ScopeInput {
  schema: ApiSchema;
  overrides: MappingOverrides;
  manifest: GeneratedManifest;

  /** Source IDs with a validated manual mapping. */
  manual: Iterable<string>;

  declarations: DeclarationIndex;

  /** Generated C# members whose value is untyped (EChartsValue/NeverValue). */
  looseSymbols?: Set<string>;

  /** Reads pinned runtime sources for K9 spans. */
  read?: SourceReader;
}

export interface ScopeAssignment {
  set: ScopeSet;
  rule: string;
}

export type ScopeStatus = 'generated' | 'manual-mapped' | 'unresolved';

export interface ScopeResult {
  assignments: Map<string, ScopeAssignment>;
  status: Map<string, ScopeStatus>;
  loose: string[];
  errors: string[];

  /** Configuration that classifies nothing: K9 paths that match no documented option. */
  warnings: string[];
}

const docsPackage = 'echarts-doc';
const internalDir = /^(model|view|data|scale|core|layout|label|processor|preprocessor|legacy|loading|renderer|i18n|theme)\//;
const k9Packages = new Set(['echarts', 'zrender']);
const pathMatches = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '.');

/** Classify every schema record into exactly one S set, K category, BONUS or RESIDUAL. */
export function deriveScope(input: ScopeInput): ScopeResult {
  const { schema, overrides, manifest, declarations } = input;
  const errors: string[] = [];
  const types = new Map(schema.types.map(t => [t.id, t]));
  const records = new Map(schema.records.map(r => [r.id, r]));
  const provenance = new Map(schema.provenance.map(p => [p.id, p]));
  const manual = new Set(input.manual);
  const entries = new Map(manifest.entries.map(e => [e.sourceId, e]));
  const status = new Map<string, ScopeStatus>(schema.records.map(r => [
    r.id,
    entries.get(r.id)?.status === 'generated' ? 'generated' : manual.has(r.id) ? 'manual-mapped' : 'unresolved',
  ]));
  const scope: ScopeOverrides = overrides.scope ?? {};
  const ownerOf = (r: ApiRecord) => r.id.slice('property:'.length, r.id.lastIndexOf('/'));
  const declarationSpans = (ids: string[]) => ids.map(id => declarations.span(id)).filter(s => s.package !== docsPackage);
  const ownSpans = (r: ApiRecord) => declarationSpans(r.provenance);
  const typeSpans = (id: string) => declarationSpans(types.get(id)?.provenance ?? []);
  const hasDocs = (r: ApiRecord) => r.provenance.some(id => provenance.get(id)?.package === docsPackage);

  // Type-graph closures. Data edges omit signatures: callback parameters and results are browser-side values (R5).
  const dataEdges = (t: TypeNode, loose: boolean): string[] => [
    ...(t.properties ?? []).map(p => p.type),
    ...t.alternatives ?? [],
    ...t.constituents ?? [],
    ...(t.element ? [t.element] : []),
    ...(t.elements ?? []).map(e => e.type),
    ...(t.target ? [t.target] : []),
    ...(loose ? t.typeArguments ?? [] : []),
    ...(t.indexes ?? []).flatMap(i => [i.key, i.value]),
    ...[
      t.objectType,
      t.indexType,
      t.checkType,
      t.extendsType,
      t.trueType,
      t.falseType,
      t.baseType,
      ...(loose ? [t.constraint, t.default] : []),
    ].filter((v): v is string => !!v),
  ];
  const signatureEdges = (t: TypeNode) => [...t.signatures ?? [], ...t.constructSignatures ?? []].flatMap(
    s => [...s.parameters.map(p => p.type), s.returnType, ...(s.thisType ? [s.thisType] : [])]
  );
  const classTypes = new Set(schema.types.filter(t => typeSpans(t.id).some(s => s.declaration?.kind === 'ClassDeclaration')).map(t => t.id));
  const closure = (roots: Iterable<string>, signatures: boolean, loose = false) => {
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id) || !types.has(id))
        continue;

      seen.add(id);
      if (!signatures && classTypes.has(id))
        continue;

      const t = types.get(id)!;
      queue.push(...dataEdges(t, loose || signatures));
      if (signatures)
        queue.push(...signatureEdges(t));
    }

    return seen;
  };
  const exportTypes = (name: string) => schema.records.filter(r => r.kind === 'export' && r.name === name).map(r => r.type);
  const optionRoots = [
    ...exportTypes('EChartsOption'),
    ...schema.series.map(s => s.type),
  ];
  const optionData = closure(optionRoots, false);
  const optionDataLoose = closure(optionRoots, false, true);
  const optionAll = closure(optionRoots, true);
  const contractSpans = new Set([
    ...(overrides.eventActions ?? []).flatMap(m => [...m.contractSources ?? [], ...m.source ?? []]),
    ...(overrides.eventActionObjects ?? []).flatMap(o => o.contractSources ?? []),
  ]);
  const contractRanges = [...contractSpans].map(id => provenance.get(id)).filter((p): p is Provenance & { id: string } => !!p);
  const insideContract = (id: string) => {
    const p = provenance.get(id);
    return !!p && contractRanges.some(c => c.package === p.package && c.file === p.file
      && (c.start.line < p.start.line || c.start.line === p.start.line && c.start.column <= p.start.column)
      && (c.end.line > p.end.line || c.end.line === p.end.line && c.end.column >= p.end.column));
  };
  const eventNames = new Set([
    ...schema.records.filter(r => r.kind === 'event' || r.kind === 'action').map(r => r.name),
    ...(overrides.eventActions ?? []).map(m => m.runtimeName),
  ]);
  const literals = (id: string): unknown[] => {
    const t = types.get(id);
    return !t ? [] : t.kind === 'literal' ? [t.value] : t.kind === 'union' ? t.alternatives!.flatMap(literals) : [null];
  };
  const discriminated = schema.types.filter(t => (t.properties ?? []).some(p => {
    const values = literals(p.type);
    return p.name === 'type' && values.length > 0 && values.every(v => typeof v === 'string' && eventNames.has(v));
  })).map(t => t.id);
  const dtoFamilies = manifest.families.filter(f => f.id.startsWith('dto:'));
  const dtoFamily = new Map(dtoFamilies.flatMap(f => f.sourceIds.map(id => [id, f.id] as const)));
  const dtoRoots = dtoFamilies.map(f => records.get(f.rootSourceId)?.type).filter((t): t is string => !!t);
  const eventData = closure(
    [...schema.types.filter(t => t.provenance.some(id => contractSpans.has(id))).map(t => t.id), ...dtoRoots, ...discriminated],
    false
  );
  const instanceIds = new Set((overrides.instanceMethods ?? []).map(m => m.recordId));
  const nativeOnly = new Map((scope.nativeOnly ?? []).map(n => [n.recordId, n]));
  const globalOwners = new Map((overrides.globalMethods ?? []).map(m => [m.recordId, m.owner]));
  const methodData = closure(
    schema.records.filter(r => manual.has(r.id)).flatMap(r => {
      const t = types.get(r.type);
      return t ? signatureEdges(t) : [];
    }),
    false
  );
  const composition = closure(exportTypes('ComposeOption'), false, true);
  const valueAll = closure(schema.records.filter(r => r.kind === 'export' && r.exportSpace !== 'type').map(r => r.type), true);

  // Documented pseudo-paths that describe callback arguments or results.
  const docsByPath = new Map(schema.records.filter(r => r.kind === 'documented').map(r => [r.publicPath, r]));
  const callbackAncestor = (path: string) => {
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 1; i--) {
      const docsTypes = docsByPath.get(parts.slice(0, i).join('.'))?.inventory?.docsTypes ?? [];
      if (docsTypes.includes('Function') && !docsTypes.includes('Object'))
        return parts.slice(0, i).join('.');
    }

    return undefined;
  };
  const read = input.read ?? (() => undefined);
  const k9Groups: ScopeK9Group[] = [];
  const spanHolds = (span: ScopeK9Span | undefined) => {
    const text = span && k9Packages.has(span.package) ? read(span.package, span.file) : undefined;
    const lines = text?.split('\n').length ?? 0;
    return text !== undefined && digest(text) === span!.sha256 && span!.startLine >= 1 && span!.startLine <= span!.endLine && span!.endLine <= lines;
  };
  for (const group of scope.k9 ?? []) {
    const spans = Array.isArray(group.runtime) ? group.runtime : [group.runtime];
    if (!group.reason?.trim() || !group.paths?.length || !spans.length || !spans.every(spanHolds))
      errors.push(`K9_RUNTIME_SPAN_INVALID ${group.id}`);
    else
      k9Groups.push(group);
  }

  const k9 = (r: ApiRecord) =>
    r.kind === 'documented' && r.publicPath.startsWith('option.') ? k9Groups.find(g => g.paths.some(p => pathMatches(r.publicPath, p))) : undefined;
  for (const n of nativeOnly.values()) {
    const r = records.get(n.recordId);
    if (!r || !hasDocs(r) || globalOwners.get(r.id) !== 'native' || !n.reason?.trim())
      errors.push(`INVALID_NATIVE_ONLY ${n.recordId}`);
  }

  // A runtime registration with a documented event/action of the same runtime name is that S2 record's twin.
  const eventRuntimeNames = new Map((overrides.eventActions ?? []).map(m => [m.recordId, m.runtimeName]));
  const documentedRuntime = new Map(schema.records
    .filter(r => r.kind === 'event' || r.kind === 'action')
    .map(r => [r.kind + ':' + (eventRuntimeNames.get(r.id) ?? r.inventory?.runtimeName ?? r.name), r.id]));
  const runtimeTwin = (r: ApiRecord) => r.family === 'runtime-registration-candidates'
    ? documentedRuntime.get((r.inventory?.category === 'runtime-event' ? 'event:' : 'action:') + (r.inventory?.runtimeName ?? r.name)) : undefined;
  const inScope = (r: ApiRecord): ScopeAssignment | undefined => {
    if (r.kind === 'documented' && r.publicPath.startsWith('option.'))
      return { set: 'S1', rule: 'documented option path' };

    if (r.kind === 'event' || r.kind === 'action')
      return { set: 'S2', rule: 'documented ' + r.kind };

    if (r.family === 'runtime-registration-candidates' && !runtimeTwin(r))
      return { set: 'S2', rule: 'runtime-registered event/action' };

    if (instanceIds.has(r.id) || r.publicPath.startsWith('echartsInstance.'))
      return { set: 'S3', rule: 'echartsInstance member' };

    if ((r.kind === 'method' || r.kind === 'graphic' || r.kind === 'documented')
      && r.publicPath.startsWith('echarts.')
      && hasDocs(r)
      && !nativeOnly.has(r.id))
      return { set: 'S3', rule: 'documented echarts global' };

    if (dtoFamily.has(r.id))
      return { set: 'S5', rule: dtoFamily.get(r.id)! };

    return undefined;
  };

  // K1: identity of a declaration, independent of the bundle that carries it.
  const display = (id: string) => normalizeDeclaration(types.get(id)?.display ?? '');
  const spanTexts = (ids: string[]) => declarationSpans(ids).map(s => s.text ?? s.file).join('||');
  const bundleRank = (file: string) =>
    /types\/dist\/echarts\.d\.cts$/.test(file) ? 2 : /types\/dist\/echarts\.d\.ts$|^echarts\/index\.d\.ts$/.test(file) ? 1 : 0;
  const identity = (r: ApiRecord): { key: string; rank: number; tie: number } | undefined => {
    if (r.kind === 'property') {
      const owner = types.get(ownerOf(r));
      const ownerKey = owner ? owner.kind + '#' + display(owner.id) + '#' + spanTexts(owner.provenance) : '?';
      const files = [...ownSpans(r), ...typeSpans(ownerOf(r))].map(s => s.file).filter(f => f.startsWith('echarts/'));
      return {
        key: 'P|' + short(ownerKey) + '|' + r.name + '|' + short(spanTexts(r.provenance)) + '|' + short(display(r.type)),
        rank: Math.max(0, ...files.map(bundleRank)),
        tie: 0,
      };
    }

    if (r.kind === 'export') {
      const entry = r.publicPath.split('::')[0];
      return {
        key: 'E|' + r.publicPath.split('::').slice(1).join('::') + '|' + r.exportSpace + '|' + short(display(r.type)),
        rank: bundleRank((r.canonicalId.match(/^symbol:([^#]+)#/) ?? ['', ''])[1]),
        tie: entry === 'echarts/types/dist/all.d.ts' ? 0 : entry.startsWith('echarts/types/dist/') ? 1 : 2,
      };
    }

    if (r.kind === 'definition' || r.kind === 'contract') {
      const files = ownSpans(r).map(s => s.file).filter(f => f.startsWith('echarts/'));
      return {
        key: r.kind + '|' + (r.kind === 'definition' ? baseName(r.name) : '') + '|' + short(spanTexts(r.provenance)) + '|' + short(display(r.type)),
        rank: Math.max(0, ...files.map(bundleRank)),
        tie: 0,
      };
    }

    return undefined;
  };
  const groups = new Map<string, { id: string; rank: number; tie: number; kind: string }[]>();
  for (const r of schema.records) {
    const key = identity(r);
    if (!key)
      continue;

    const list = groups.get(key.key);
    if (list)
      list.push({ id: r.id, rank: key.rank, tie: key.tie, kind: r.kind });
    else
      groups.set(key.key, [{ id: r.id, rank: key.rank, tie: key.tie, kind: r.kind }]);
  }

  const duplicateOf = new Map<string, string>();
  const copies: string[][] = [];
  for (const list of groups.values()) {
    if (list.length < 2)
      continue;

    copies.push(list.map(m => m.id));
    const best = list.reduce((a, b) => b.rank < a.rank || b.rank === a.rank && (b.tie < a.tie || b.tie === a.tie && b.id < a.id) ? b : a);
    for (const m of list)
      if (m !== best && (m.rank > best.rank || m.kind === 'export'))
        duplicateOf.set(m.id, best.id);
  }

  // K7: TS declarations twinned with an S record.
  const sRecords = schema.records.filter(r => !(r.kind === 'documented' && callbackAncestor(r.publicPath)) && !k9(r) && inScope(r));
  const linked = new Map<string, string>();
  for (const r of sRecords)
    for (const id of r.inventory?.declarationIds ?? [])
      if (!linked.has(id))
        linked.set(id, r.id);

  const documentedSeries = new Set(
    schema.records.filter(r => r.kind === 'documented' && /^option\.series\.[^.]+$/.test(r.publicPath)).map(r => r.publicPath.split('.')[2])
  );
  const registryTypes = new Set(exportTypes('RegisteredSeriesOption'));
  const sSymbols = new Set<string>();
  const sClassMembers = new Set<string>();
  for (const r of sRecords) {
    const e = entries.get(r.id);
    if (e?.status !== 'generated')
      continue;

    for (const t of [e, ...e.targets ?? []])
      if (t.symbol.includes('.')) {
        sSymbols.add(t.symbol);
        sClassMembers.add(t.symbol.slice(0, t.symbol.lastIndexOf('.')) + '|' + r.name);
      }
  }

  const ownerClasses = new Map<string, Set<string>>();
  for (const r of schema.records) {
    const e = entries.get(r.id);
    if (e?.status !== 'generated' || !e.symbol)
      continue;

    const key = r.kind === 'property' && e.symbol.includes('.')
      ? ownerOf(r)
      : (r.kind === 'export' || r.kind === 'definition') && !e.symbol.includes('.') ? r.type : undefined;
    if (!key)
      continue;

    const set = ownerClasses.get(key) ?? new Set<string>();
    set.add(e.symbol.includes('.') ? e.symbol.slice(0, e.symbol.lastIndexOf('.')) : e.symbol);
    ownerClasses.set(key, set);
  }

  const documentedTypes = new Set([
    ...sRecords.map(r => r.type),
    ...[...linked.keys()].map(id => records.get(id)?.type).filter((t): t is string => !!t),
    ...optionRoots,
  ]);
  const directTwin = (r: ApiRecord): string | undefined => {
    if (linked.has(r.id))
      return 'declaration of ' + linked.get(r.id);

    if (runtimeTwin(r))
      return 'runtime registration of ' + runtimeTwin(r);

    if (r.kind === 'series' && documentedSeries.has(r.name))
      return 'series registry entry of option.series.' + r.name;

    if (r.kind === 'property' && registryTypes.has(ownerOf(r)) && documentedSeries.has(r.name))
      return 'RegisteredSeriesOption member of option.series.' + r.name;

    if ((r.kind === 'export' || r.kind === 'definition') && registryTypes.has(r.type))
      return 'series registry of option.series';

    const e = entries.get(r.id);
    if (e?.status === 'generated' && sSymbols.has(e.symbol))
      return 'same C# member as a documented path';

    if (r.kind === 'property')
      for (const c of ownerClasses.get(ownerOf(r)) ?? [])
        if (sClassMembers.has(c + '|' + r.name))
          return 'member of a C# class with the documented member ' + r.name;

    const owner = r.kind === 'property' ? types.get(ownerOf(r)) : undefined;
    if (r.provenance.some(id => contractSpans.has(id) || insideContract(id)) || owner?.provenance.some(id => contractSpans.has(id)))
      return 'event/action contract source';

    if (r.kind === 'property' && eventData.has(ownerOf(r)))
      return 'event/action/DTO payload member';

    if ((r.kind === 'export' || r.kind === 'definition') && (documentedTypes.has(r.type) || eventData.has(r.type)))
      return 'type alias of a documented type';

    return undefined;
  };
  const origins = (r: ApiRecord): Origin[] => {
    const own = ownSpans(r).filter(s => s.declaration).map(s => s.declaration!.origin);
    if (own.length || r.kind !== 'property')
      return own;

    return typeSpans(ownerOf(r)).filter(s => s.declaration).map(s => s.declaration!.origin);
  };
  const twins = new Map<string, string>();
  for (const r of schema.records) {
    const t = directTwin(r);
    if (t)
      twins.set(r.id, t);
  }

  const memberSpan = (r: ApiRecord) => r.provenance.join(',');
  const zrenderOwned = (r: ApiRecord) => {
    const o = origins(r).filter(x => x.package !== 'shim');
    return o.length > 0 && o.every(x => x.package === 'zrender');
  };
  const callbackOnly = (id: string) => optionAll.has(id) && !optionDataLoose.has(id) && !eventData.has(id);
  const directSpans = new Set(schema.records.filter(r => r.kind === 'property' && twins.has(r.id)).map(memberSpan));
  for (const r of schema.records)
    if (r.kind === 'property'
      && !twins.has(r.id)
      && directSpans.has(memberSpan(r))
      && !classTypes.has(ownerOf(r))
      && !zrenderOwned(r)
      && !callbackOnly(ownerOf(r)))
      twins.set(r.id, 'same member declaration as a twin');

  for (const ids of copies) {
    const twin = ids.find(id => twins.has(id) && twins.get(id) !== 'same member declaration as a twin');
    if (twin)
      for (const id of ids)
        if (!twins.has(id))
          twins.set(id, 'bundle copy of a twin');
  }

  const callable = (id: string): boolean => {
    const t = types.get(id);
    return !!t && (!!(t.signatures?.length || t.constructSignatures?.length) || t.kind === 'generic-reference' && callable(t.target!));
  };
  const classify = (r: ApiRecord, copy: boolean): ScopeAssignment => {
    const owner = r.kind === 'property' ? ownerOf(r) : r.type;
    const ownerType = types.get(owner);
    const tsFiles = ownSpans(r).map(s => s.file);
    const all = origins(r);
    const real = all.filter(o => o.package !== 'shim');
    const src = real.filter(o => o.package === 'echarts-src');
    const names = ownSpans(r).filter(s => s.declaration).map(s => s.declaration!.name);
    const recordType = types.get(r.type);
    const valueExport = r.kind === 'export'
      && r.exportSpace !== 'type'
      && (!!(recordType?.signatures?.length || recordType?.constructSignatures?.length) || /^typeof /.test(recordType?.display ?? ''));
    const pick = (): ScopeAssignment => {
      const ancestor = r.kind === 'documented' && r.publicPath.startsWith('option.') ? callbackAncestor(r.publicPath) : undefined;
      if (ancestor)
        return { set: 'K5d', rule: 'documented pseudo-path inside callback ' + ancestor };

      const k9Group = k9(r);
      if (k9Group)
        return { set: 'K9', rule: k9Group.id };

      const s = inScope(r);
      if (s)
        return s;

      if (tsFiles.length && tsFiles.every(f => f.startsWith('typescript/')))
        return { set: 'K3', rule: 'TypeScript lib declaration' };

      if (!copy && duplicateOf.has(r.id))
        return { set: 'K1', rule: 'bundle duplicate of ' + duplicateOf.get(r.id) };

      if (twins.has(r.id))
        return { set: 'K7', rule: twins.get(r.id)! };

      if (real.length && real.every(o => o.package === 'zrender'))
        return { set: 'K2', rule: 'ZRender declaration' };

      if (src.length && !optionData.has(owner) && !eventData.has(owner)
        && (src.every(o => o.kind === 'ClassDeclaration') && names.every(n => n !== 'ECharts') || src.every(o => internalDir.test(o.file ?? ''))))
        return { set: 'K4', rule: 'ECharts runtime model' };

      if (methodData.has(owner) && !classTypes.has(owner) && !optionDataLoose.has(owner))
        return { set: 'K7m', rule: 'manual-mapped method parameter/result shape' };

      if (r.kind === 'property' && !optionData.has(owner) && optionAll.has(owner) && !eventData.has(owner))
        return { set: 'K5a', rule: 'value inside a JS callback' };

      if (r.id.startsWith('public:custom.renderItem.api.'))
        return { set: 'K5r', rule: 'custom.renderItem api' };

      if (!optionData.has(owner) && optionAll.has(owner) && !eventData.has(owner))
        return { set: 'K5a', rule: 'type inside a JS callback' };

      if (nativeOnly.has(r.id))
        return { set: 'K6b', rule: nativeOnly.get(r.id)!.reason };

      if (!real.length && all.length)
        return { set: 'K6', rule: 'bundler namespace shim' };

      if (valueExport)
        return { set: 'K6', rule: 'installer or value export' };

      if (r.kind === 'property' && /^typeof \w+_d(\$\d+)?\b/.test(ownerType?.display ?? ''))
        return { set: 'K6', rule: 'bundler namespace shim member' };

      if (globalOwners.has(r.id) && !hasDocs(r))
        return { set: 'K6', rule: 'undocumented global native' };

      if (tsFiles.some(f => f.startsWith('echarts/ssr/client/')))
        return { set: 'K6', rule: 'SSR client entry' };

      if (!optionData.has(owner) && valueAll.has(owner) && !eventData.has(owner) && !optionAll.has(owner))
        return { set: 'K6', rule: 'reachable only from helper/installer signatures' };

      if (r.kind === 'property' && r.name === 'mainType' && optionDataLoose.has(owner))
        return { set: 'K8', rule: 'option composition discriminator' };

      if (callable(r.type) && optionAll.has(r.type))
        return { set: 'K8', rule: 'callback alias' };

      if (r.kind === 'property' && optionDataLoose.has(owner))
        return { set: 'K8', rule: 'undocumented TS option member' };

      if ((r.kind === 'export' || r.kind === 'definition') && optionDataLoose.has(r.type))
        return { set: 'K8', rule: 'undocumented TS option type name' };

      if (composition.has(owner))
        return { set: 'K8', rule: 'option composition machinery' };

      return { set: status.get(r.id) === 'unresolved' ? 'RESIDUAL' : 'BONUS', rule: '' };
    };
    return pick();
  };
  const groupOf = new Map(copies.flatMap(ids => ids.map(id => [id, ids] as const)));
  const assignments = new Map<string, ScopeAssignment>();
  for (const r of schema.records) {
    let assignment = classify(r, false);

    // A canonical bundle copy shares the category its other copies carry structurally.
    if (assignment.set === 'RESIDUAL' || assignment.set === 'BONUS')
      for (const id of groupOf.get(r.id) ?? []) {
        if (id === r.id)
          continue;

        const other = classify(records.get(id)!, true);
        if (!['RESIDUAL', 'BONUS', 'K1'].includes(other.set)) {
          assignment = { set: other.set, rule: other.rule + ' (bundle copy)' };
          break;
        }
      }

    assignments.set(r.id, assignment);
  }

  // Untyped C# values are exact only for upstream `any`.
  const looseAllowed = new Set((scope.looseValues ?? []).map(l => l.path));
  for (const l of scope.looseValues ?? [])
    if (!docsByPath.has(l.path) || !l.reason?.trim())
      errors.push(`STALE_LOOSE_VALUE_OVERRIDE ${l.path}`);

  const loose: string[] = [];
  if (input.looseSymbols)
    for (const r of schema.records) {
      if (assignments.get(r.id)!.set !== 'S1' || status.get(r.id) !== 'generated')
        continue;

      if ((r.inventory?.docsTypes ?? []).includes('*') || looseAllowed.has(r.publicPath))
        continue;

      const e = entries.get(r.id)!;
      if ([e, ...e.targets ?? []].some(t => input.looseSymbols!.has(t.symbol)))
        loose.push(r.id);
    }

  errors.push(...declarations.errors);
  const warnings: string[] = [];
  const optionPaths = schema.records.filter(r => r.kind === 'documented' && r.publicPath.startsWith('option.')).map(r => r.publicPath);
  for (const group of k9Groups)
    for (const path of group.paths)
      if (!optionPaths.some(p => pathMatches(p, path)))
        warnings.push(`UNUSED_K9_PATH ${group.id} ${path}`);

  return { assignments, status, loose, errors, warnings };
}

const setOrder: ScopeSet[] = [...scopeSets, ...scopeCategories, 'BONUS', 'RESIDUAL'];

/** Committed membership: one line per non-S record (properties grouped by owner type); S sets are counted only. */
export function serializeScopeCategories(result: ScopeResult): string {
  const counts = Object.fromEntries(setOrder.map(s => [s, 0])) as Record<ScopeSet, number>;
  const lines = new Map<string, { set: ScopeSet; key: string; names?: string[] }>();
  for (const [id, a] of result.assignments) {
    counts[a.set]++;
    if ((scopeSets as readonly string[]).includes(a.set))
      continue;

    const property = id.startsWith('property:');
    const key = property ? id.slice('property:'.length, id.lastIndexOf('/')) : id;
    const line = lines.get(a.set + '\0' + key) ?? { set: a.set, key, ...(property ? { names: [] } : {}) };
    if (property)
      line.names!.push(id.slice(id.lastIndexOf('/') + 1));

    lines.set(a.set + '\0' + key, line);
  }

  const sorted = [...lines.values()].sort(
    (a, b) => setOrder.indexOf(a.set) - setOrder.indexOf(b.set) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
  return '{\n  "formatVersion": 1,\n  "summary": '
    + JSON.stringify(counts)
    + ',\n  "records": [\n'
    + sorted.map(l => '    ' + JSON.stringify(l.names ? [l.set, 'property:' + l.key + '/', l.names.sort()] : [l.set, l.key])).join(',\n')
    + '\n  ]\n}\n';
}

function membership(text: string): Map<string, string> {
  const parsed = JSON.parse(text) as { records: ([string, string] | [string, string, string[]])[] };
  const map = new Map<string, string>();
  for (const line of parsed.records) {
    if (line.length === 3)
      for (const name of line[2])
        map.set(line[1] + name, line[0]);
    else
      map.set(line[1], line[0]);
  }

  return map;
}

/** Any membership change needs review: a new upstream member or a rule change must be regenerated and committed. */
export function compareScopeCategories(committed: string | undefined, expected: string): string[] {
  if (committed === undefined)
    return ['SCOPE_CATEGORY_DRIFT missing committed scope categories'];

  if (committed === expected)
    return [];

  let before: Map<string, string>;
  try {
    before = membership(committed);
  } catch {
    return ['SCOPE_CATEGORY_DRIFT unreadable committed scope categories'];
  }

  const after = membership(expected);
  const errors: string[] = [];
  for (const [id, set] of after) {
    const old = before.get(id);
    if (old === undefined)
      errors.push(`SCOPE_CATEGORY_DRIFT added ${set} ${id}`);
    else if (old !== set)
      errors.push(`SCOPE_CATEGORY_DRIFT moved ${old}->${set} ${id}`);
  }

  for (const [id, set] of before)
    if (!after.has(id))
      errors.push(`SCOPE_CATEGORY_DRIFT removed ${set} ${id}`);

  return errors.length ? errors : ['SCOPE_CATEGORY_DRIFT summary or format changed'];
}

export interface ScopeSetSummary {
  total: number;
  generated: number;
  manualMapped: number;
  unresolved: number;
}

export function scopeSummary(assignments: Map<string, ScopeAssignment>, status: (id: string) => ScopeStatus) {
  const sets = Object.fromEntries(
    setOrder.map(s => [s, { total: 0, generated: 0, manualMapped: 0, unresolved: 0 }])
  ) as Record<ScopeSet, ScopeSetSummary>;
  for (const [id, a] of assignments) {
    const s = sets[a.set];
    const st = status(id);
    s.total++;
    if (st === 'generated')
      s.generated++;
    else if (st === 'manual-mapped')
      s.manualMapped++;
    else
      s.unresolved++;
  }

  const inScope = scopeSets.map(s => sets[s]);
  const excluded = scopeCategories.map(s => sets[s]);
  return {
    sets,
    s: { total: inScope.reduce((n, s) => n + s.total, 0), unresolved: inScope.reduce((n, s) => n + s.unresolved, 0) },
    k: { total: excluded.reduce((n, s) => n + s.total, 0) },
    bonus: excluded.reduce((n, s) => n + s.generated + s.manualMapped, 0) + sets.BONUS.total,
    residual: sets.RESIDUAL.total,
  };
}
