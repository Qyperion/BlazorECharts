import ts from 'typescript';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash } from './resolve-types.ts';
import { filesIn } from './docs-snapshot.ts';
import type { ApiSchema } from './schema.ts';

export function scanRuntime(schema: ApiSchema, file: string, pkg: string, version: string, base = resolve(file, '..')) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const constants = new Map<string, ts.Expression>();
  const declarations = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      constants.set(node.name.text, node.initializer);

    ts.forEachChild(node, declarations);
  };
  declarations(source);
  const literal = (node: ts.Expression | undefined, seen = new Set<string>()): string | undefined => {
    if (!node)
      return;

    if (ts.isStringLiteralLike(node))
      return node.text;

    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      return literal(constants.get(node.text), seen);
    }
  };
  const registrations: { action: string; event: string; source: string }[] = [];
  const dynamicSites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'registerAction')
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'registerAction'))) {
      let action: string | undefined;
      let event: string | undefined;
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const p of arg.properties)
          if (ts.isPropertyAssignment(p)) {
            const name = p.name.getText(source).replace(/['"]/g, '');
            if (name === 'type')
              action = literal(p.initializer);

            if (name === 'event')
              event = literal(p.initializer);
          }
      } else {
        action = literal(arg);
        event = literal(node.arguments[1]);
      }

      const start = source.getLineAndCharacterOfPosition(node.getStart(source));
      const end = source.getLineAndCharacterOfPosition(node.end);
      const span = {
        package: pkg,
        version,
        file: relative(base, file).replaceAll('\\', '/'),
        sha256: hash(text),
        start: { line: start.line + 1, column: start.character + 1 },
        end: { line: end.line + 1, column: end.character + 1 },
      };
      const sourceId = `source:${hash(JSON.stringify(span)).slice(0, 24)}`;
      if (!schema.provenance.some(p => p.id === sourceId))
        schema.provenance.push({ id: sourceId, ...span });

      if (action) {
        event = (event ?? action).toLowerCase();
        registrations.push({ action, event, source: sourceId });
        for (const [kind, name] of [['action', action], ['event', event]]) {
          const path = `runtime.${kind}.${name}`;
          const id = `public:${path}`;
          let record = schema.records.find(r => r.id === id);
          if (!record) {
            record = {
              id,
              kind: 'contract',
              name: name!,
              publicPath: path,
              canonicalId: id,
              type: 'type:documentation-unknown',
              provenance: [sourceId],
              family: 'runtime-registration-candidates',
              status: 'unresolved',
              implementationReferences: [],
              testReferences: [],
              inventory: {
                category: `runtime-${kind}`,
                declarationIds: [],
                requirements: ['public-scope-decision', 'payload-source-review'],
                runtimeName: name!,
              },
            };
            schema.records.push(record);
          } else if (!record.provenance.includes(sourceId))
            record.provenance.push(sourceId);

          for (const documented of schema.records.filter(r => r.kind === kind && r.name.toLowerCase() === name!.toLowerCase())) {
            if (!documented.provenance.includes(sourceId))
              documented.provenance.push(sourceId);

            documented.inventory!.runtimeName = name!;
          }
        }
      } else {
        dynamicSites.push(sourceId);
        schema.diagnostics.push({
          code: 'DYNAMIC_ACTION_REGISTRATION',
          message: `${span.file}:${span.start.line}: ${node.getText(source).slice(0, 200)}`,
          provenance: [sourceId],
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return { registrations, dynamicSites };
}

/**
 * Chart events that a pinned source triggers by a literal name: `this.trigger('updated')`, `ecIns.trigger('rendered', params)`.
 * `lifecycle.trigger` calls are the hooks of registerUpdateLifecycle, not chart events.
 */
export function scanTriggers(text: string, file: string): { event: string; site: string }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: { event: string; site: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'trigger'
      && node.arguments[0]
      && ts.isStringLiteralLike(node.arguments[0])
      && !(ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'lifecycle'))
      found.push({ event: node.arguments[0].text, site: `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}` });

    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function inventoryPinnedRuntime(schema: ApiSchema, lockPath: string) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const root = resolve(lockPath, '../../..');
  const pkg = lock.packages.find((p: { name: string }) => p.name === 'echarts');
  const archive = join(root, `artifacts/upstream/echarts-${pkg.version}.tgz`);
  if (hash(readFileSync(archive)) !== pkg.sha256)
    throw new Error('Runtime archive integrity mismatch');

  const temp = mkdtempSync(join(root, 'artifacts/generator/runtime-'));
  const result: ReturnType<typeof scanRuntime> = { registrations: [], dynamicSites: [] };
  try {
    execFileSync('tar', ['-xf', archive, '--strip-components=1', '-C', temp]);
    for (const file of filesIn(join(temp, 'lib')).filter(f => f.endsWith('.js'))) {
      const bytes = readFileSync(file);
      if (!bytes.includes('registerAction'))
        continue;

      const path = relative(temp, file).replaceAll('\\', '/');
      if (hash(readFileSync(join(root, 'artifacts/upstream/echarts', path))) !== hash(bytes))
        throw new Error(`Runtime cached input integrity mismatch: ${path}`);

      const scan = scanRuntime(schema, file, pkg.name, pkg.version, temp);
      result.registrations.push(...scan.registrations);
      result.dynamicSites.push(...scan.dynamicSites);
      const source = schema.sources.find(s => s.name === pkg.name)!;
      if (!source.files.some(f => f.path === path))
        source.files.push({ path, sha256: hash(bytes) });
    }

    return result;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
