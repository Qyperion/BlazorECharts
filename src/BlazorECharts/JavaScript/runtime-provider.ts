import { EChartsError } from './errors.ts';

export interface ChartObject {
  setOption(options: unknown, update: unknown): void;
  dispose(): void;
  resize?(): void;
  group?: string;
  id?: string;
  isDisposed?(): boolean;
  setTheme?(theme: string): void;
  getOption?(): unknown;

  getModel?(): {
    getSeriesByIndex(
      index: number
    ): { subType?: string; option?: { data?: unknown; datasetIndex?: unknown; datasetId?: unknown } } | null | undefined;
  };

  on?(name: string, queryOrHandler: unknown, handler?: (payload?: unknown) => void): void;
  off?(name: string, handler: (payload?: unknown) => void): void;
  dispatchAction?(payload: Record<string, unknown>, settings?: boolean | Record<string, unknown>): void;
}

export type ThemeValue = string | Record<string, unknown> | null;

export interface EChartsRuntimeObject {
  readonly version: string;
  init(element: HTMLElement, theme: ThemeValue, options: Record<string, unknown>): ChartObject;
  getInstanceByDom(element: HTMLElement): ChartObject | undefined;
}

export type ModuleImporter = (url: string) => Promise<Record<string, unknown>>;

/**
 * Retains successful imports; a caller's new attempt evicts only failed browser module URLs.
 * Only same-origin retries change the URL: an import map `integrity` entry covers the exact URL of a module from another origin.
 */
export function retryingModuleImporter(importer: ModuleImporter, baseURI: string): ModuleImporter {
  const origin = new URL(baseURI).origin;
  const imports = new Map<string, { promise: Promise<Record<string, unknown>>; failed: boolean; attempt: number }>();
  return url => {
    const previous = imports.get(url);
    if (previous && !previous.failed)
      return previous.promise;

    const attempt = previous ? previous.attempt + 1 : 0;
    const target = new URL(url);
    if (attempt && target.origin === origin)
      target.searchParams.set('__blazorecharts_retry', String(attempt));

    const entry = { promise: undefined! as Promise<Record<string, unknown>>, failed: false, attempt };
    entry.promise = Promise.resolve().then(() => importer(target.href)).catch(error => {
      entry.failed = true;
      throw error;
    });
    imports.set(url, entry);
    return entry.promise;
  };
}

export interface RuntimeConfiguration {
  readonly allowInlineJavaScript?: boolean;
  readonly version?: string;
  readonly provider?: 'local' | 'module' | 'custom';
  readonly moduleUrl?: string | null;
  readonly exportName?: string | null;
}

export interface NormalizedConfiguration {
  readonly allowInlineJavaScript: boolean;
  readonly version: string;
  readonly provider: 'local' | 'module' | 'custom';
  readonly moduleUrl: string;
  readonly exportName: string | null;
}

export function moduleUrl(url: string, baseURI: string): string {
  const resolved = new URL(url, baseURI);
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.username || resolved.password)
    throw new EChartsError('RuntimeConfigurationInvalid', 'Module URLs must use HTTP(S) without credentials.');

  return resolved.href;
}

export function normalizeConfiguration(config: RuntimeConfiguration, baseURI: string, localUrl: string): NormalizedConfiguration {
  const provider = config.provider ?? 'local';
  if (!['local', 'module', 'custom'].includes(provider) || !(config.version ?? '6.1.0').trim())
    throw new EChartsError('RuntimeConfigurationInvalid', 'A valid provider and expected version are required.');

  if (provider === 'local' && (config.moduleUrl || config.exportName))
    throw new EChartsError('RuntimeConfigurationInvalid', 'Local assets cannot override moduleUrl or exportName.');

  if (provider !== 'local' && !config.moduleUrl?.trim())
    throw new EChartsError('RuntimeConfigurationInvalid', 'The provider requires moduleUrl.');

  return Object.freeze({
    version: config.version ?? '6.1.0',
    provider,
    allowInlineJavaScript: config.allowInlineJavaScript === true,
    moduleUrl: moduleUrl(provider === 'local' ? localUrl : config.moduleUrl!, baseURI),
    exportName: provider === 'custom' ? config.exportName ?? 'load' : config.exportName ?? null,
  });
}

export function validateRuntime(value: unknown, expectedVersion: string): EChartsRuntimeObject {
  if (typeof value !== 'object' || value === null)
    throw new EChartsError('RuntimeCapabilityMissing', 'Provider did not return an ECharts runtime object.');

  const runtime = value as Record<string, unknown>;
  if (runtime.version !== expectedVersion)
    throw new EChartsError('RuntimeVersionMismatch', `Expected version ${expectedVersion}; received ${String(runtime.version)}.`);

  const capabilities = [
    'init', 'dispose', 'getInstanceByDom', 'getInstanceById', 'use', 'registerMap',
    'registerTheme', 'registerLocale', 'connect', 'disconnect',
  ];
  const missing = capabilities.filter(name => typeof runtime[name] !== 'function');
  if (typeof runtime.graphic !== 'object' || !runtime.graphic)
    missing.push('graphic');

  if (missing.length)
    throw new EChartsError('RuntimeCapabilityMissing', `Provider lacks required capabilities: ${missing.join(', ')}.`);

  return value as EChartsRuntimeObject;
}

export async function loadProvider(config: NormalizedConfiguration, importer: ModuleImporter): Promise<EChartsRuntimeObject> {
  const module = await importer(config.moduleUrl);
  let value: unknown = config.exportName ? module[config.exportName] : module;
  if (config.provider === 'custom') {
    if (typeof value !== 'function')
      throw new EChartsError('RuntimeCapabilityMissing', `Custom provider export ${config.exportName} must be a load() function.`);

    value = await value();
  }

  return validateRuntime(value, config.version);
}
