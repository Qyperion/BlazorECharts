# Generator and generated C# contracts

The generator (`tools/BindingGenerator`, TypeScript 6.0.3 compiler API) turns the pinned
upstream declarations and the pinned echarts-doc snapshot into a schema (`schemas/upstream/echarts-6.1.0.api/`),
then projects that schema and `schemas/overrides/*.json` into C#. Library consumers never run
it. Run the commands from the repository root in Windows PowerShell: the generator calls
`tar` on Windows paths, which GNU tar from Git Bash cannot open.

| Command | Purpose |
|---|---|
| `npm run api:extract` | Re-extract the schema from the archives in `sources.lock.json`; `-- --allow-stale-overrides` only for the first run of an [upgrade](update-echarts.md#2-extract-and-diff) |
| `npm run api:diff -- --before <schema> --after <schema> --output <report>` | Semantic diff of two schemas, see [below](#semantic-api-diff-npm-run-apidiff) |
| `npm run generate` / `npm run generate:check` | Write / verify the generated C# and manifests |
| `npm run api:check` | Scope gate of the documented API |
| `npm run typecheck:generator`, `npm run test:generator` | Type-check and test the generator itself |

## Schema and manifest files

The ECharts schema (about 117 MiB) and the C# manifest (about 50 MiB) are too large for single
files on GitHub, which rejects a push with a file over 100 MiB and warns over 50 MiB. Each is a
directory: `index.json` holds every member in order, except that the large arrays (`records`,
`types` and `provenance` of the schema, `entries` of the manifest) are replaced by the list of
their shards with item counts. A shard (`records.1.json`, `records.2.json`, ...) is a consecutive
part of the sorted array, at most 32 MiB, one item per line.

- Read them only with `loadSchema()` (`tools/BindingGenerator/src/schema.ts`) and `loadManifest()`
  (`generation-model.ts`). `loadSchema(path)` also reads a single-file `.api.json`, such as a schema
  taken from older history for `api:diff`.
- `api:extract` writes the schema with `writeSchema`, and `generate` emits the manifest shards;
  both remove shards left over from a longer split. Writing fails with `FILE_TOO_LARGE` when a file
  would exceed 50 MiB, reading fails with `SHARD_MISMATCH` when a shard has another item count.
- The `release-plan` stage of the [release gate](release.md#local-release-gate) and
  `export-initial.ps1` fail on any tracked file over 50 MiB (52 428 800 bytes).

Besides its own outputs, the manifest hashes one hand-written file:
`src/BlazorECharts/Runtime/EChartInstance.Groups.cs` holds `SetGroupAsync` and `GetGroupAsync`,
which the generator maps but does not emit. Any edit of that file, including its XML
documentation, makes `generate:check` report a drift until `npm run generate` records the new
hash.

Run `npm run generate`, then `npm run generate:check`. Check mode requires every
baseline, verifies exact bytes and rejects extra files wherever the generation writes: the
Generated directories and the manifest, the `*.g.*` files of
`tests/BlazorECharts.Tests/GeneratedContracts`, the `*.generated.ts` runtime sources,
`docs/api-coverage` (except the hand-written `reconciliation.md`) and the files of
`schemas/generated`, the WordCloud ones included. A file renamed only in case is renamed on
case-insensitive file systems; where the new name sits beside the old one, the old file is
removed. Both print a warning for configuration that takes no effect:
`UNUSED_CSHARP_NAME`, `UNUSED_CSHARP_DEFAULT`, `UNUSED_CSHARP_VARIANT_DEFAULT`, `UNUSED_K9_PATH`.
It never rewrites output. Generated files use LF on every checkout. Do not edit
them manually: naming, source pins and agreed default mappings belong in
`schemas/overrides/echarts-6.1.0.json` (`csharp`). Upstream sources stay pinned.

`generate(schema: ApiSchema, overrides: MappingOverrides): GenerationResult` is a
deterministic projection of the schema and verified pinned declaration inputs. It emits partial models, value unions, fixed tuples,
signature markers and explicit serializer factories. Every setter uses the exact
upstream JSON name with `OptionObject.SetProperty`. Nullable properties preserve
explicit null separately from unset. Numbers use `double`, except event index fields that the
overrides type as `integer` (`int?`); non-finite JSON values are rejected. Models are
`sealed partial`: the serializer finds a writer by the exact runtime type. Private upstream
members (`__value`) are not generated, `never` alternatives are dropped when another remains, and
a `never` member is omitted. `mainType` is never an option: ECharts reads it from its component
classes. Transition states (`enterFrom`, `leaveTo`, keyframes) keep only what ECharts animates from
them: transform props, `style`, `shape` and `extra` (plus `percent` and `easing` of a keyframe); the
other zrender `ElementProps` members of their TypeScript type are not generated. A member whose
upstream declaration carries `@deprecated` is `[Obsolete]` with the tag's replacement hint.
`csharp.memberRenames` (`typeId`, `property`, `jsonName`, `reason`) maps a declared member to the field
ECharts actually reads, such as the upstream typo `childGroupdId` to `itemChildGroupId`.

XML documentation comes from the schema, never from content hashes: a model names the echarts-doc
path most of its members are documented under and links its section of
`https://echarts.apache.org/en/option.html` (`<seealso href>`), a documented member states its
echarts-doc default (`ECharts default: …`), a union lists its alternatives and literal values, and a
signature marker lists the callback parameters. Events and actions take the first sentence of their
echarts-doc API description and link its section of `api.html`; the text comes from
`artifacts/generator/docs/api.json` (`npm run docs:acquire`) and must hash to the schema's
`descriptionHash`, so a snapshot of another echarts-doc commit fails generation. Closed literal unions validate their accepted values. Arrays and
`OneOrMany<T>` preserve scalar, empty array and one-element array shapes. `X | X[]` of a union `X`
with a scalar alternative is the struct `XOneOrMany`: `OneOrMany<X?>` would need two user-defined
conversions from that alternative. Nullable
value elements retain nulls. Callback properties require `JsFunction<TSignature>`;
ordinary strings cannot become function descriptors through implicit conversion.

`OptionMetadata.CreateContext()` registers the core models.
`OptionMetadata.Register(context)` registers them in a context already
configured with inline/reference policies or consumer data metadata. Register each
core set once, then add consumer registrations before use. Each model has an explicit
`Read<Model>(JsonElement, EChartsSerializationContext? = null)` reader on the internal generated
`GeneratedOptionMetadata`. Registration adds it to the context, and extensions, including the
generated WordCloud models, read nested core models through `EChartsSerializationContext.Read<T>`. Readers
retain unknown JSON as `AdditionalProperties`, call setters only for present
properties and validate known union shapes and literals. An ambiguous object union
retains validated JSON inside its value wrapper rather than selecting a CLR subtype
and dropping fields. Functions are null placeholders here; rehydrating function/native
snapshot bindings belongs to the browser bridge. Readers do not execute JavaScript.

The internal `EChartsTransportJsonContext.Default.PreparedOption` is source-generated STJ
metadata for the outbound `{json, bindings}` envelope, including `JsBinding` and
the structured path converter. Generated options use their explicit writers rather
than STJ reflection. Generated value wrappers reject nesting in opaque custom CLR
DTO metadata unless the consumer supplies a converter, consistently with
`EChartsValue` and `OneOrMany<T>`.

## Roots and extensions

Production roots are in `BlazorECharts.Options`: `ChartOptions`, `ChartInitOptions`,
`SetOptionOptions` and the abstract `SeriesOption`. Generated value unions live in
`BlazorECharts.Values` next to the hand-written values (their files stay in `Values/Generated`);
signature markers are in `BlazorECharts.Values.Signatures`; the internal writers, readers and
factories are in `BlazorECharts.Serialization.Generated`.

`SetOptionOptions.NotMerge`, `.LazyUpdate` and `.Silent` initially return false but
remain unassigned until set. `ReplaceMerge` is unassigned by default. A new DTO
therefore writes `{}`. Initialization DTO fields use the exact upstream names;
runtime support and policy checks are separate from DTO generation.

Series constructors supply an immutable discriminator. All 23 standard series
have core factories. `ChartOptions.Series` accepts `OneOrMany<SeriesOption>?`. A consumer derives
from `SeriesOption`, calls `base("consumerType")`, and registers its writer plus
reader with:

<!-- snippet: Maintaining.Generator.ConsumerSeries -->
```csharp
context.RegisterSeries("consumerType",
    new OptionTypeRegistration<ConsumerSeries>(WriteConsumerProperties, ReadConsumer));
```

The writer emits typed fields through `context.WriteProperty`; the context owns
object delimiters and additional properties. `ReadConsumer` is an explicit
`Func<JsonElement, EChartsSerializationContext, ConsumerSeries>`. No assembly
scanning, dynamic generic construction or closed core polymorphism list is needed.
Duplicate discriminator/type registration fails. `context.ReadSeries(json)` requires
a registered discriminator. Unknown series never silently become raw models.
`RawSeriesOption` and `RawSeriesOption.FromJson` are explicit escape hatches and can
coexist with typed models in the same array. WordCloud registration belongs to its
separate RCL; core does not emit its model from the augmented declaration.

Only documented globals get typed members: `RegisterLocaleAsync` and `RegisterThemeAsync`
are generated in `GlobalHelpers.g.cs`, and named `*NativeAsync` helpers in `NativeGraphics.g.cs`
exist only for globals described by echarts-doc. Every other public path, such as `color.*`,
`zrUtil.*`, `registerTransform` or the `graphic.*` constructors, stays callable through
`EChartsRuntime.InvokeNativeAsync(path, arguments, construct)`; the JavaScript allowlist still
contains all of them. When a helper parameter is the same declaration span as a generated option
model in another bundle file, list it in `csharp.globalTypeTwins` (`typeId`, `canonicalTypeId`,
`reason`): the helper then uses that model and its `Read<Model>` reader. `registerLocale(localeObj)`
and `ChartInitOptions.Locale` share `ChartLocaleOption` this way. Unions with the same alternatives
are one C# type; when the alternatives are themselves bundle copies with other IDs, list the union in
`csharp.unionTwins` (`typeId`, `canonicalTypeId`, `reason`): generation checks that both have the same
alternatives by declaration.

## Type names

Generated type names are part of the public API, so they never contain content hashes.
`generate` projects the schema twice: the first projection records every place a named type
is reached (owner, C# property, role such as `Item` or `Alternative`), `chooseTypeNames`
(`tools/BindingGenerator/src/type-names.ts`) chooses the names, and the second projection emits
them. Candidates, strongest first:

1. `csharp.names` overrides, roots, series and graphic variants, then the type name lock;
2. the upstream declaration name (`AnimationOption`, `ZRColor`);
3. for a union alternative with a literal `type`, the property holding the union and the
   discriminator (`XAxisCategoryOption`, `AngleAxisValueOption`);
4. for a type reached from several places, the upstream name of a generic instantiation with its
   string-literal arguments (`ValueAxisLabelOption`) or of a declaring type alias
   (`BrushToolboxIconType`), then the shared property name (`AnimationDelay`, `BlurScope`),
   then the property qualified by the words every owner shares (`EmphasisFocus`);
5. the context it is reached from: owner, property and role (`LegendOptionTooltip`).

When several types claim one name, the strongest claim keeps it and equal claims all move to
their next candidate; a type whose last candidate it is keeps it. BCL names, the member names of
generated values, every hand-written type of the libraries, public, internal or partial
(`handWrittenTypes()`: `EChart`, `EChartInstance`, `EChartsRuntime`, `ReadValue`, …), and the
event/action models are reserved, without regard to case. A collision that no candidate resolves fails generation with `CSHARP_NAME_COLLISION`;
resolve it with a `csharp.names` entry (`typeId`, `name`, `reason`; the reason is required). The same applies to ties
that would fall back to a misleading context name, such as the `never` and callback
instantiations of `ItemStyleOption` (`StaticItemStyleOption`, `ItemStyleOption`). Names that
reach no fixed point within 32 rounds, because types are named after each other, fail with
`CSHARP_NAME_UNSTABLE` and the type IDs; they need `csharp.names` entries too.

`schemas/generated/type-names.lock.json` maps every published name to one route of its type:
`Owner.PropertyRole` (`TitleOption.TextStyle`, `ChartOptions.XAxisItem`) or, for a union
alternative, `Union|alternative` with its upstream name, discriminator or structural fingerprint:
the declaration text without bundle suffixes (`AngleAxisCategoryOptionAxisLabel|AxisLabelOption<"category"> & AxisLabelOption<"time">`,
`AnimationDelay|(idx: number) => number`); a text over 120 characters keeps a 96-character prefix
and a hash of the whole. A position is never a route, because the alternatives are ordered by
content-hash IDs that change between releases. Two alternatives of one union with the same
route fail with `TYPE_NAME_LOCK`. A type
reached through a locked route keeps the locked name, so a new declaration that ties on a name
cannot rename a published type. `generate` adds new names, refreshes the route of a name whose
type is no longer reached through it, and fails with `TYPE_NAME_LOCK` when a locked name is no
longer generated or one type reaches the routes of two locked names. Such a removal or rename is
a breaking change: edit the lock deliberately and record it in the public API baseline.

Generated union and tuple values are readable as well as writable: `Value` returns the stored
alternative (or the `EChartsValue` JSON of a value read from a `getOption` snapshot),
`TryGet(out T)` decodes one alternative also from JSON, and tuples expose `Item0`, `Item1`, ….
Model properties that no echarts-doc option path reaches stay public and carry the remark
"Not described by echarts-doc".

## Coverage and snapshots

- `schemas/generated/csharp-manifest/`: source IDs, full immediate alternatives,
  emitted CLR symbols/files, writer/reader symbols, source hash, file hashes,
  signature overloads, DTO family membership and the scope summary.
- `schemas/generated/public-api.txt`: mandatory generated public API baseline,
  including setters, value factories/conversions, marker IDs and reader factories.
  Compilation of `PublicApiCompileFixtures.cs` is independent evidence; Roslyn's
  filtered generated-code API view is insufficient. A generation that changes the compiled
  surface also changes the [public API baseline](release.md#public-api-baseline) of both
  assemblies, which is accepted separately.
- `schemas/generated/mapping-diagnostics.json`: named unsupported mapping IDs.
- `tests/BlazorECharts.Tests/GeneratedContracts/ManifestSymbols.g.json`: the claimed
  CLR symbols, event/action runtime names and signature markers that the .NET tests
  resolve by reflection.
- `docs/api-coverage/scope-categories-6.1.0.json` and
  `docs/api-coverage/scope-origin-index-6.1.0.json`: the scope gate inputs below.

`validateCoverage(schema, manifest)` validates source identity, alternatives,
symbols, serializer/reader references and complete DTO family membership
(`dto:init`, `dto:update`, `dto:payload`, `dto:highlight-payload`,
`dto:downplay-payload`). `npm run generate` fails on any of these errors.

## Scope gate (`npm run api:check`)

Completeness is measured against the documented API, not against every record of
the TypeScript declaration graph. Every schema record falls into exactly one set,
derived on each generation by `tools/BindingGenerator/src/scope-categories.ts`.

In-scope sets (S) must be mapped:

| Set | Records |
|---|---|
| S1 | Documented option paths (`public:option.*`), except K5d and K9 |
| S2 | Documented events/actions, plus runtime-registered events/actions without a documented twin |
| S3 | `echartsInstance.*` and documented `echarts.*` globals, except K6b |
| S4 | WordCloud (`schemas/upstream/wordcloud-3.0.0.api.json`), gated by its own inventory; the WordCloud declarations stay out of the ECharts schema, whose module types they would augment |
| S5 | DTO families `dto:*` |

Every other record needs a mechanical exclusion category (K). The first rule that matches
decides, in this order: K5d and K9 (documented option paths only), then S, K3, K1, K7, K2, K4,
K7m, K5a for properties, K5r, K5a for types, K6b, K6, K8. Because K4 comes before K7m, a
parameter type declared as an ECharts class, such as `ResizeOpts`, is a runtime model (K4)
rather than a method shape (K7m).

| Category | Rule |
|---|---|
| K1 | Bundle duplicate: same name, normalized owner, declaration text and type display as a canonical copy (`shared.d.ts`/ESM facades before `echarts.d.ts`/`index.d.ts` before `echarts.d.cts`) |
| K2 | Every declaring statement originates from `zrender/lib` |
| K3 | Every declaration span is in a TypeScript `lib.*.d.ts` |
| K4 | ECharts runtime model: declared by an ECharts class or in `types/src/{model,view,data,...}`, outside the option and event closures |
| K5a | Value inside a JS callback: owner reachable from options only through a function signature |
| K5d | Documented pseudo-path under a docs node whose type is Function but not Object |
| K5r | `custom.renderItem.api.*` |
| K6 | Bundler namespace shims, installers and value exports, owners reachable only from helper signatures, undocumented global natives, the SSR client entry |
| K6b | Documented globals delivered only through the native bridge (`scope.nativeOnly`) |
| K7 | Twin of an S record: schema `declarationIds`, the same generated C# member, event/action contract spans, DTO closure, series registry, runtime registrations of documented events/actions |
| K7m | Parameter/result shapes of manual-mapped methods |
| K8 | TS-only machinery: undocumented members and type names in the option closure, `mainType`, `ComposeOption`, callback aliases |
| K9 | Documented but not implemented by the pinned runtime (`scope.k9`); each group cites one or more hash-pinned runtime spans |

A canonical bundle copy without its own rule takes the category of its other copies.
K2 and K4 use the committed origin index: declarations of the pinned
`zrender/lib/**/*.d.ts` and `echarts/types/src/**/*.d.ts`, keyed by name and
normalized text, with archive and per-file hashes. Declaration spans are read from
`artifacts/upstream` and must match the schema provenance hashes.

`npm run api:check` regenerates in memory and exits 0 only when all of these hold:

- the schema is valid and overrides are current (stale overrides fail generation);
- no S record is unresolved (`UNRESOLVED_SCOPE_RECORD`), including WordCloud;
- no record is `RESIDUAL` (unmapped and caught by no rule);
- no S1 record maps to `EChartsValue`/`NeverValue`, a collection of them, or a model
  of only such members, unless its docs type is `*` or `scope.looseValues` records an
  upstream `any`/`unknown` reason (`LOOSE_DOCUMENTED_VALUE`);
- the committed categories and origin index match the derived ones
  (`SCOPE_CATEGORY_DRIFT`, `SCOPE_ORIGIN_INDEX_DRIFT`); a new upstream TS member
  therefore fails until its category is reviewed. `npm run generate` refuses to write a
  changed membership (a record added, moved to another set or removed) and lists it;
  after the review, `npm run generate -- --accept-scope` writes it. A change of the summary
  counters alone needs no acceptance;
- the committed manifest, emitted files, public API baseline and WordCloud contracts
  match the fresh projection, with no lost union alternative: the emitted C# of every union
  value has a `From` overload for each alternative and the check of each literal
  (`UNION_ALTERNATIVE_NOT_EMITTED`);
- manual mappings are pinned to the current signature and name implementation and tests. A
  delivered `instanceMethods` or `globalMethods` entry names at least one test or probe as
  `file#Name` in `tests`, and every `eventActions` `evidence` entry is a `file#TestName` of a browser
  test; the file must contain the name, so a deleted or renamed test fails generation. An event or
  action without `evidence` is `contract only` in `docs/api-coverage/events-actions-6.1.0.md`;
- every `DYNAMIC_ACTION_REGISTRATION` of the pinned runtime (a `registerAction` whose type is not
  a literal) has a `dynamicActions` decision: the actions it registers that are typed, those that
  stay untyped and the reason (`treemapRender`, `treemapMove` and `sankeyRoam` are view internals or
  undocumented). A site without a decision, a stale one or a "typed" action without its mapping
  fails generation, and `api:diff` reports it as `STALE_OVERRIDE`;
- every chart event that the pinned core triggers by a literal name (`this.trigger('updated')`,
  `ecIns.trigger('rendered', params)` in `lib/core/echarts.js`; `lifecycle.trigger` calls are
  `registerUpdateLifecycle` hooks) is typed, as an `eventActions` runtime name, or excluded in
  `runtimeTriggers` with the reason (`updated`: no payload, documented nowhere). A trigger without
  a decision, a stale or unexplained exclusion, or an excluded event that is typed fails generation
  (`RUNTIME_TRIGGER`), and `api:diff` reports it as `STALE_OVERRIDE`;
- every `csharp.variantDefaults` entry names a variant model (one string-literal `type`, or a
  `variantTypes` or graphic variant), an allowed case (`always`, `has-data`, `no-data`,
  `continuous`, `piecewise`) and a reason; an entry that no emitted variant uses is the warning
  `UNUSED_CSHARP_VARIANT_DEFAULT`.

Event and action fields with several shapes (`number|number[]`, `id|id[]`, `string|string[]`,
upstream `unknown`) are `EventActionValue`, validated per field against its documented
alternatives: one type with `TryGetNumber`, `TryGetNumbers`,
`TryGetString`, `TryGetStrings` and conversions from numbers, strings and their arrays, instead
of about 400 field-specific unions. Event index fields are `int?`. A field type names only the
alternatives of `eventActionValueTokens` (`emit-events-actions.ts`), the list that
`EventActionValue.Matches` implements; another token, or a `type:` ID that is no generated model,
union or callback, fails generation.

The report `artifacts/api-coverage/strict-report.json` holds the S/K/bonus summary
(bonus = mapped records outside S), every error, unresolved and loose records, drift
and the set and rule of each record.

Source inventory extraction remains independent of generated implementation status.
Generated model coverage does not claim browser execution, event/method
implementation or closed specialized families. Unbound generics, typed index
signatures, external/native types, optional/rest tuples and unsupported alternatives
remain named diagnostics. Objects with required callable members need an explicit
native-reference/data decision rather than becoming fake option classes. There is
no `object` fallback for an unresolved public contract. Closed component generics,
typed dictionaries and ArrayLike values use the source-backed
component projection (`tools/BindingGenerator/src/component-types.ts`). Upstream `any`/`unknown`
alone map to explicit `EChartsValue`.

## Semantic API diff (`npm run api:diff`)

`npm run api:diff -- --before <old schema> --after <new schema> --output <report.json> [--overrides <overrides.json>]`
compares two extracted schemas by contract rather than by text. A schema is a sharded directory or a
single `.api.json` file. Type IDs are content hashes,
so the diff matches records by their stable IDs (`public:<path>` for documented paths,
events, actions and methods; `export:` and `symbol:` for declarations; properties of named
declarations) and compares types by kind, literal values and declaration names. Members of
anonymous object types are reported on the stable record that owns the object.
`--overrides` defaults to `schemas/overrides/echarts-6.1.0.json`.

| Code | Resolution | SemVer impact | Meaning |
|---|---|---|---|
| `ADDED_MEMBER` | `unresolved` | minor | New record or member; unresolved until generation or an override maps it and `api:check` proves it |
| `UNION_ALTERNATIVE_ADDED` | `requires-mapping` | minor | The C# union needs the new alternative |
| `OVERLOAD_ADDED` | `requires-mapping` | minor | A new call signature of a method or callback |
| `REMOVED_MEMBER`, `UNION_ALTERNATIVE_REMOVED`, `OVERLOAD_REMOVED` | `requires-review` | major | Removal; keep, obsolete or remove the C# member deliberately |
| `SIGNATURE_CHANGED` | `requires-review` | major | Any other change of the contract of the record itself |
| `DOCS_TYPE_CHANGED` | `requires-review` | patch | The echarts-doc type vocabulary changed; reconcile documentation |
| `STALE_OVERRIDE`, `STALE_API_DECISION` | `rejected` | patch | An override, manual mapping, C# configuration entry (including content pins, `expectedTypeId` and a missing name reason) or API decision no longer matches the new schema |

A record whose own contract is unchanged but whose nested types changed is listed under
`nested`; the nested records carry the entries. `summary.semver` is the highest impact of
all entries and the lower bound of the library version change. The command exits 1 when an
input is invalid or an entry is `rejected`, and 0 otherwise: the diff is a review input, and
`npm run api:check` is the gate. Comparing a schema with itself reports no entries; on the
6.1.0 schema the run takes about two minutes.

Re-pin an override after reviewing its new contract:

```powershell
node tools/BindingGenerator/src/cli.ts signature [--schema <schema>] <recordId>...
```

It prints `[{ "recordId", "signature" }]`, from the current schema by default. Copy the value
into `expectedSignature` only after reviewing the change that made the pin stale.
