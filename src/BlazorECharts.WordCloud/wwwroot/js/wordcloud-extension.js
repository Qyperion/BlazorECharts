// src/BlazorECharts.WordCloud/JavaScript/wordcloud-extension.ts
import install from "./wordcloud-installer.js";
import { tryStabilityParticipant } from "../../BlazorECharts/js/blazor-echarts.js";

// src/BlazorECharts.WordCloud/JavaScript/wordcloud-stability.ts
function wordCloudStability(ticket, canvas, readiness) {
  let settled = false;
  const cleanup = () => {
    canvas.removeEventListener("wordcloudstop", complete);
    canvas.removeEventListener("wordcloudabort", aborted);
  };
  const settle = (action) => {
    if (!settled) {
      settled = true;
      cleanup();
      action();
    }
  };
  const complete = () => settle(() => ticket.complete());
  const fail = (error) => settle(() => ticket.fail(error));
  const aborted = (event) => fail(event.detail?.error ?? "WordCloud layout aborted.");
  canvas.addEventListener("wordcloudstop", complete);
  canvas.addEventListener("wordcloudabort", aborted);
  return Object.freeze({
    run(start, cleanupFailure = () => {
    }) {
      void Promise.resolve().then(() => settled ? void 0 : readiness()).then((fontFailure) => {
        if (settled) return;
        if (fontFailure !== void 0) fail(fontFailure);
        start();
      }).catch((error) => {
        fail(error);
        cleanupFailure();
      });
    },
    cancel: () => settle(() => ticket.cancel()),
    // Supersession/removal retires this dependency without turning the replacement into a failure.
    retire: () => {
      if (!settled) {
        settled = true;
        cleanup();
      }
      ticket.retire();
    },
    fail
  });
}
var fontTimeout = 3e3;
async function wordCloudResources(series, createStyle, makeFont) {
  const data = series.getData();
  const text = Array.from({ length: data.count() }, (_, i) => data.getName(i)).join("");
  const family = series.get("textStyle.fontFamily") || series.get("emphasis.textStyle.fontFamily") || series.ecModel.get("textStyle.fontFamily") || "sans-serif";
  const weight = series.get("textStyle.fontWeight") || series.get("emphasis.textStyle.fontWeight") || series.ecModel.get("textStyle.fontWeight") || "normal";
  const fonts = document.fonts;
  let fontFailure;
  if (fonts) {
    const requests = /* @__PURE__ */ new Map();
    const add = (style, content) => {
      const font = makeFont(style) || "12px sans-serif";
      const texts = requests.get(font) ?? [];
      texts.push(content);
      requests.set(font, texts);
    };
    add({ fontFamily: family, fontWeight: weight, fontSize: 16 }, text);
    for (let i = 0; i < data.count(); i++) {
      const content = data.getName(i), style = createStyle(data.getItemModel(i).getModel("textStyle"));
      add(style, content);
      for (const token of content.matchAll(/\{([a-zA-Z0-9_]+)\|([^}]*)\}/g))
        if (style.rich?.[token[1]]) add(style.rich[token[1]], token[2]);
    }
    const pending = new Set(requests.keys());
    const loads = Promise.allSettled([...requests].map(([font, texts]) => fonts.load(font, texts.join("")).finally(() => pending.delete(font))));
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(resolve, fontTimeout);
    });
    const settled = await Promise.race([loads, timedOut]).finally(() => clearTimeout(timer));
    const rejected = settled?.find((load) => load.status === "rejected");
    if (!settled) fontFailure = Error(`WordCloud fonts did not load within ${fontTimeout} ms: ${[...pending].join(", ")}.`);
    else if (rejected) fontFailure = rejected.reason ?? Error("WordCloud font failed to load.");
  }
  const mask = series.get("maskImage");
  if (mask instanceof HTMLImageElement) {
    await mask.decode();
    if (!mask.naturalWidth || !mask.naturalHeight) throw Error("WordCloud mask image has no decoded pixels.");
  }
  return fontFailure;
}

// src/BlazorECharts.WordCloud/JavaScript/wordcloud-extension.ts
var installed = /* @__PURE__ */ new WeakSet();
function register(runtime) {
  if (runtime?.version !== "6.1.0") throw new Error("WordCloud requires the tested ECharts 6.1.0 runtime.");
  if (installed.has(runtime)) return;
  for (const key of ["extendSeriesModel", "extendChartView", "registerLayout", "registerPreprocessor", "List"]) {
    if (typeof runtime[key] !== "function") throw new Error(`WordCloud runtime capability missing: ${key}`);
  }
  for (const key of ["helper", "graphic", "number", "util", "format"]) {
    if (!runtime[key]) throw new Error(`WordCloud runtime capability missing: ${key}`);
  }
  const plugin = install(runtime);
  plugin.setLayoutLifecycle((series, api, canvas) => {
    const participant = tryStabilityParticipant(runtime.getInstanceByDom(api.getDom()));
    if (!participant) return null;
    const ticket = participant.begin("WordCloud", "layout");
    const createStyle = runtime.helper.createTextStyle;
    const makeFont = runtime.graphic.Text.makeFont;
    return wordCloudStability(ticket, canvas, () => wordCloudResources(series, createStyle, makeFont));
  });
  installed.add(runtime);
}
export {
  register
};
