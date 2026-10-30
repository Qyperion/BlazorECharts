/** The .NET interop protocol of runtime-loader.js: its exports, their parameters and the PageRuntime members they call.
 * A change takes the next number here and in EChartsRuntime.RuntimeProtocol (docs/maintaining/release.md). */
export const runtimeProtocol = 3;

/** The page coordinator of this protocol. A page that kept the scripts of an earlier deployment holds that one apart. */
export const pageRuntimeKey = Symbol.for('BlazorECharts.page-runtime.v3');
