import ts from 'typescript';
import { createHash } from 'node:crypto';
import type { ApiSchema, Provenance, TypeNode, Signature, TypeParameter, Property } from './schema.ts';

export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

export interface SourceLocation {
  package: string;
  version: string;
  file: string;
}

/** The checker resolves substitutions. This layer preserves the resulting graph, not C# mappings. */
export class TypeResolver {
  checker: ts.TypeChecker;
  schema: ApiSchema;
  locate: (file: string) => SourceLocation;
  nodes = new Map<ts.Type, string>();
  byId = new Map<string, TypeNode>();
  pending: { type: ts.Type; node: TypeNode }[] = [];
  fileHashes = new Map<ts.SourceFile, string>();
  spans = new Set<string>();

  constructor(checker: ts.TypeChecker, schema: ApiSchema, locate: (file: string) => SourceLocation) {
    this.checker = checker;
    this.schema = schema;
    this.locate = locate;
  }

  intern(provenance: Provenance): string {
    const id = `source:${hash(JSON.stringify(provenance)).slice(0, 24)}`;
    if (!this.spans.has(id)) {
      this.schema.provenance.push({ id, ...provenance });
      this.spans.add(id);
    }

    return id;
  }

  provenance(declarations: readonly ts.Node[] | undefined): string[] {
    return (declarations ?? []).map(d => {
      const file = d.getSourceFile();
      const start = file.getLineAndCharacterOfPosition(d.getStart(file));
      const end = file.getLineAndCharacterOfPosition(d.getEnd());
      let sha256 = this.fileHashes.get(file);
      if (!sha256) {
        sha256 = hash(file.text);
        this.fileHashes.set(file, sha256);
      }

      return this.intern({
        ...this.locate(file.fileName),
        sha256,
        start: { line: start.line + 1, column: start.character + 1 },
        end: { line: end.line + 1, column: end.character + 1 },
      });
    });
  }

  symbolKey(symbol: ts.Symbol): string {
    const declaration = symbol.declarations?.[0];
    if (!declaration)
      return symbol.getName();

    const names: string[] = [];
    let current: ts.Node | undefined = declaration;
    while (current && !ts.isSourceFile(current)) {
      const name = (current as ts.NamedDeclaration).name;
      if (name)
        names.unshift(name.getText());

      if (current !== declaration && ts.isFunctionLike(current)) {
        const signature = this.checker.getSignatureFromDeclaration(current);
        if (signature)
          names.unshift(`overload:${hash(this.checker.signatureToString(signature, undefined, ts.TypeFormatFlags.NoTruncation)).slice(0, 12)}`);
      }

      current = current.parent;
    }

    const location = this.locate(declaration.getSourceFile().fileName);

    // Offsets/line numbers deliberately do not participate in identity.
    return `${location.package}/${location.file}#${names.join('.') || symbol.getName()}`;
  }

  display(type: ts.Type): string {
    return this.checker
      .typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias)
      .replace(/import\("([^"]+)"\)/g, (_match, file) => {
        const loc = this.locate(file);
        return `import("${loc.package}/${loc.file}")`;
      });
  }

  diagnostic(code: string, message: string, type: TypeNode): void {
    this.schema.diagnostics.push({ code, message, type: type.id, provenance: type.provenance });
  }

  typeParameters(parameters: readonly ts.TypeParameter[] | undefined): TypeParameter[] {
    return (parameters ?? []).map(t => {
      const constraint = this.checker.getBaseConstraintOfType(t);
      const defaultType = this.checker.getDefaultFromTypeParameter(t);
      return {
        name: t.symbol.name,
        type: this.resolve(t),
        ...(constraint ? { constraint: this.resolve(constraint) } : {}),
        ...(defaultType ? { default: this.resolve(defaultType) } : {}),
      };
    });
  }

  signature(signature: ts.Signature): Signature {
    return {
      parameters: signature.getParameters().map(symbol => {
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
        return {
          name: symbol.name,
          type: this.resolve(this.checker.getTypeOfSymbol(symbol)),
          optional: !!(symbol.flags & ts.SymbolFlags.Optional)
            || !!(declaration && ts.isParameter(declaration) && (declaration.questionToken || declaration.initializer)),
          rest: !!(declaration && ts.isParameter(declaration) && declaration.dotDotDotToken),
        };
      }),
      returnType: this.resolve(this.checker.getReturnTypeOfSignature(signature)),
      typeParameters: this.typeParameters(signature.typeParameters),
      ...(signature.thisParameter ? { thisType: this.resolve(this.checker.getTypeOfSymbol(signature.thisParameter)) } : {}),
      provenance: this.provenance(signature.declaration ? [signature.declaration] : []),
    };
  }

  properties(type: ts.Type): Property[] {
    return this.checker.getPropertiesOfType(type).filter(symbol => !symbol.declarations?.some(d => {
      const modifiers = ts.canHaveModifiers(d) ? ts.getModifiers(d) : undefined;
      return modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)
        || (d as ts.NamedDeclaration).name?.kind === ts.SyntaxKind.PrivateIdentifier;
    })).map(symbol => ({
      name: symbol.name,
      type: this.propertyType(symbol),
      optional: !!(symbol.flags & ts.SymbolFlags.Optional),
      // Instantiated mapped symbols carry the compiler's resolved modifier in CheckFlags.Readonly (8).
      readonly: symbol.flags & ts.SymbolFlags.Transient
        ? !!((symbol as ts.Symbol & { links?: { checkFlags?: number } }).links?.checkFlags! & 8)
        : !!symbol.declarations?.some(d => ts.canHaveModifiers(d) && ts.getModifiers(d)?.some(m => m.kind === ts.SyntaxKind.ReadonlyKeyword)),
      provenance: this.provenance(symbol.declarations),
    })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }

  propertyType(symbol: ts.Symbol): string {
    const type = this.checker.getTypeOfSymbol(symbol);
    return this.writeType(type, !!(symbol.flags & ts.SymbolFlags.Optional), this.provenance(symbol.declarations));
  }

  writeType(type: ts.Type, optional: boolean, provenance: string[]): string {
    // TS 6.0.3's exact-optional read type adds the intrinsic `missing` value.
    // This is distinct from explicitly declared undefined, including in generic substitutions.
    // Pinned compiler source: removeMissingType / missingType in typescript/lib/typescript.js.
    const missing = (t: ts.Type) => (t as ts.Type & { debugIntrinsicName?: string }).debugIntrinsicName === 'missing';
    if (optional && type.isUnion() && type.types.some(missing)) {
      const alternatives = type.types.filter(t => !missing(t)).map(t => this.resolve(t)).sort();
      if (alternatives.length === 1)
        return alternatives[0];

      const id = `type:${hash(`union|${alternatives.join('|')}`).slice(0, 24)}`;
      if (!this.byId.has(id)) {
        const node: TypeNode = { id, kind: 'union', display: this.display(type).replace(/\s*\|\s*undefined/g, ''), alternatives, provenance };
        this.byId.set(id, node);
        this.schema.types.push(node);
      }

      return id;
    }

    return this.resolve(type);
  }

  flush(): void {
    for (let i = 0; i < this.pending.length; i++)
      this.fill(this.pending[i].type, this.pending[i].node);

    this.pending = [];
  }

  identity(type: ts.Type, visited = new Set<ts.Type>()): string {
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    const base = `${symbol ? this.symbolKey(symbol) : ''}|${this.display(type)}|${type.flags}`;
    if (visited.has(type))
      return base;

    const next = new Set(visited);
    next.add(type);
    const child = (t: ts.Type) => this.identity(t, next);
    let parts: string[] = [];
    if (type.isUnionOrIntersection())
      parts = type.types.map(child).sort();
    else if (type.flags & ts.TypeFlags.IndexedAccess)
      parts = [child((type as ts.IndexedAccessType).objectType), child((type as ts.IndexedAccessType).indexType)];
    else if (type.flags & ts.TypeFlags.Index)
      parts = [child((type as ts.IndexType).type)];
    else if (type.flags & ts.TypeFlags.Substitution)
      parts = [child((type as ts.SubstitutionType).baseType), child((type as ts.SubstitutionType).constraint)];
    else if (type.flags & ts.TypeFlags.Conditional)
      parts = [child((type as ts.ConditionalType).checkType), child((type as ts.ConditionalType).extendsType)];
    else if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
      parts = this.checker.getTypeArguments(type as ts.TypeReference).map(child);
    } else if (type.aliasTypeArguments?.length)
      parts = type.aliasTypeArguments.map(child);
    else if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Instantiated) {
      // Substituted anonymous members/signatures can also contain identically named
      // parameters from different scopes; display text alone cannot identify them.
      parts = this.checker.getPropertiesOfType(type).map(s => `${s.name}:${child(this.checker.getTypeOfSymbol(s))}`);
      for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct])
        for (const signature of this.checker.getSignaturesOfType(type, kind)) {
          parts.push(JSON.stringify([
            signature.getParameters().map(s => child(this.checker.getTypeOfSymbol(s))),
            child(this.checker.getReturnTypeOfSignature(signature)),
          ]));
        }
    }

    return base + JSON.stringify(parts);
  }

  resolve(type: ts.Type): string {
    const cached = this.nodes.get(type);
    if (cached)
      return cached;

    const symbol = type.getSymbol() ?? type.aliasSymbol;
    const display = this.display(type);
    const key = this.identity(type);
    const id = `type:${hash(key).slice(0, 24)}`;
    this.nodes.set(type, id);
    if (this.byId.has(id))
      return id;

    const node: TypeNode = { id, kind: 'unsupported', display, provenance: this.provenance(symbol?.declarations) };
    this.byId.set(id, node);
    this.schema.types.push(node); // Register BEFORE walking cycles.
    this.pending.push({ type, node });
    return id;
  }

  fill(type: ts.Type, node: TypeNode): void {
    const symbol = type.getSymbol() ?? type.aliasSymbol;
    const display = node.display;
    const f = type.flags;
    if (f & ts.TypeFlags.Any) {
      node.kind = 'any';
      this.diagnostic('UPSTREAM_ANY', 'Upstream any requires an explicit downstream mapping.', node);
    } else if (f & ts.TypeFlags.Unknown) {
      node.kind = 'unknown';
      this.diagnostic('UPSTREAM_UNKNOWN', 'Upstream unknown requires an explicit downstream mapping.', node);
    } else if (f & ts.TypeFlags.StringLiteral) {
      node.kind = 'literal';
      node.value = (type as ts.StringLiteralType).value;
    } else if (f & ts.TypeFlags.NumberLiteral) {
      node.kind = 'literal';
      node.value = (type as ts.NumberLiteralType).value;
    } else if (f & ts.TypeFlags.BooleanLiteral) {
      node.kind = 'literal';
      node.value = display === 'true';
    } else if (f & ts.TypeFlags.Boolean) {
      node.kind = 'boolean';
    } else if (type.isUnion()) {
      node.kind = 'union';
      node.alternatives = type.types.map(t => this.resolve(t)).sort();
    } else if (f & ts.TypeFlags.TypeParameter) {
      node.kind = 'type-parameter';
      node.name = symbol?.name;
      const constraint = this.checker.getBaseConstraintOfType(type);
      if (constraint)
        node.constraint = this.resolve(constraint);

      const defaultType = this.checker.getDefaultFromTypeParameter(type as ts.TypeParameter);
      if (defaultType)
        node.default = this.resolve(defaultType);
    } else if (f & ts.TypeFlags.Conditional) {
      const conditional = type as ts.ConditionalType;
      if (!node.provenance.length)
        node.provenance = this.provenance([conditional.root.node]);

      if ((conditional as ts.ConditionalType & { mapper?: unknown }).mapper) {
        // The public checker API exposes the root AST, not instantiated branch types.
        // Publishing those root branches would silently undo substitutions.
        this.diagnostic('UNSUPPORTED_TYPE', `Instantiated conditional branches require compiler mapper support: ${display}`, node);
        return;
      }

      node.kind = 'conditional';
      node.checkType = this.resolve(conditional.checkType);
      node.extendsType = this.resolve(conditional.extendsType);
      node.trueType = this.resolve(this.checker.getTypeFromTypeNode(conditional.root.node.trueType));
      node.falseType = this.resolve(this.checker.getTypeFromTypeNode(conditional.root.node.falseType));
      this.diagnostic('DEFERRED_CONDITIONAL', 'Generic conditional retained symbolically until instantiated.', node);
    } else if (f & ts.TypeFlags.IndexedAccess) {
      node.kind = 'indexed-access';
      node.objectType = this.resolve((type as ts.IndexedAccessType).objectType);
      node.indexType = this.resolve((type as ts.IndexedAccessType).indexType);
    } else if (f & ts.TypeFlags.Index) {
      node.kind = 'keyof';
      node.objectType = this.resolve((type as ts.IndexType).type);
    } else if (f & ts.TypeFlags.Substitution) {
      node.kind = 'substitution';
      node.baseType = this.resolve((type as ts.SubstitutionType).baseType);
      node.constraint = this.resolve((type as ts.SubstitutionType).constraint);
    } else if (f & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
      && !this.checker.isTupleType(type) && !this.checker.isArrayType(type)
      && (type as ts.TypeReference).target !== type && this.checker.getTypeArguments(type as ts.TypeReference).length > 0) {
      // Concrete applications can also expand forever: Grow<string> -> Grow<string[]>.
      // Every application references its definition plus exact substituted arguments.
      node.kind = 'generic-reference';
      node.target = this.resolve((type as ts.TypeReference).target);
      node.typeArguments = this.checker.getTypeArguments(type as ts.TypeReference).map(t => this.resolve(t));
    } else if (this.checker.isTupleType(type)) {
      const tuple = type as ts.TupleTypeReference;
      node.kind = 'tuple';
      node.readonly = tuple.target.readonly;
      node.minLength = tuple.target.minLength;
      if (!tuple.target.hasRestElement)
        node.fixedLength = tuple.target.elementFlags.length;

      node.elements = this.checker.getTypeArguments(tuple).map((t, i) => {
        const declaration = tuple.target.labeledElementDeclarations?.[i];
        const optional = !!(tuple.target.elementFlags[i] & ts.ElementFlags.Optional);
        return {
          type: this.writeType(t, optional, declaration ? this.provenance([declaration]) : node.provenance),
          optional,
          rest: !!(tuple.target.elementFlags[i] & ts.ElementFlags.Variable),
          ...(declaration && ts.isNamedTupleMember(declaration) ? { label: declaration.name.text } : {}),
        };
      });
    } else if (this.checker.isArrayType(type)) {
      node.kind = 'array';
      node.element = this.resolve(this.checker.getTypeArguments(type as ts.TypeReference)[0]);
      node.readonly = symbol?.name === 'ReadonlyArray';
    } else if (f & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
      const declarations = symbol?.declarations;
      if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped)
        && declarations?.length
        && declarations.every(d => this.locate(d.getSourceFile().fileName).package === 'typescript')) {
        node.kind = 'external';
        node.name = symbol!.name;
        if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
          node.typeArguments = this.checker.getTypeArguments(type as ts.TypeReference).map(t => this.resolve(t));
      } else {
        node.kind = type.isIntersection() ? 'intersection' : 'object';
        if (type.isIntersection())
          node.constituents = type.types.map(t => this.resolve(t)).sort();

        node.properties = this.properties(type);
        node.signatures = this.checker.getSignaturesOfType(type, ts.SignatureKind.Call).map(s => this.signature(s));
        node.constructSignatures = this.checker.getSignaturesOfType(type, ts.SignatureKind.Construct).map(s => this.signature(s));
        node.indexes = this.checker
          .getIndexInfosOfType(type)
          .map(i => ({ key: this.resolve(i.keyType), value: this.resolve(i.type), readonly: i.isReadonly }));
        if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped && !node.properties.length && !node.indexes.length) {
          node.kind = 'unsupported';
          this.diagnostic('UNSUPPORTED_TYPE', `Open mapped type has no enumerable member contract: ${display}`, node);
          return;
        }

        if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
          node.typeArguments = this.checker.getTypeArguments(type as ts.TypeReference).map(t => this.resolve(t));
          node.typeParameters = this.typeParameters((type as ts.InterfaceType).typeParameters);
        }
      }
    } else {
      const primitives: [number, string][] = [
        [ts.TypeFlags.String, 'string'],
        [ts.TypeFlags.Number, 'number'],
        [ts.TypeFlags.Null, 'null'],
        [ts.TypeFlags.Undefined, 'undefined'],
        [ts.TypeFlags.Void, 'void'],
        [ts.TypeFlags.Never, 'never'],
        [ts.TypeFlags.BigInt, 'bigint'],
        [ts.TypeFlags.ESSymbol, 'symbol'],
        [ts.TypeFlags.NonPrimitive, 'non-primitive'],
      ];
      const primitive = primitives.find(([flag]) => f & flag);
      if (primitive)
        node.kind = primitive[1];
      else
        this.diagnostic('UNSUPPORTED_TYPE', `Unsupported ${ts.TypeFlags[f] ?? `TypeFlags(${f})`}: ${display}`, node);
    }
  }
}
