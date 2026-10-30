export const state = { dom: null, pattern: null, rect: null };
export function makeDom() { const dom = document.createElement('div'); dom.textContent = 'borrowed DOM'; state.dom = dom; return dom; }
export function makePattern() {
  const image = document.createElement('canvas'); image.width = image.height = 8;
  const ctx = image.getContext('2d'); ctx.fillStyle = '#ffaa00'; ctx.fillRect(0, 0, 8, 8);
  return state.pattern = { image, repeat: 'repeat' };
}
export function addToZr(zr, rect) { zr.add(rect); state.rect = rect; return rect; }
