import type { ChartInstance } from './chart-instance.ts';
import type { GroupCoordinator } from './group-coordinator.ts';
import { captureMembers } from './group-stability.ts';
import { EChartsError } from './errors.ts';
import type { EChartsRuntimeObject } from './runtime-provider.ts';
import { ImageReadiness } from './image-readiness.ts';

interface CaptureHooks {
  readonly runtime?: EChartsRuntimeObject;
  prepare(members: readonly ChartInstance[]): Promise<void>;
  validate(members: readonly ChartInstance[]): Promise<boolean>;
}

function captureNative(chart: ChartInstance, method: string, args: unknown[], runtime?: EChartsRuntimeObject): unknown {
  const fn = (chart.native as any)[method];
  if (typeof fn !== 'function')
    throw new EChartsError('ExportCapabilityMissing', `Native ${method} is unavailable.`);

  if (method !== 'getConnectedDataURL' || !runtime)
    return fn.apply(chart.native, args);

  // Pinned ECharts 6.1.0 forgets to dispose the temporary ZRender created by connected capture.
  // The public monotonic ZRender guid/getInstance seam scopes exactly the allocations in this synchronous call.
  const ec = runtime as any;
  if (!ec.zrUtil?.guid || !ec.zrender?.getInstance)
    throw new EChartsError('ExportCleanupUnavailable', 'Connected capture requires the pinned ZRender allocation/cleanup capabilities.');

  const first = ec.zrUtil.guid();
  try {
    return fn.apply(chart.native, args);
  } finally {
    const end = ec.zrUtil.guid();
    for (let id = first + 1; id < end; id++) {
      const temporary = ec.zrender.getInstance(id);
      if (temporary)
        temporary.dispose();
    }
  }
}

export function validateTimeout(timeout: number): void {
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2_147_483_647)
    throw new EChartsError('StabilityTimeoutInvalid', 'Timeout must be between zero and 2147483647 milliseconds.');
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error === undefined ? resolve() : reject(error);
    };
    const abort = () => done(signal!.reason);
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted)
      abort();
  });
}

const methods = new Set([
  'awaitStable', 'getDataURL', 'getConnectedDataURL', 'getSvgDataURL', 'renderToSVGString', 'renderToCanvas', 'getRenderedCanvas',
]);

function validateFormat(charts: readonly ChartInstance[], method: string, args: unknown[]): void {
  if (method === 'awaitStable')
    return;

  const opts = args[0] as { type?: string } | undefined;
  if (opts?.type !== undefined && !['png', 'jpeg', 'svg'].includes(opts.type))
    throw new EChartsError('ExportFormatUnsupported', 'Expected png, jpeg or svg.');

  for (const chart of charts) {
    const type = (chart.native as any).getZr().painter.getType();
    const expected = ['getSvgDataURL', 'renderToSVGString'].includes(method) || opts?.type === 'svg' ? 'svg'
      : ['renderToCanvas', 'getRenderedCanvas', 'getConnectedDataURL'].includes(method) || opts?.type ? 'canvas' : type;
    if (type !== expected)
      throw new EChartsError(
        'ExportRendererUnsupported',
        `The ${method}/${opts?.type ?? expected} format requires the ${expected} renderer; received ${type}.`
      );
  }
}

/** Overall deadline is fixed; revision and membership changes only restart the readiness check. */
export async function stableCapture(
  chart: ChartInstance,
  groups: GroupCoordinator,
  method: string,
  args: unknown[],
  timeout: number,
  signal?: AbortSignal,
  hooks?: CaptureHooks
): Promise<unknown> {
  validateTimeout(timeout);
  if (!methods.has(method))
    throw new EChartsError('ExportMethodUnsupported', `Unknown export method: ${method}`);

  const deadline = performance.now() + timeout;
  const images = new ImageReadiness();
  let previous: readonly ChartInstance[] = [];
  try {
    while (true) {
      signal?.throwIfAborted();
      if (chart.stability.disposed || previous.some(c => c.stability.disposed))
        throw new EChartsError('ChartDisposed', 'An included chart was disposed during export.');

      const snapshot = captureMembers(chart, groups, method === 'getConnectedDataURL');
      previous = snapshot.members;
      if (hooks) {
        let changed!: () => void;
        const membershipChanged = new Promise<false>(resolve => changed = () => resolve(false));
        const unsubscribe = groups.subscribe(() => {
          if (captureMembers(chart, groups, method === 'getConnectedDataURL').key !== snapshot.key)
            changed();
        });
        try {
          if (!await Promise.race([hooks.prepare(snapshot.members).then(() => true), membershipChanged]))
            continue;
        } finally {
          unsubscribe();
        }

        signal?.throwIfAborted();
      }

      const unchanged = () => {
        const final = captureMembers(chart, groups, method === 'getConnectedDataURL');
        return snapshot.key === final.key && snapshot.members.every((c, i) => c === final.members[i] && c.stability.stamp() === stamps[i]);
      };
      const stamps = snapshot.members.map(c => c.stability.stamp());
      validateFormat(snapshot.members, method === 'getConnectedDataURL' && !snapshot.connected ? 'getDataURL' : method, args);
      const options = args[0] as any;
      if (snapshot.members.every(c => c.stability.ready())
        && images.backgroundReady(options?.backgroundColor)
        && images.backgroundReady(options?.connectedBackgroundColor)) {
        if (unchanged()) {
          signal?.throwIfAborted();

          // The revision/membership validation and native capture execute in the same JS turn.
          const captureArgs = options ? [
            {
              ...options,
              ...(options.backgroundColor === undefined ? {} : { backgroundColor: images.captureBackground(options.backgroundColor) }),
              ...(options.connectedBackgroundColor === undefined
                ? {}
                : { connectedBackgroundColor: images.captureBackground(options.connectedBackgroundColor) }),
            },
          ] : method === 'getConnectedDataURL' ? [{}] : args;
          let result: unknown;
          try {
            result = method === 'awaitStable' ? null : captureNative(chart, method, captureArgs, hooks?.runtime);
          } catch (cause) {
            throw new EChartsError('ExportUpstreamFailed', `ECharts 6.1.0 ${method} failed: ${String(cause)}`, { cause });
          }

          if (method !== 'awaitStable' && (result == null || result === '' || result === 'data:,'))
            throw new EChartsError('ExportFailed', 'Native capture returned an empty result.');

          if (!hooks)
            return result;

          const accepted = await hooks.validate(snapshot.members);
          signal?.throwIfAborted();
          if (accepted && unchanged() && performance.now() <= deadline)
            return result;
        }
      }

      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new EChartsError('StabilityTimeout', 'The chart stability timeout elapsed before capture.');

      await pause(Math.min(16, remaining), signal);
    }
  } finally {
    images.clear();
  }
}
