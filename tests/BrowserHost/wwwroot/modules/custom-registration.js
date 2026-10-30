export const state = { renders: 0, over: 0 };
export function registeredRender(params) {
  state.renders++;
  return { type: 'rect', shape: { x: 20 + params.dataIndex * 40, y: 20, width: 30, height: 30 }, style: { fill: '#4f46e5' } };
}
export function over() { state.over++; }
