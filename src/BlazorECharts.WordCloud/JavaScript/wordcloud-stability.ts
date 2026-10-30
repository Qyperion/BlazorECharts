import type { StabilityTicket } from '../../BlazorECharts/JavaScript/stability.ts';

/**
 * Bound to the owning chart before asynchronous work starts. No runtime, timers or leases are allocated here.
 * `readiness` rejects when layout cannot start and resolves with a font failure, if any, that the layout survives.
 */
export function wordCloudStability(ticket: StabilityTicket, canvas: EventTarget,
  readiness: () => Promise<unknown>) {
  let settled = false;
  const cleanup = () => {
    canvas.removeEventListener('wordcloudstop', complete);
    canvas.removeEventListener('wordcloudabort', aborted);
  };
  const settle = (action: () => void) => { if (!settled) { settled = true; cleanup(); action(); } };
  const complete = () => settle(() => ticket.complete());
  const fail = (error: unknown) => settle(() => ticket.fail(error));
  const aborted = (event: Event) => fail((event as CustomEvent).detail?.error ?? 'WordCloud layout aborted.');
  canvas.addEventListener('wordcloudstop', complete);
  canvas.addEventListener('wordcloudabort', aborted);
  return Object.freeze({
    run(start: () => void, cleanupFailure: () => void = () => {}) {
      // Catch both preparation and asynchronous loop failures without unhandled rejection.
      void Promise.resolve().then(() => settled ? undefined : readiness()).then(fontFailure => {
        if (settled) return;
        // The layout still draws with the browser's fallback font; the failed ticket reports the missing one.
        if (fontFailure !== undefined) fail(fontFailure);
        start();
      }).catch(error => { fail(error); cleanupFailure(); });
    },
    cancel: () => settle(() => ticket.cancel()),
    // Supersession/removal retires this dependency without turning the replacement into a failure.
    retire: () => { if (!settled) { settled = true; cleanup(); } ticket.retire(); }, fail,
  });
}

const fontTimeout = 3000;

/** Use the same pinned style resolver as WordCloudView, including inherited item and rich token fonts. */
export async function wordCloudResources(series: any, createStyle: (model: unknown) => Record<string, any>,
  makeFont: (style: Record<string, any>) => string | undefined): Promise<unknown> {
  const data = series.getData();
  const text = Array.from({length:data.count()}, (_,i) => data.getName(i)).join('');
  const family = series.get('textStyle.fontFamily') || series.get('emphasis.textStyle.fontFamily') || series.ecModel.get('textStyle.fontFamily') || 'sans-serif';
  const weight = series.get('textStyle.fontWeight') || series.get('emphasis.textStyle.fontWeight') || series.ecModel.get('textStyle.fontWeight') || 'normal';
  const fonts = document.fonts;
  let fontFailure: unknown;
  if (fonts) {
    const requests = new Map<string, string[]>();
    const add = (style: Record<string, any>, content: string) => {
      const font = makeFont(style) || '12px sans-serif';
      const texts = requests.get(font) ?? []; texts.push(content); requests.set(font, texts);
    };
    // The layout helper measures all words using this series-level font, independently of item styling.
    add({fontFamily:family,fontWeight:weight,fontSize:16}, text);
    for (let i = 0; i < data.count(); i++) {
      const content = data.getName(i), style = createStyle(data.getItemModel(i).getModel('textStyle'));
      add(style, content);
      // Exact pinned ZRender parseText.js STYLE_REG: invalid token names render as literal text.
      for (const token of content.matchAll(/\{([a-zA-Z0-9_]+)\|([^}]*)\}/g))
        if (style.rich?.[token[1]]) add(style.rich[token[1]], token[2]);
    }
    const pending = new Set(requests.keys());
    const loads = Promise.allSettled([...requests].map(([font, texts]) =>
      fonts.load(font, texts.join('')).finally(() => pending.delete(font))));
    // A font that never answers is drawn with the fallback after the browser's block period, as a failed one is.
    // Fonts of the rest of the page are not awaited: exports check document.fonts.status themselves.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<undefined>(resolve => { timer = setTimeout(resolve, fontTimeout); });
    const settled = await Promise.race([loads, timedOut]).finally(() => clearTimeout(timer));
    const rejected = settled?.find(load => load.status === 'rejected');
    if (!settled) fontFailure = Error(`WordCloud fonts did not load within ${fontTimeout} ms: ${[...pending].join(', ')}.`);
    else if (rejected) fontFailure = rejected.reason ?? Error('WordCloud font failed to load.');
  }
  const mask = series.get('maskImage');
  if (mask instanceof HTMLImageElement) {
    await mask.decode();
    if (!mask.naturalWidth || !mask.naturalHeight) throw Error('WordCloud mask image has no decoded pixels.');
  }
  return fontFailure;
}
