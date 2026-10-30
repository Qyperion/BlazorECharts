# Reproducing the public API inventory

The inventory combines the exact npm declarations, an independently pinned
documentation snapshot, and the compiled runtime source in the same verified
ECharts **6.1.0** npm archive. It lists the upstream API; it does not establish
implemented C# coverage.

Run from the repository root with the versions in `package.json`/lock:

```powershell
npm ci --ignore-scripts
npm run assets:acquire -- --offline
npm run docs:acquire -- --offline
npm run api:extract
```

On a new machine, omit `--offline` on both acquire commands. Documentation is
downloaded from the commit-addressed GitHub archive in
`schemas/upstream/docs-snapshot.lock.json`. Neither command follows the latest
website. An absent archive, changed archive, modified normalized snapshot or
build drift fails verification; it never falls back to a different version.

The docs recipe invokes the unmodified upstream `tool/md2json.js` and bundled
ETPL engine for English `option` and `api` trees, using the three exact converter
dependencies and template environment recorded in the lock. Full JSON trees,
normalized records and snapshot live in `artifacts/generator/docs/`. Every
normalized entry has an exact line span in `normalized/records.jsonl`; its hash,
the full input file/hash list, archive hash, commit and normalization recipe are
locked. These are **derived-source spans**, not invented line numbers in the
upstream Markdown. The original Markdown/templates remain independently
recoverable from the locked archive. Documentation examples are evidence for
payload work, not executable code or inferred semantic types.

No release tag is asserted for the docs snapshot
`2e15d7c7321dce0c62fda00b8d2426c171bd8b0a`. It includes all 23 registered standard
series, Matrix, Thumbnail, `setTheme`, `convertToLayout`, and axis-break APIs.
This establishes relevant v6 documentation, not exact synchronization with the
6.1.0 runtime. Every option route is independently compared with declarations.
Unmatched routes and candidate type conflicts remain visible. For example,
dynamic rich-text keys such as `<style_name>`, generic contracts and documentation
type vocabulary such as `Color` can cause mismatches without implying a newly
added upstream feature. The `group` docs allow number/string while the declaration
uses string; `axisPointer.label.borderWidth` docs say string while declarations
say number. Neither side is silently overwritten. Resolve concrete conflicts
against the exact runtime before implementing those mappings.

`api:extract` always rebuilds extraction, documentation reconciliation, public
inventory, runtime registration candidates and override validation. It does not
use the previous schema to recover documentation records. Existing declaration
IDs remain stable.

- Extraction writes `reconciliation.json`, `diagnostics.json` and
  `api-changes.json` to `artifacts/generator/`.

Added API records are unresolved. Removed records and changed signatures require
an explicit decision; pending changes are retained in `schema.apiChanges` across
another extraction. `apiDecisions` in the overrides file must match the old/new
signature hashes and include a reason. The documented-API coverage gate is
`npm run api:check` (see [the scope gate](../maintaining/generator.md#scope-gate-npm-run-apicheck)).

Overrides pin a reachable semantic signature, source package/version/path/hash,
upstream link, rationale and regression fixture. Source-only line shifts do not
invalidate a semantic mapping, but signature/union/overload drift does. Validate
them independently with:

```powershell
node tools/BindingGenerator/src/cli.ts validate-overrides
```

An optional third argument selects a candidate override file for validation.
Exclusions require both an allowed R8/R9/R10/internal boundary and a matching
public path; a standard series or ECharts graphic helper cannot be excluded by
merely writing “R10”. No scope exclusion is currently applied.

Runtime registration scanning records static action/event names and source
spans, and reports dynamic sites separately. Runtime-only candidates need a
public-scope decision: registration alone does not prove public API. Event names
are lowercased by `registerAction`; the source-backed `brushEnd` override retains
the documented route and records the subscription name `brushend` separately.
Event/action examples and unknown[] fallbacks do not constitute typed DTOs.

Consumers use the graph, not just the inventory counts:

- serialization preserves unset/null/false/0/empty arrays and raw values; docs
  defaults do not imply universal reset behavior;
- generation honors generic bindings, all alternatives and overloads, source spans
  and per-record status; a requirement is not implementation evidence;
- events/actions use exact payloads, batch fields and native event refs;
- instance/global/namespace methods, graphic and renderItem use synchronous
  callbacks and native/browser reference ownership.

ZRender as a separate full facade, a server rendering service and bundled
wrappers for other extensions retain the agreed R8/R9/R10 boundaries. Public
ECharts graphic helpers remain in the inventory.
