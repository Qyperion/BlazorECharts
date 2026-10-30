import { existsSync, globSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import ts from 'typescript';

export interface DocsCheckConfig {
  /** Public documents, as globs relative to the root. */
  documents: string[];

  exclude: string[];

  /** Internal paths that public documents must not link to. */
  internal: string[];

  /** Directories with compiled sources that define snippets. */
  snippets: string[];

  /** Web URLs of this repository: links to their `main` or release tag `v<version>` paths are checked as local paths. */
  repositoryUrls?: string[];

  /** Projects of the shipped packages, as globs: a project whose PackageId differs from its file name is never named as a package. */
  packageProjects?: string[];
}

export interface DocsCheckResult {
  errors: string[];
  documents: number;
  links: number;
  snippets: number;
}

export const defaultConfig: DocsCheckConfig = {
  documents: [
    'README.md', 'CHANGELOG.md', 'SECURITY.md', 'THIRD-PARTY-NOTICES.md', 'docs/*.md', 'docs/maintaining/*.md', 'docs/compatibility/*.md',
    'docs/api-coverage/*.md', 'src/*/README.md', 'src/*/wwwroot/notices/*.md', 'schemas/upstream/*.md',
  ],
  exclude: [],
  internal: ['.plans', 'CLAUDE.md', '.claude'],
  snippets: ['tests/Documentation'],
  repositoryUrls: ['https://github.com/Qyperion/BlazorECharts'],
  packageProjects: ['src/*/*.csproj'],
};

interface Snippet {
  name: string;
  file: string;
  line: number;
  text: string;
  used: boolean;
  duplicate?: boolean;
}

const codeLanguages = new Set(['csharp', 'cs', 'c#', 'razor', 'cshtml']);
const scriptLanguages = new Set(['javascript', 'js', 'mjs']);
const snippetStart = [/^\s*\/\/ snippet: (\S+)\s*$/, /^\s*@\* snippet: (\S+) \*@\s*$/];
const snippetEnd = [/^\s*\/\/ endsnippet\s*$/, /^\s*@\* endsnippet \*@\s*$/];
const marker = /^<!-- snippet: (\S+) -->$/;
const fence = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;

const localPaths = [
  /(?<![A-Za-z0-9])[A-Za-z]:\\(?=\S)/g,
  /(?<![A-Za-z0-9/])[A-Za-z]:\/(?!\/)/g,
  /(?<![\w.~-])\/(?:Users|home)\/[^\s/]+/g,
  /(?<![\w:])\\\\[A-Za-z0-9_.-]+\\/g,
];

const toPosix = (path: string) => path.replaceAll('\\', '/');

/**
 * The first syntax error of a JavaScript block parsed as an ES module: its zero-based line and message.
 * Program diagnostics also reject TypeScript syntax, which the parser alone accepts in JavaScript.
 */
function syntaxError(code: string): { line: number; message: string } | undefined {
  const name = '/block.mjs';
  const file = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const host: ts.CompilerHost = {
    getSourceFile: path => path === name ? file : undefined,
    fileExists: path => path === name,
    readFile: () => undefined,
    writeFile: () => {},
    getDefaultLibFileName: () => '/lib.d.ts',
    getCurrentDirectory: () => '/',
    getCanonicalFileName: path => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => ts.sys.newLine,
  };
  const program = ts.createProgram({ rootNames: [name], options: { allowJs: true, noEmit: true, noLib: true, types: [] }, host });
  const [first] = [...(file as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics, ...program.getSyntacticDiagnostics(file)];
  return first
    && { line: file.getLineAndCharacterOfPosition(first.start ?? 0).line, message: ts.flattenDiagnosticMessageText(first.messageText, ' ') };
}

/** A link to this repository's main branch or a release tag as a root-relative path and anchor; undefined for other URLs. */
function repositoryPath(target: string, repositories: readonly string[]): { path: string; anchor?: string } | undefined {
  for (const repository of repositories) {
    const prefix = repository.replace(/\/+$/, '');
    if (!target.startsWith(`${prefix}/`))
      continue;

    const match = /^(?:tree|blob)\/(?:main|v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\/([^#]*))?(?:#(.*))?$/.exec(target.slice(prefix.length + 1));
    if (match)
      return { path: posix.normalize(decodeURI(match[1] ?? '').replace(/\/+$/, '') || '.'), anchor: match[2] };
  }

  return undefined;
}

/** Project names that are not package ids, lower-cased, with the PackageId of their project. */
function projectNamedPackages(root: string, patterns: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const project of patterns.flatMap(p => globSync(p, { cwd: root })).map(toPosix).sort()) {
    const id = /<PackageId>\s*([^<\s]+)\s*<\/PackageId>/.exec(readFileSync(join(root, project), 'utf8'))?.[1];
    const name = posix.basename(project, '.csproj');
    if (id && id.toLowerCase() !== name.toLowerCase())
      result.set(name.toLowerCase(), id);
  }

  return result;
}

const packageNamePatterns = [
  /\bdotnet\s+add\s+(?:\S+\s+)?package\s+([\w.-]+)/gi,
  /<Package(?:Reference|Version)\s+(?:Include|Update)="([^"]+)"/gi,
  /nuget\.org\/packages\/([\w.-]+)/gi,
  /(?<![\w.-])`?([A-Za-z][\w.-]*\w)`?\s+packages?\b/g,
];
const packageList = /\bpackages?\s+((?:`[\w.-]+`(?:,\s*|\s+and\s+|\s+or\s+)?)+)/gi;

/** Names a line uses as package ids, in the order they appear. */
function packageNames(line: string): string[] {
  const found: { index: number; name: string }[] = [];
  for (const pattern of packageNamePatterns)
    for (const m of line.matchAll(pattern))
      found.push({ index: m.index + m[0].indexOf(m[1]), name: m[1] });

  for (const m of line.matchAll(packageList)) {
    const start = m.index + m[0].indexOf(m[1]);
    for (const name of m[1].matchAll(/`([\w.-]+)`/g))
      found.push({ index: start + name.index + 1, name: name[1] });
  }

  return found.sort((a, b) => a.index - b.index).map(f => f.name);
}

const dedent = (lines: string[]) => {
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.length - l.trimStart().length));
  return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0).trimEnd());
};

const trimBlank = (lines: string[]) => {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim())
    start++;

  while (end > start && !lines[end - 1].trim())
    end--;

  return lines.slice(start, end);
};

export function githubSlug(heading: string): string {
  const text = heading.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/<[^>]+>/g, '');
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  let inFence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const f = fence.exec(line);
    if (f) {
      if (!inFence)
        inFence = f[2][0];
      else if (f[2][0] === inFence)
        inFence = undefined;

      continue;
    }

    if (inFence)
      continue;

    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h)
      continue;

    const base = githubSlug(h[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    result.add(n ? `${base}-${n}` : base);
  }

  return result;
}

function collectSnippets(root: string, config: DocsCheckConfig, errors: string[]): Map<string, Snippet> {
  const snippets = new Map<string, Snippet>();
  const walk = (dir: string): string[] => !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory()
      ? (['bin', 'obj', 'node_modules'].includes(e.name) ? [] : walk(join(dir, e.name)))
      : /\.(cs|razor)$/.test(e.name) ? [join(dir, e.name)] : []);
  for (const file of config.snippets.flatMap(d => walk(join(root, d))).sort()) {
    const path = toPosix(relative(root, file));
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const name = snippetStart.map(r => r.exec(lines[i])?.[1]).find(Boolean);
      if (!name)
        continue;

      let end = i + 1;
      while (end < lines.length && !snippetEnd.some(r => r.test(lines[end])))
        end++;

      if (end === lines.length) {
        errors.push(`UNTERMINATED_SNIPPET ${path}:${i + 1} ${name}`);
        continue;
      }

      const text = trimBlank(dedent(lines.slice(i + 1, end))).join('\n');
      const existing = snippets.get(name);

      // Parts in one file join, so file-level usings and statements in a method form one snippet.
      if (existing?.file === path)
        existing.text += `\n\n${text}`;
      else if (existing) {
        if (!existing.duplicate)
          errors.push(`DUPLICATE_SNIPPET ${existing.file}:${existing.line} ${name} ${path}:${i + 1}`);

        existing.duplicate = existing.used = true;
      } else
        snippets.set(name, { name, file: path, line: i + 1, text, used: false });

      i = end;
    }
  }

  return snippets;
}

export function checkDocs(rootPath: string, config: DocsCheckConfig = defaultConfig, fix = false): DocsCheckResult {
  const root = resolve(rootPath);
  const errors: string[] = [];
  const snippets = collectSnippets(root, config, errors);
  const excluded = new Set(config.exclude);
  const documents = [...new Set(config.documents.flatMap(p => globSync(p, { cwd: root }).map(toPosix)))].filter(p => !excluded.has(p)).sort();
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = (path: string) => {
    if (!anchorCache.has(path))
      anchorCache.set(path, anchors(readFileSync(join(root, path), 'utf8')));

    return anchorCache.get(path)!;
  };
  const projectNames = projectNamedPackages(root, config.packageProjects ?? []);
  let links = 0;

  for (const doc of documents) {
    const original = readFileSync(join(root, doc), 'utf8');
    const lines = original.split(/\r?\n/);
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      for (const name of packageNames(lines[i])) {
        const id = projectNames.get(name.toLowerCase());
        if (id)
          errors.push(`UNPREFIXED_PACKAGE_ID ${doc}:${i + 1} ${name} (the package id is ${id})`);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of localPaths)
        for (const m of lines[i].matchAll(pattern))
          errors.push(`ABSOLUTE_LOCAL_PATH ${doc}:${i + 1} ${m[0]}`);

      const open = fence.exec(lines[i]);
      if (open) {
        let close = i + 1;
        while (close < lines.length && !(lines[close].trim().startsWith(open[2]) && lines[close].trim().replace(/[`~]/g, '') === ''))
          close++;

        const language = open[3].toLowerCase();
        const name = i > 0 ? marker.exec(lines[i - 1].trim())?.[1] : undefined;
        for (let j = i + 1; j < close; j++)
          for (const pattern of localPaths)
            for (const m of lines[j].matchAll(pattern))
              errors.push(`ABSOLUTE_LOCAL_PATH ${doc}:${j + 1} ${m[0]}`);

        if (name) {
          const snippet = snippets.get(name);
          if (!snippet)
            errors.push(`MISSING_SNIPPET ${doc}:${i + 1} ${name}`);
          else if (!snippet.duplicate) {
            snippet.used = true;
            const body = lines.slice(i + 1, close);
            const expected = snippet.text.split('\n').map(l => l ? open[1] + l : l);
            if (body.join('\n') !== expected.join('\n')) {
              if (fix) {
                lines.splice(i + 1, close - i - 1, ...expected);
                close = i + 1 + expected.length;
                changed = true;
              } else
                errors.push(`STALE_SNIPPET ${doc}:${i + 1} ${name}`);
            }
          }
        } else if (codeLanguages.has(language))
          errors.push(`UNREFERENCED_CODE_BLOCK ${doc}:${i + 1} ${language}`);
        else if (scriptLanguages.has(language)) {
          const error = syntaxError(lines.slice(i + 1, close).join('\n'));
          if (error)
            errors.push(`JAVASCRIPT_SYNTAX ${doc}:${i + 2 + error.line} ${error.message}`);
        }

        i = close;
        continue;
      }

      if (marker.test(lines[i].trim()) && !fence.test(lines[i + 1] ?? ''))
        errors.push(`SNIPPET_MARKER_WITHOUT_BLOCK ${doc}:${i + 1}`);

      const prose = lines[i].replace(/`[^`]*`/g, '');
      const targets = [
        ...prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g),
        ...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/g),
      ].map(m => m[1]);
      for (const target of targets) {
        links++;
        const repository = repositoryPath(target, config.repositoryUrls ?? []);
        if (!repository && /^[a-z][a-z0-9+.-]*:/i.test(target))
          continue;

        const [pathPart, anchor] = repository ? [repository.path, repository.anchor] : target.split('#', 2);
        const resolved = repository ? repository.path : pathPart ? posix.normalize(posix.join(posix.dirname(doc), decodeURI(pathPart))) : doc;
        if (resolved.startsWith('../')) {
          errors.push(`LINK_OUTSIDE_REPOSITORY ${doc}:${i + 1} ${target}`);
          continue;
        }

        if (config.internal.some(p => resolved === p || resolved.startsWith(`${p}/`))) {
          errors.push(`INTERNAL_LINK ${doc}:${i + 1} ${target}`);
          continue;
        }

        const absolute = join(root, resolved);
        if (!existsSync(absolute)) {
          errors.push(`BROKEN_LINK ${doc}:${i + 1} ${target}`);
          continue;
        }

        if (anchor !== undefined && (!statSync(absolute).isFile() || !resolved.endsWith('.md') || !anchorsOf(resolved).has(anchor))) {
          errors.push(`BROKEN_ANCHOR ${doc}:${i + 1} ${target}`);
        }
      }
    }

    if (changed) {
      const newline = original.includes('\r\n') ? '\r\n' : '\n';
      writeFileSync(join(root, doc), lines.join(newline));
      anchorCache.delete(doc);
    }
  }

  for (const snippet of snippets.values())
    if (!snippet.used)
      errors.push(`UNUSED_SNIPPET ${snippet.file}:${snippet.line} ${snippet.name}`);

  return { errors, documents: documents.length, links, snippets: snippets.size };
}

if (import.meta.main) {
  const option = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const root = option('root') ?? process.cwd();
  const configPath = option('config');
  const config: DocsCheckConfig = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : defaultConfig;
  const result = checkDocs(root, config, process.argv.includes('--fix'));
  console.log(JSON.stringify({ documents: result.documents, links: result.links, snippets: result.snippets, errors: result.errors.length }));
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  }
}
