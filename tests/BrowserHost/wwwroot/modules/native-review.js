export const state = {};
export function probe(canvas, key) {
  state[key + 'Canvas'] = canvas;
  return (...args) => { if (state.actionsOnly && args[0]?.type !== 'reviewaction') return; state[key] = canvas.width; state.completed?.(key); };
}
export function measure(canvas) { return () => { state.measure = canvas.width; return { width: canvas.width }; }; }
export function loadImage() { return (url, onload, onerror) => { const image = new Image(); image.onload = onload; image.onerror = onerror; image.src = url; return image; }; }
export function animationModel() { return { isAnimationEnabled: () => true, getShallow: name => name.includes('Duration') ? 120 : name.includes('Easing') ? 'linear' : 0 }; }
export function add(target, zr) { state.target = target; zr.add(target); return target; }
