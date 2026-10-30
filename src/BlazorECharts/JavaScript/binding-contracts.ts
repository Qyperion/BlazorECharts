/** Exact JSON names and numeric indexes. Paths are data, never JavaScript expressions. */
export type JsBindingPath = readonly (string | number)[];

interface BindingBase {
  readonly path: JsBindingPath;
  readonly token: string;
}

interface FunctionBinding extends BindingBase {
  readonly signature: string;
}

export interface ModuleBinding extends FunctionBinding {
  readonly kind: 'module';
  readonly moduleUrl: string;
  readonly exportName: string;
}

export interface InlineBinding extends FunctionBinding {
  readonly kind: 'inline';
  readonly source: string;
}

export interface ReferenceHandle {
  readonly runtimeId: string;
  readonly ownerId: string;
  readonly token: string;
}

export interface ObjectBinding extends BindingBase, ReferenceHandle {
  readonly kind: 'object';
}

export type JsBinding = ModuleBinding | InlineBinding | ObjectBinding;

export interface PreparedOptionTransport {
  readonly json: Record<string, unknown>;
  readonly bindings: readonly JsBinding[];
}

export interface BindingPolicy {
  readonly allowInlineJavaScript?: boolean;
  readonly runtimeId?: string;
}
