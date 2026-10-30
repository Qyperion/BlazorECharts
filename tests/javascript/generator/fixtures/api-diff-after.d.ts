export interface EChartsOption {
  title?: TitleOption;
  legend?: { show?: boolean; left?: number; top?: number };
  formatter?: (value: number) => string;
}
export interface TitleOption { text?: string; subtext?: string; padding?: number | number[] | string }
export interface ECharts {
  resize(): void;
  getWidth(): number;
}
export function init(dom: HTMLElement): ECharts;
