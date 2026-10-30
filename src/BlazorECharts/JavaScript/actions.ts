import type { ChartObject } from './runtime-provider.ts';
import { EChartsError } from './errors.ts';

export function dispatchAction(native: ChartObject, payload: Record<string, unknown>, settings: boolean | Record<string, unknown> | null): void {
  if (!native.dispatchAction)
    throw new EChartsError('ChartCapabilityMissing', 'The native chart lacks dispatchAction().');

  if (typeof payload.type !== 'string' || !payload.type.trim())
    throw new EChartsError('ActionInvalid', 'An action type is required.');

  native.dispatchAction(payload, settings ?? undefined);
}
