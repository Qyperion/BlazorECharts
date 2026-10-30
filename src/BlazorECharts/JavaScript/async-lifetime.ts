/** Cancels a waiter, never the shared browser module import. The late promise retains rejection observation. */
export function waitForLifetime<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal)
    return operation;

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? Error('Browser owner disposed.'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted)
      abort();
  });
}
