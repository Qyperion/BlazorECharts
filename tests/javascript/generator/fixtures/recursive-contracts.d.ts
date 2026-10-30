export interface Tree<T = string> { value: T; children?: Tree<T>[]; parent?: Tree<T> }
export type StringTree = Tree<string>;
export interface Left { right?: Right }
export interface Right { left?: Left }
export interface GenericModel<T> { get<K extends keyof T>(key: K): GenericModel<T[K]> }
