export interface EChartsOption { formatter?: string; series?: Series[]; obsolete?: boolean; axis?: { boundaryGap?: boolean } | { boundaryGap?: [number, number] } }
export interface Series { type: 'line'; data?: number[] }
export interface RegisteredSeriesOption { line: Series }
export interface ECEventDefinition { [event: string]: unknown[] }
export interface ECharts {
  getDom(): HTMLDivElement | HTMLCanvasElement;
  setOption(option: EChartsOption, notMerge?: boolean): void;
  setOption(option: EChartsOption, opts?: { lazyUpdate?: boolean }): void;
  on<K extends keyof ECEventDefinition>(name: K, handler: (...args: ECEventDefinition[K]) => void): void;
}
export function init(dom: HTMLElement): ECharts;
export type Callback = (value: number) => void;
export namespace graphic { function clipRectByRect(a: object, b: object): object | undefined; }
