interface Mixin<T> { value: T; inherited?: T[] }
interface Base extends Mixin<string> { injected: { enabled: boolean } }
export type Combined = Base & Pick<{ count: number; omitted: Date }, 'count'> & Omit<{ keep: false; drop: string }, 'drop'>;
export type Conditional<T> = T extends string ? { text: T } : { number: T };
export type Resolved = { [K in keyof Conditional<'hello'>]: Conditional<'hello'>[K] };
export type Indexed = Combined['value'];
export interface Options {
  step?: false | 'start' | 'middle' | 'end';
  numeric: 0 | 1 | 2;
  optional?: string;
  explicit: string | null | undefined;
  optionalNullable?: string | null;
  optionalExplicit?: string | undefined;
  tuple: readonly [x: number, label: string, enabled?: false];
  variadic: [head: string, ...tail: number[]];
  oneOrMany: Base | Base[];
  dictionary: { readonly [key: string]: number | false };
  callback: <T extends string>(value: T, ...rest: number[]) => T;
  opaque: any;
  unknownValue: unknown;
}
export declare function convert(value: string): number;
export declare function convert(value: number, radix?: number): string;
export { Options as OptionsAlias, convert as convertAlias };
export namespace helpers { function scale(value: number): number; }
export declare class Factory { constructor(value: string); method(value: number): string; private secret; }
export type Unsupported<T extends string> = `prefix-${T}`;
export type ReadonlyMapped = Readonly<{ value: string }>;
export type WritableMapped = { -readonly [K in keyof ReadonlyMapped]: ReadonlyMapped[K] };
export interface GenericShapes<T> { array: T[]; tuple: [first: T, ...tail: T[]] }
export declare function scoped<T extends string>(value: T): T;
export declare function scoped<T extends number>(value: T): T;
