import { createHash } from 'node:crypto';
import type { ApiRecord, ApiSchema, TypeNode } from '../../../tools/BindingGenerator/src/schema.ts';
import type { GeneratedManifest, ManifestEntry } from '../../../tools/BindingGenerator/src/generation-model.ts';
import type { MappingOverrides } from '../../../tools/BindingGenerator/src/validate-overrides.ts';
import {
  createOriginIndex,
  DeclarationIndex,
  deriveScope,
  type OriginSource,
  type SourceReader,
} from '../../../tools/BindingGenerator/src/scope-categories.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const sharedFile = 'types/dist/shared.d.ts';
const cjsFile = 'types/dist/echarts.d.cts';
const arcFile = 'lib/graphic/shape/Arc.js';

export const shared = [
  'interface EChartsOption { title?: string; formatter?: Formatter; misc?: UndocumentedOption; }',
  'type Formatter = (params: CallbackParams) => string;',
  'interface CallbackParams { dataIndex: number; }',
  'declare class Element { onclick: string; }',
  'declare class SeriesModel { getData: number; }',
  'interface UseOptions { lazy: boolean; }',
  'declare function use(options: UseOptions): void;',
  'interface UndocumentedOption { extra: number; }',
  'interface ResizeOpts { width: number; }',
  'interface InitOpts { renderer: string; }',
  'interface Orphan { lost: number; }',
].join('\n') + '\n';

export const arcRuntime = 'var ArcShape = function () {\n  this.r = 0;\n};\n';

export const originSources: OriginSource[] = [
  {
    package: 'zrender',
    version: '6.1.0',
    archiveSha256: 'a'.repeat(64),
    root: 'lib',
    files: [{ path: 'Element.d.ts', text: 'declare class Element { onclick: string; }\n' }],
  },
  {
    package: 'echarts',
    version: '6.1.0',
    archiveSha256: 'b'.repeat(64),
    root: 'types/src',
    files: [{ path: 'model/Series.d.ts', text: 'declare class SeriesModel { getData: number; }\n' }],
  },
];

function locate(text: string, snippet: string, line?: number) {
  const from = line === undefined ? 0 : text.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  const start = text.indexOf(snippet, from);
  if (start < 0)
    throw new Error(`Snippet not found: ${snippet}`);

  const position = (offset: number) => {
    const lines = text.slice(0, offset).split('\n');
    return { line: lines.length, column: lines.at(-1)!.length + 1 };
  };
  return { start: position(start), end: position(start + snippet.length) };
}

/** A miniature schema with one record per scope rule; mutations work on a fresh copy. */
export function scopeFixture() {
  const provenance: ApiSchema['provenance'] = [];
  const span = (id: string, pkg: string, file: string, text: string, snippet: string, line?: number) => {
    if (provenance.some(p => p.id === id))
      return id;

    provenance.push({ id, package: pkg, version: '6.1.0', file, sha256: sha(text), ...locate(text, snippet, line) });
    return id;
  };
  const docs = (id: string) => {
    provenance.push({
      id,
      package: 'echarts-doc',
      version: 'fixture',
      file: 'normalized/records.jsonl',
      sha256: 'd'.repeat(64),
      start: { line: 1, column: 1 },
      end: { line: 1, column: 2 },
    });
    return id;
  };
  const lines = shared.split('\n');
  const statement = (n: number, file = sharedFile) =>
    span(`source:${file === cjsFile ? 'cjs' : 'shared'}:${n}`, 'echarts', file, shared, lines[n - 1], n);
  const member = (n: number, snippet: string, file = sharedFile) =>
    span(`source:${file === cjsFile ? 'cjs' : 'shared'}:${n}:${snippet}`, 'echarts', file, shared, snippet, n);
  const primitive = (kind: string): TypeNode => ({ id: kind, kind, display: kind, provenance: [] });
  const object = (
    id: string,
    display: string,
    line: number,
    props: [string, string, string][],
    file = sharedFile,
    signatures: TypeNode['signatures'] = []
  ): TypeNode => ({
    id,
    kind: 'object',
    display,
    provenance: [statement(line, file)],
    signatures,
    constructSignatures: [],
    indexes: [],
    properties: props.map(([name, type, snippet]) => ({ name, type, optional: true, readonly: false, provenance: [member(line, snippet, file)] })),
  });
  const types: TypeNode[] = [
    primitive('string'),
    primitive('number'),
    primitive('boolean'),
    primitive('void'),
    object('t:option', 'EChartsOption', 1, [
      ['title', 'string', 'title?: string;'],
      ['formatter', 't:formatter', 'formatter?: Formatter;'],
      ['misc', 't:undoc', 'misc?: UndocumentedOption;'],
    ]),
    object('t:optionCjs', 'EChartsOption', 1, [['title', 'string', 'title?: string;']], cjsFile),
    object('t:formatter', '(params: CallbackParams) => string', 2, [], sharedFile, [
      { parameters: [{ name: 'params', type: 't:params', optional: false, rest: false }], returnType: 'string', typeParameters: [], provenance: [] },
    ]),
    object('t:params', 'CallbackParams', 3, [['dataIndex', 'number', 'dataIndex: number;']]),
    object('t:element', 'Element', 4, [['onclick', 'string', 'onclick: string;']]),
    object('t:model', 'SeriesModel', 5, [['getData', 'number', 'getData: number;']]),
    object('t:useOptions', 'UseOptions', 6, [['lazy', 'boolean', 'lazy: boolean;']]),
    object('t:use', '(options: UseOptions) => void', 7, [], sharedFile, [
      {
        parameters: [{ name: 'options', type: 't:useOptions', optional: false, rest: false }],
        returnType: 'void',
        typeParameters: [],
        provenance: [],
      },
    ]),
    object('t:undoc', 'UndocumentedOption', 8, [['extra', 'number', 'extra: number;']]),
    object('t:resizeOpts', 'ResizeOpts', 9, [['width', 'number', 'width: number;']]),
    object('t:resize', '(opts: ResizeOpts) => void', 9, [], sharedFile, [
      { parameters: [{ name: 'opts', type: 't:resizeOpts', optional: false, rest: false }], returnType: 'void', typeParameters: [], provenance: [] },
    ]),
    object('t:initOpts', 'InitOpts', 10, [['renderer', 'string', 'renderer: string;']]),
    object('t:orphan', 'Orphan', 11, [['lost', 'number', 'lost: number;']]),
  ];
  provenance.push({
    id: 'source:lib',
    package: 'typescript',
    version: '6.0.3',
    file: 'lib.es5.d.ts',
    sha256: 'c'.repeat(64),
    start: { line: 1, column: 1 },
    end: { line: 1, column: 2 },
  });
  const record = (
    id: string,
    kind: ApiRecord['kind'],
    name: string,
    publicPath: string,
    type: string,
    sources: string[],
    extra: Partial<ApiRecord> = {}
  ): ApiRecord =>
  ({
    id,
    kind,
    name,
    publicPath,
    canonicalId: id,
    type,
    provenance: sources,
    family: 'fixture',
    status: 'unresolved',
    implementationReferences: [],
    testReferences: [],
    ...extra,
  });
  const property = (owner: string, name: string) => {
    const t = types.find(x => x.id === owner)!;
    const p = t.properties!.find(x => x.name === name)!;
    return record(`property:${owner}/${name}`, 'property', name, `${t.display}.${name}`, p.type, p.provenance);
  };
  const documented = (path: string, type: string, docsTypes: string[], declarationIds: string[] = []) =>
    record(`public:${path}`, 'documented', path.split('.').at(-1)!, path, type, [docs(`docs:${path}`)], {
      inventory: { category: 'option', requirements: [], declarationIds, docsTypes },
    });
  const records: ApiRecord[] = [
    record('export:echarts/index.d.ts::EChartsOption', 'export', 'EChartsOption', 'echarts/index.d.ts::EChartsOption', 't:option', [statement(1)], {
      exportSpace: 'type',
    }),
    property('t:option', 'title'),
    property('t:option', 'formatter'),
    property('t:option', 'misc'),
    property('t:optionCjs', 'title'),
    property('t:params', 'dataIndex'),
    property('t:element', 'onclick'),
    property('t:model', 'getData'),
    property('t:useOptions', 'lazy'),
    record('export:echarts/index.d.ts::use', 'export', 'use', 'echarts/index.d.ts::use', 't:use', [statement(7)], { exportSpace: 'value' }),
    property('t:undoc', 'extra'),
    property('t:resizeOpts', 'width'),
    record('symbol:typescript#Lib', 'definition', 'Lib', 'typescript#Lib', 'string', ['source:lib']),
    record('public:custom.renderItem.api.value', 'contract', 'value', 'custom.renderItem.api.value', 'string', [docs('docs:renderItem.api.value')]),
    record('public:echarts.setPlatformAPI', 'method', 'setPlatformAPI', 'echarts.setPlatformAPI', 'string', [docs('docs:setPlatformAPI')]),
    record('public:echartsInstance.resize', 'method', 'resize', 'echartsInstance.resize', 't:resize', [docs('docs:resize')]),
    documented('option.title', 'string', ['string'], ['property:t:option/title']),
    documented('option.formatter', 't:formatter', ['Function'], ['property:t:option/formatter']),
    documented('option.formatter.params', 't:params', ['Object']),
    documented('option.graphic.elements.arc.shape.r0', 'number', ['number']),
    record('public:events.click', 'event', 'click', 'events.click', 'string', [docs('docs:click')]),
    record('export:echarts/index.d.ts::InitOpts', 'export', 'InitOpts', 'echarts/index.d.ts::InitOpts', 't:initOpts', [statement(10)], {
      exportSpace: 'type',
    }),
    property('t:initOpts', 'renderer'),
  ];
  const schema: ApiSchema = {
    formatVersion: 1,
    compilerVersion: '6.0.3',
    sources: [],
    roots: [],
    series: [],
    diagnostics: [],
    provenance,
    types,
    records,
  };
  const entry = (sourceId: string, symbol: string, typeId = 'string'): ManifestEntry => ({
    sourceId,
    typeId,
    family: 'fixture',
    families: ['fixture'],
    status: 'generated',
    symbol,
    file: 'Fixture.cs',
    serializer: 'Fixture.Write',
    reader: 'Fixture.Read',
    alternatives: [typeId],
  });
  const manifest: GeneratedManifest = {
    formatVersion: 1,
    sourceHash: '',
    signatures: [],
    entries: [
      entry('public:option.title', 'ChartOptions.Title'),
      entry('property:t:option/title', 'ChartOptions.Title'),
      entry('public:option.formatter', 'ChartOptions.Formatter', 't:formatter'),
      entry('public:events.click', 'ChartEvents.Click'),
      entry('export:echarts/index.d.ts::InitOpts', 'InitOptions', 't:initOpts'),
      entry('property:t:initOpts/renderer', 'InitOptions.Renderer'),
    ],
    files: [
      {
        path: 'Fixture.cs',
        sha256: 'e'.repeat(64),
        symbols: [
          'ChartOptions.Title', 'ChartOptions.Formatter', 'ChartEvents.Click', 'InitOptions', 'InitOptions.Renderer', 'Fixture.Write', 'Fixture.Read',
        ],
      },
    ],
    families: [
      {
        id: 'dto:init',
        rootSourceId: 'export:echarts/index.d.ts::InitOpts',
        sourceIds: ['export:echarts/index.d.ts::InitOpts', 'property:t:initOpts/renderer'],
      },
    ],
  };
  const overrides: MappingOverrides = {
    formatVersion: 1,
    mappings: [],
    eventActions: [],
    eventActionObjects: [],
    instanceMethods: [
      {
        recordId: 'public:echartsInstance.resize',
        expectedSignature: '',
        owner: 'instance',
        status: 'implemented',
        symbol: 'ResizeAsync',
        implementation: ['Fixture.cs'],
        tests: ['fixture.test.ts'],
        pending: '',
      },
    ],
    globalMethods: [
      {
        recordId: 'public:echarts.setPlatformAPI',
        expectedSignature: '',
        owner: 'native',
        symbol: 'echarts.setPlatformAPI',
        reason: 'fixture',
        implementation: [],
        tests: [],
      },
    ],
    scope: {
      k9: [
        {
          id: 'graphic-arc-r0',
          reason: 'ArcShape has no inner radius.',
          paths: ['option.graphic.elements.arc.shape.r0'],
          runtime: { package: 'zrender', file: arcFile, sha256: sha(arcRuntime), startLine: 1, endLine: 3 },
        },
      ],
      nativeOnly: [{ recordId: 'public:echarts.setPlatformAPI', reason: 'Browser platform primitives.' }],
      looseValues: [],
    },
  };
  const sources = new Map([['echarts/' + sharedFile, shared], ['echarts/' + cjsFile, shared], ['zrender/' + arcFile, arcRuntime]]);
  const read: SourceReader = (pkg, file) => sources.get(pkg + '/' + file);
  return {
    schema,
    manifest,
    overrides,
    manual: ['public:echartsInstance.resize'],
    read,
    origin: createOriginIndex(originSources),
    looseSymbols: new Set<string>(),
  };
}

export type ScopeFixture = ReturnType<typeof scopeFixture>;

export function deriveFixture(f: ScopeFixture) {
  return deriveScope({
    schema: f.schema,
    overrides: f.overrides,
    manifest: f.manifest,
    manual: f.manual,
    read: f.read,
    declarations: new DeclarationIndex(f.schema, f.origin, f.read),
    looseSymbols: f.looseSymbols,
  });
}
