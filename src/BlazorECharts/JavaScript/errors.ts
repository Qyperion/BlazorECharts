/** A machine-readable failure propagated through Blazor JS interop. */
export class EChartsError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(`[${code}] ${message}`, options);
    this.name = 'EChartsError';
  }
}
