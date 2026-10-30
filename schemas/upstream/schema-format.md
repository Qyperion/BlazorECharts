# Declaration IR format 1

## Documentation reconciliation additions (backward compatible)

`api:extract` now runs declaration extraction, pinned docs reconciliation,
public inventory, runtime source inventory and override validation. The original
graph IDs remain unchanged. `exportSpace` distinguishes TypeScript type aliases
from runtime values/namespaces; a callable type alias is not a global function.

Additional record kinds are `documented`, `event`, `action`, `method`, `graphic`,
`contract` and `series`. Their stable IDs are `public:<publicPath>`. Optional
`inventory` metadata records category, declaration IDs, reconciliation state,
both type vocabularies, docs defaults/examples/description hash, mapping
requirements, runtime event name and any justified exclusion. A docs-only record
points to an explicit unknown type; it never receives implemented status merely
because documentation exists. Matched records refer to the original semantic
type, retaining overloads, return types and browser/native graph edges.

`sources` includes the pinned documentation archive and exact derived-source
spans in the hash-locked normalized JSONL. Source hashes and the original
Markdown/template file set are in `docs-snapshot.lock.json`. Runtime spans point
to freshly verified `lib/**/*.js` from the exact npm archive. Runtime-only action
registrations are candidates with an explicit public-scope requirement.

Optional `apiChanges` retains pending removal/signature-change decisions across
repeated runs. Explicit decisions pin old/new signatures and rationale in the
overrides file. Unresolved IDs and candidate conflicts stay in the schema; the
documented-API coverage gate is `npm run api:check`.

Recipe, evidence interpretation and ownership: [reconciliation guide](../../docs/api-coverage/reconciliation.md).

`npm run api:extract` writes the schema directory `echarts-6.1.0.api/` from the exact archives in
`sources.lock.json`. It uses TypeScript **6.0.3** Program/TypeChecker, with
`strict` and `exactOptionalPropertyTypes`. No C# mapping is performed here.
`npm run typecheck:generator` checks the tool itself; `npm run test:generator --
extraction.test.ts type-resolution.test.ts` runs its contract tests. Filename
filters are Vitest filters within the `generator` project.

## Envelope and provenance

- `formatVersion`: schema contract version, currently 1. Future incompatible
  changes require a version bump.
- `compilerVersion`: exact semantic compiler version. The tool rejects another
  version rather than silently changing resolution semantics.
- `sources`: package name, version, archive URL, SHA-512 integrity, SHA-256,
  upstream commit and hashes of the files actually read. `integrityKind=archive`
  means SHA-256 of the locked tarball. `file-set` (compiler libraries or fixtures)
  means SHA-256 of the JSON-encoded, path-sorted `files` array. All paths are
  package-relative with `/` separators. No cache location or timestamp is stored.
- `provenance`: interned source spans with `source:` IDs, package, version,
  package-relative file, file SHA-256, and 1-based start/end line and column.
  End positions are exclusive. Every `provenance` array elsewhere contains IDs
  from this table. Alias spans identify the export declaration; `canonicalId`
  leads to the original declaration and its spans. Primitive types need no
  declaration; their property/signature occurrences retain the source span.
- `roots`: inventory of package export paths and conditions, including import,
  require, default, legacy `types`, adjacent `.d.ts` and implicit `index.d.ts`.
  Catch-all exports inventory every matching declaration. Runtime exports with
  no declarations remain `declaration-gap`; they require documentation reconciliation.

The ECharts package's `package.README.md` **TypeScript entries** section identifies
the consumer facades. `types/src/**` and the shared implementation declaration
`types/dist/shared.d.ts` are `internal-projection` inventory entries, not additional
consumer roots. Their contracts are still traversed whenever a facade exposes
them. Explicit and wildcard aliases point to the same declaration. The CJS/UMD
and standalone upstream bundles genuinely duplicate declarations; they retain
their own provenance rather than guessing structural equivalence. SSR and
extension entry declarations remain inventoried without claiming browser or
extension implementations.

## Records and identity

`records` contains `export`, `definition` and `property` records. Each has `id`,
`kind`, `name`, `publicPath`, `canonicalId`, `type`, `provenance`, `family`, `status`,
`implementationReferences` and `testReferences`. All statuses initially remain
`unresolved`; successful extraction does not mean implemented API coverage.

- `export:<package>/<declaration>::<export name>` identifies a public export.
  Nested namespaces append `.member`. Export aliases share a canonical definition.
- `symbol:<package>/<declaration>#<lexical declaration names>` identifies the
  canonical declaration. Nested overload scopes include a hash of the compiler's
  normalized signature, keeping distinct generic parameters distinct.
- `type:<24 hex characters>` is SHA-256 shortened to 96 bits over the canonical
  source identity, checker-rendered type, TypeFlags and scoped identities of
  nested arguments/union constituents/indexed types/substituted anonymous members.
  Thus unrelated `A.T[]` and `B.T[]` cannot collapse to the same printed `T[]`.
  Definition line offsets,
  compiler allocation IDs, traversal order and cache paths do not participate.
  Instantiated aliases refer to the underlying semantic type.
- `property:<type ID>/<URI-encoded member name>` identifies a resolved graph edge.
  Its `publicPath` is `graph:<type ID>.<member name>`. Public routes are followed
  from exports through these edges; recursive contracts are not expanded into
  infinitely many dotted paths. `family` is an extraction hint; the complete
  component/series partition and docs inventory belong to subsequent steps.

IDs locate contracts across repeated runs and unrelated source line shifts.
A semantic type or signature change can change its hash; consumers should pair
such changes with the surviving public export/property route. A source-span ID
is content-derived and can change whenever the source file changes.

## Type graph

`types` contains a finite graph. Type-valued fields are IDs, never nested types.

| Kind | Contract |
|---|---|
| string, number, boolean, null, undefined, void, never, bigint, symbol, non-primitive | Exact primitive category |
| literal | `value`, including `false`, numeric zero and string literals |
| union | Every checker alternative in `alternatives` |
| intersection | `constituents` plus the checker-resolved full member set |
| object | `properties`, call `signatures`, `constructSignatures`, `indexes`; inherited and mapped fields included |
| array | `element`, `readonly`; kept distinct from scalar alternatives |
| tuple | Ordered `elements` with type, label, optional/rest flags, `readonly`, `minLength`, and `fixedLength` when finite |
| type-parameter | Name, optional constraint/default |
| generic-reference | Canonical generic `target` and substituted `typeArguments` for generic applications |
| conditional | Symbolic check/extends/true/false edges when generic resolution must be deferred |
| indexed-access, keyof, substitution | Explicit object/index or base/constraint edges |
| external | Named TypeScript standard-library/native object and type arguments; no recursively expanded DOM graph |
| any, unknown | Explicit upstream uncertainty with named occurrence diagnostics |
| unsupported | Named diagnostic, checker display and source links; never an object fallback |

Applications such as `Model<T[K]>` and `Tree<string>` are references to a generic
definition and its arguments. Expanding their methods could create infinite
families such as `Model<T[K][K2]...>` or `Grow<string[][]...>`, including for
concrete arguments. Consumers must bind `typeArguments` to the target definition's
type parameters; they must not treat unbound template fields as concrete values.
Concrete inherited fields on non-generic derived types are resolved by the
checker, and arrays/tuples retain shape even when their element type is generic.
Mapped utility aliases from TypeScript's library (e.g. Pick/Omit/Readonly) are
resolved, not treated as native objects. Class value exports retain constructor
signatures whose result types describe the public instance members. Private
and protected members are omitted.

Properties separate `optional` presence from the write-value type. Explicit
`null` and `undefined` alternatives survive. A pinned compiler adapter recognizes
TS 6.0.3's `debugIntrinsicName=missing` (the synthetic exact-optional read marker)
and transient `CheckFlags.Readonly=8` (resolved mapped modifiers). Tuple optional
cells use the same synthetic-missing normalization. These details
internal details are guarded by exact compiler version and contract tests;
an upgrade must revalidate them against `typescript/lib/typescript.js`.
Signatures preserve overload order, generic constraints/defaults, parameters,
optional/rest markers, explicit `this` and return types.

`series` is derived from the public `RegisteredSeriesOption` interface, including
all its members and their actual `type` discriminator literals. No hand-maintained
series list drives extraction. The schema is extracted from ECharts alone: the
WordCloud declarations augment `RegisteredSeriesOption` and are inventoried
separately (`wordcloud-<version>.api.json`).

## Integrity, diagnostics and deterministic output

Before using any declarations the tool verifies archive SHA-256 and SHA-512,
extracts fresh verified inputs, resolves only locked packages/compiler libraries,
then compares every consumed cached file and package metadata with those inputs.
Changed archives or declarations fail extraction. Restore cache only with the
existing `npm run assets:acquire`; extraction never changes the source lock.

`validateSchema` checks node shapes, unique IDs, type/provenance/canonical/registry
references and diagnostics for unsupported types. `serializeSchemaShards` sorts the
inventory and writes one graph item per line for reviewable diffs: `index.json` holds
the envelope and lists the shards of `records`, `types` and `provenance` (consecutive,
at most 32 MiB each, under the GitHub file limit; see the
[generator guide](../../docs/maintaining/generator.md#schema-and-manifest-files)). There are no
timestamps. Repeated extraction with unchanged verified inputs must be byte
identical. `artifacts/generator/diagnostics.json` includes the provenance table
and diagnostics for inspection; it is not an implemented-API coverage report.

Compiler diagnostics from the upstream declarations are retained, including
incompatibilities exposed by strict exact-optional checking. Declaration gaps,
upstream any/unknown and deferred generic conditionals are visible evidence for
reconciliation and later mappings. They are not upgraded to successful mappings.
Documentation-only events/actions, runtime defaults and WordCloud omissions
require source/docs reconciliation before mapping.

Two semantic limits are deliberately fail-visible. Mapped types with no
enumerable property/index contract are `unsupported`, with an `UNSUPPORTED_TYPE`
diagnostic and the checker display/source span; open mapped templates never
become a successful empty object. For instantiated conditional types the root
AST contains unbound branches. A pinned `ConditionalType.mapper` presence check
detects this case and emits `unsupported` with the correctly substituted checker
display and source span, rather than publishing incorrect true/false edges.
Uninstantiated conditional roots retain their symbolic branch graph. Concrete
conditional/mapped types that the checker fully reduces are extracted normally.
These diagnostics need source-backed handling in later mappings before release.
