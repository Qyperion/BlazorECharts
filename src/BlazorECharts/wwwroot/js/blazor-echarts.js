// src/BlazorECharts/JavaScript/errors.ts
var EChartsError = class extends Error {
  constructor(code, message, options) {
    super(`[${code}] ${message}`, options);
    this.code = code;
    this.name = "EChartsError";
  }
  code;
};

// src/BlazorECharts/JavaScript/runtime-protocol.ts
var pageRuntimeKey = /* @__PURE__ */ Symbol.for("BlazorECharts.page-runtime.v3");

// src/BlazorECharts/JavaScript/blazor-echarts.ts
var page = () => globalThis[pageRuntimeKey];
function getECharts() {
  const runtime = page();
  if (!runtime)
    throw Error("Initialize ECharts before using browser helpers.");
  return runtime.getECharts();
}
function stabilityParticipant(native) {
  const runtime = page();
  if (!runtime)
    throw new EChartsError("ChartDisposed", "Stability participants require a live bridge-owned chart.");
  return runtime.stabilityParticipant(native);
}
function tryStabilityParticipant(native) {
  return page()?.tryStabilityParticipant(native) ?? null;
}
export {
  getECharts,
  stabilityParticipant,
  tryStabilityParticipant
};
