import type { BindingPolicy, JsBinding } from './binding-contracts.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validates descriptors and null placeholders only. No import, compilation, execution or registry acquisition occurs. */
export function validateBindings(json: unknown, bindings: unknown, policy: BindingPolicy = {}): asserts bindings is readonly JsBinding[] {
  if (!record(json) || !Array.isArray(bindings))
    throw new Error('Expected option object and bindings array.');

  const paths = new Set<string>();
  const functionTokens = new Set<string>();
  for (const descriptor of bindings) {
    if (!record(descriptor) || !Array.isArray(descriptor.path) || descriptor.path.length === 0)
      throw new Error('Binding requires a non-empty structured path.');

    const path = descriptor.path;
    const location = JSON.stringify(path);
    const fail = (reason: string): never => { throw new Error(`Binding ${location}: ${reason}`); };
    if (!nonempty(descriptor.token))
      fail('Missing token.');

    const pathKey = JSON.stringify(path);
    if (paths.has(pathKey))
      fail('Duplicate binding path.');

    paths.add(pathKey);
    let target: unknown = json;
    for (const segment of path) {
      if (typeof segment === 'number') {
        if (!Number.isSafeInteger(segment) || segment < 0 || !Array.isArray(target) || !Object.hasOwn(target, segment))
          fail('Invalid array index or missing own array element.');

        target = (target as unknown[])[segment];
      } else if (typeof segment === 'string') {
        if (!record(target) || !Object.hasOwn(target, segment))
          fail('Missing own object property.');

        target = (target as Record<string, unknown>)[segment];
      } else
        fail('Path segments must be property strings or numeric array indexes.');
    }

    if (target !== null)
      fail('Expected a null JSON placeholder.');

    let allowed: string[];
    switch (descriptor.kind) {
      case 'module':
        allowed = ['path', 'kind', 'token', 'signature', 'moduleUrl', 'exportName'];
        if (!nonempty(descriptor.moduleUrl) || !nonempty(descriptor.exportName))
          fail('Missing moduleUrl or exportName.');

        break;
      case 'inline':
        allowed = ['path', 'kind', 'token', 'signature', 'source'];
        if (!policy.allowInlineJavaScript)
          fail('AllowInlineJavaScript must be enabled; use a module export by default.');

        if (!nonempty(descriptor.source))
          fail('Missing inline source.');

        break;
      case 'object':
        allowed = ['path', 'kind', 'token', 'runtimeId', 'ownerId'];
        if (!nonempty(descriptor.runtimeId) || descriptor.runtimeId !== policy.runtimeId)
          fail('Reference runtime identity mismatch.');

        if (!nonempty(descriptor.ownerId))
          fail('Missing ownerId.');

        break;
      default:
        fail('Unknown binding kind.');
    }

    if (Object.keys(descriptor).some(key => !allowed.includes(key)))
      fail('Unexpected or conflicting descriptor fields.');

    if (descriptor.kind !== 'object') {
      if (!nonempty(descriptor.signature))
        fail('Missing function signature.');

      if (functionTokens.has(descriptor.token as string))
        fail('Duplicate function token.');

      functionTokens.add(descriptor.token as string);
    }
  }
}

/** Primitive runtimes must call this before setOption when they cannot hydrate bindings. */
export function requireHydrationSupport(bindings: readonly JsBinding[]): void {
  if (bindings.length)
    throw new Error(`Binding hydration is unavailable for ${JSON.stringify(bindings[0].path)}.`);
}
