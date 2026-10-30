type Environment = Record<string, string | undefined>;

// A range of consecutive ports from an environment variable; Windows may reserve the defaults (netsh interface ipv4 show excludedportrange protocol=tcp).
function firstPort(environment: Environment, name: string, fallback: number, count: number): number {
  const raw = environment[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value + count - 1 > 65535)
    throw new Error(`${name} must be the first of ${count} consecutive TCP ports, from 1 to ${65536 - count}.`);
  return value;
}

/** The eight published consumer applications of test-packages.ps1: BLAZOR_ECHARTS_CONSUMER_PORT and the next seven ports. */
export function consumerPorts(environment: Environment = process.env) {
  const first = firstPort(environment, 'BLAZOR_ECHARTS_CONSUMER_PORT', 5201, 8);
  return { server: first, serverSubpath: first + 1, cdn: first + 2, custom: first + 3, wasm: first + 4, wasmSubpath: first + 5, coreOnly: first + 6, library: first + 7 };
}

/** The trimmed and AOT static hosts of test-aot.ps1: BLAZOR_ECHARTS_AOT_PORT and the next port. */
export function aotPorts(environment: Environment = process.env) {
  const first = firstPort(environment, 'BLAZOR_ECHARTS_AOT_PORT', 5211, 2);
  return { trimmed: first, aot: first + 1 };
}
