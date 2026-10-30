export interface EChartsOption {
  title?: TitleOption;
  legend?: { show?: boolean; left?: number };
  formatter?: string;
}
export interface TitleOption { text?: string; padding?: number | number[] }
export interface ECharts {
  resize(): void;
  resize(opts: { width?: number; height?: number }): void;
  getWidth(): number;
}
export function init(dom: HTMLElement): ECharts;
