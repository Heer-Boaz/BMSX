# Incremental Lua parsing and binding

Date: 2026-09-19. Current branch: `master` (existing work fast-forwarded from
`fix/lua-bounded-call-contexts` at user request; no new branches).

## Scope and decision

Follow-up to [the definition-based language service](lua_language_service_design.md).
Annotations, additional inference, and changes to the whole-program solver are
out of scope. Optimize edits, not the meaning of interactive queries.

Implement in the ordered slices below. **Slices 0 and 1a, the lexical/edit-transport part of 2, and the publication subtask of 3 are implemented.**
The production parser and binder still process the entire changed file. This
document is not a claim that incremental parsing or binding already exists.

The target is immutable, position-independent syntax plus scope-owned binding
facts. Document positions belong to a syntax snapshot, not to the identity of a
reusable declaration. Reusing the existing absolute-position AST by shifting it
in place is expressly excluded: retained semantic snapshots must remain valid.

## References inspected

- [TypeScript 5.9.3 parser](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/parser.ts):
  `IncrementalParser.updateSourceFile`, `currentNode`, and `canReuseNode`.
  Reuse checks syntax context, errors, and the affected lookahead region.
  Its in-place position updates invalidate the old tree: do not copy that part.
- [TypeScript document registry](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/services/documentRegistry.ts):
  acquire/update source files by document version and release them with their
  owners. Adopt document lifetime, not an arbitrary process-wide cache capacity.
- [TypeScript binder](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/binder.ts):
  `bindSourceFile` skips an already bound file using `file.locals`. This is not
  evidence of arbitrary function-level incremental binding in a changed file.
- [Roslyn Blender](https://github.com/dotnet/roslyn/blob/main/src/Compilers/CSharp/Portable/Parser/Blender.cs)
  and [GreenNode](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/Syntax/GreenNode.cs):
  separate reusable syntax widths from positions in a document; reuse follows
  the changed span and lexer/parser context. Adopt that ownership distinction,
  not Roslyn's entire object hierarchy.
- [LuaLS files](https://github.com/LuaLS/lua-language-server/blob/master/script/files.lua):
  `setText` invalidates the file state; `compileState` calls `parser.compile`
  for the file. It is a reference for lazy file ownership, not a sub-file
  incremental parser to copy.

## Live owners and constraints

| Owner | Current contract | Consequence |
| --- | --- | --- |
| `ide/editor/model/text_model.ts`, `text/text_change.ts` | Versioned model events; UTF-16 replacements in application order | Preserve changes rather than rediffing full strings on each request |
| `ide/editor/contrib/intellisense/semantic/workspace/project.ts` | Composes model-owned deltas against the last analyzed model/version | Project must retain the delta between its analyzed revision and current model revision |
| `syntax/ast/index.ts:LuaChunk` | Root retains its source, lexical tokens and syntax error; global parse cache removed | Syntax lifetime follows retained file records and compiler inputs |
| `syntax/lexer.ts`, `syntax/parser.ts`, `analysis/parse.ts` | Cold scan or edit-driven lexical block splices; strict/recovering grammar parser consumes a cursor | One grammar for initial and incremental parsing; no second IDE grammar |
| `syntax/ast/index.ts` | Committed relative spans; locations belong to the generation | Reuse and final edit/cold-performance gates remain open |
| `semantic/model.ts` | Single ordered binder; scope indexes, mutable build state; immutable published file facts | Cached function bodies cannot replay old ambient binder state |
| `semantic/model.ts:createSymbolId` | IDs contain source line and column | Separate reusable declaration identity from presentation coordinates |
| `semantic/value_graph.ts` | Owned values have allocated IDs and syntax references | Preserve occurrence identity, not independently allocated IDs in differential tests |
| `semantic/definition_types.ts` | Per-file facts in WeakMap; cross-file results per snapshot | Reuse the right facts without retaining stale snapshot-dependent answers |

Hot edit path: model event -> project `synchronizeDocuments` ->
`buildLuaFileSemanticData` -> parse -> `SemanticBuilder.build` ->
`workspace.updateFiles` -> new snapshot/resolver -> first interactive query.
Also cover `updateDocument`, `updateDocuments`, and direct
`LuaSemanticWorkspace.updateFile`; diagnostics and other parse consumers must
not cause a second parse of that same document generation.

This work is TS tooling, not a mirrored hardware/runtime change. No C++ datapath
is involved. The shared TS parser also feeds compilation, so later syntax
representation changes require compiler/codegen validation, not just IDE tests.

## Ordered implementation slices

### 0. Independent baseline and correctness oracle — implemented

- Check in the runtime workspace dump and phase-separated edit profiler.
- Separately measure lexer, parser, binder, publication, member query and
  completion-after-query. Also time the real `workspace.updateFile` entrypoint.
- Let an explicitly supplied `ParsedLuaChunk` reach the binder directly. A
  same-path/source cache hit must not substitute another syntax generation.
  This also removes a redundant cache lookup for callers that already parsed.
  Cache consumers that supply a parse likewise publish that supplied generation.
- Compare edited workspace answers with an independent fresh parse/bind;
  preserve old snapshots and unchanged files through edits and undo/repair.
- Do not present cache hits, warmed completion or isolated resolver timing as
  complete keystroke-to-screen latency.

### 1a. Establish syntax-generation ownership — implemented

- `LuaChunk` retains its source, token sequence and syntax error. Strict and
  recovering parses publish this information directly; no copied token array
  or post-parse tree conversion. Recovery selects the earliest lexer/parser
  error before publishing the generation.
- Remove `analysis/cache.ts`, the process-wide 24-entry path cache. The existing
  document/project retains file analysis and its syntax. Independent one-shot
  parses are independent generations, even for equal paths and source strings.
- Diagnostics, source-edit operations and context-menu token lookup consume the
  retained generation rather than requesting a separate cached parse.
- Semantic builds with an explicit compiler AST use its lexical sequence;
  they never lex or parse that source again. O0/O3 use the same retained nodes.

This was the lifetime prerequisite, **not** relative syntax or incremental
parse/bind. At that slice boundary child-node locations were still absolute; the
later relative migration is recorded below. The changed file is still parsed and
bound in full; editor events still queue paths rather than deltas.
Retaining the complete token sequence increases live snapshot heap; see the
measured tradeoff below. The representation/performance acceptance gate for
slice 1b has not been met by this ownership change alone.

### 1b. Relative syntax and document edit transport — in progress

- Define immutable syntax payloads with relative widths/spans in `syntax/`.
  Payloads must cover full source extents, including trivia and skipped/error
  text; formatted absolute diagnostics remain snapshot presentation.
  Snapshot-owned occurrence locations provide absolute source positions.
  Distinct occurrences remain distinct even when their payloads are identical.
- Make the existing lexer/parser produce that representation directly. No
  full-tree conversion after each parse; no parallel executable AST or proxy
  that silently rewrites ranges on access.
- Keep source-position conversion in the syntax/source owner. Existing range
  consumers get snapshot-specific locations without mutating shared payloads.
- Build on the document-owned syntax from 1a. Carry model revision and ordered
  edits to analysis; coalesce against the last *analyzed* revision, including
  undo/redo and multi-edit.
- Full source replacement is an explicit input mode for runtime reload and
  non-editor callers, not a fabricated edit history.

Acceptance: independent cold parse parity, retained snapshot locations, strict
and recovering grammar parity, compiler output/debug-location parity, and no
material full-parse time/allocation regression. This slice changes ownership;
it is not just extraction of the existing parser or a cache around it.

### 2. Incremental lexing and syntax reuse

- Relex from an affected lexical boundary. Retain enough trivia/lexical state
  to account for long-bracket strings/comments, escapes, CRLF, and edits that
  join or split tokens. Synchronize only when the unchanged suffix and lexical
  context agree, not after an arbitrary number of matching tokens.
- Teach the existing parser to consume reusable statement/block nodes when
  the grammar context and lookahead dependency agree. Reparse affected parents;
  allow unaffected descendants where the grammar proves reuse.
- Represent recovery/skipped syntax and its dependencies explicitly. Incomplete
  user text is normal input: it must yield the same recovery as a fresh parse.
- A changed long-comment opener may genuinely invalidate the rest of a file.
  That is grammar-driven work, not a timeout, stale-result rescue or query cap.

Acceptance: deterministic edit-sequence differential tests, including malformed
input and subsequent repairs; observable reused nodes/token work; no traversal
and reallocation of an entire shifted suffix just to update coordinates.
Test large generated files to prove work scales with the affected region for
local edits, and report genuine whole-file invalidations separately.

### 3. Incremental binding by scope and dependencies

- Build immutable scope-local facts using local declaration slots and explicit
  captured-name/receiver inputs. Compose them into a semantic snapshot.
  Do not cache `SemanticBuilder`'s mutable maps or its position-based results.
- Separate occurrence/declaration identity from location and flattened scope
  indexes. Reused syntax occurrences keep their identity within the document;
  an independent cold build need only produce equivalent public answers.
- Track lexical bindings actually read, including failed lookups. Introducing
  a local before a closure must invalidate the closure's former global lookup.
- Track implicit `self` ownership, outer writes, module aliases/exports and
  the signature dependencies consulted by minimum-argument inference. Equal
  function text alone is not a proof of equal binding.
- Rebind the affected scope and dependents. Recompose changed contributions
  rather than replaying file-wide binder state. Parameter/effect inference
  remains intentionally unknown in interactive features.
- Adapt definition facts to these immutable units; cross-file query answers
  remain snapshot-owned until a separate dependency proof permits more reuse.
- Publication subtask implemented independently: `LuaProjectIndex` retains a
  persistent declaration-lookup root, and binding produces per-file global
  contributions. Publishing neither copies the symbol table nor scans unchanged
  declaration arrays. Scope-level contributions still await scope binding.
  Navigation, snapshot global enumeration and written-source storage retain
  their separate precedence/order contracts; there are no overlay chains.

Acceptance: lexical shadowing, closure capture, local activation order,
recursive const closures, method/self changes, nested functions, globals,
require/export changes, prototype summaries, signatures, completion and
references agree with cold analysis. Old snapshot answers remain unchanged.
Add measured rebound-scope/fact counts, not just wall-clock claims.

### 4. Editor integration and performance gate

- All interactive parse/bind consumers share the document generation. Remove
  obsolete ownership paths, rather than keeping incremental and legacy caches
  as competing authorities. Compiler one-shot parsing remains a legitimate mode.
- Replay real edits through `EditorTextModel` and the headless IDE in both carts,
  including multiple edits before a request, inactive retained documents,
  undo/redo, recovery, and source reload.
- Measure keystroke-to-analysis/query and actual frame behavior separately.
  Include retained/released snapshots and sustained editing heap behavior.
- Run the Lua suite, three precision idetests, full/incremental differential
  corpus, compiler checks, and `git diff --check` for each coherent slice.

Performance target (not yet achieved): at least a 2x reduction in median and
p95 public update time for local body edits in the large pietious player file,
without material regressions in first-query latency or cold compilation.
Use identical source dumps, edit traces and runtime for comparisons. Prefer
work-count assertions to timing assertions in CI; do not encode machine-specific
millisecond thresholds as flaky unit tests.

## Repeatable measurement

```sh
npm run build:product:node-headless-tooling -- --debug
BMSX_LUA_WORKSPACE_DUMP=/tmp/pietious-workspace.json \
  node dist/host_headless_tooling.debug.js --system-rom dist/bmsx-bios.debug.rom \
  --ide-test scripts/analysis/dump_lua_workspace.idetest.js pietious
npx tsx --tsconfig tsconfig.base.json scripts/analysis/profile_lua_edits.ts \
  /tmp/pietious-workspace.json director.lua player/player.lua > /tmp/pietious-edits.json
```

Repeat for `nemesis_s`. Run timing **without concurrent builds or test suites**.
The dump uses active-cart source paths followed by system sources, with the
same cart-first path precedence as the editor project. Never combine two carts
under the same logical source paths.

The profiler alternates an edit and undo, with 20 warmups and 50 measured
updates per scenario. Workloads: leading newline, leading comment, insertion of
`do end;` inside a function, and renaming the first binding. These deliberately
include shifted source positions and changed lexical environments. It reports
Node/CPU, source count, exact member-query location, p50/p95/max in milliseconds.
The member query is the first member reference in the file, not automatically
the historical `world:set_space` regression. Full phase measurements and public
updates are separate passes; completion follows and may reuse the member query.
This harness does not yet measure allocations, solver agreement or UI latency.

The initial differential suite has 12 edit/repair cases plus two explicit-parse
ownership tests. It is a foundation, **not** the completed adversarial/randomized
grammar corpus required by slice 2 or the binding dependency suite in slice 3.

## Baseline and slice-0 validation

Measured without concurrent builds/tests on Node 22.23.1, Intel Core Ultra 7
265KF; dumps contain 285 pietious and 264 nemesis_s files. These are one run's
50 edit/undo samples, not a performance improvement claim. The body insertion
workload gives the following **median milliseconds**:

| Cart/file | Lex | Parse | Bind | Publish | Public update p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| pietious/director | 0.35 | 0.87 | 1.66 | 3.85 | 7.47 / 8.61 |
| pietious/player | 1.47 | 3.16 | 8.96 | 4.73 | 20.07 / 22.40 |
| nemesis_s/director | 0.19 | 0.55 | 0.93 | 3.08 | 4.41 / 10.27 |
| nemesis_s/player | 0.65 | 1.56 | 4.72 | 3.68 | 10.69 / 14.90 |

Public update is measured separately; adding phase medians is not its median.
Publishing a snapshot is a significant cost alongside binding, especially in
the smaller files. Parser-only improvements cannot remove either cost.

Validation: the new equivalence/ownership tests, headless tooling build,
workspace dumps for both carts, and the three precision idetests against
nemesis_s pass. The full Lua suite retains the known `named workbench menu`
failure. Toolchain typechecking reports the already-existing unused `depth`
parameter in `semantic/definition_types.ts:312`; the same declaration is present
at baseline `6def7b018`. No additional errors were reported when typechecking
the new profiler and tests. `git diff --check` passes.

## Slice-1a validation and measurements

Work-count tests exercise the actual editor diagnostic pipeline with 40 files:
40 parses on initial analysis, zero on each subsequent unchanged pass, one for
an incomplete edit, zero for a repeated diagnostic read of that edit, and one
for its repair. Project tests cover equal paths in different resource domains,
retained old snapshots, and two model edits coalesced into one parse. Compiler
tests reject any lexer/parser invocation when binding or compiling a supplied
syntax tree. Recovery tests cover syntax and lexical errors and their ordering.

Validation on 2026-09-19:
- Full Lua suite: 1,952 passed, one skipped, the same existing `named workbench
  menu` failure (1,954 total). Table-transfer assertions compare grammar shape
  separately from root-owned source/tokens; exact source and undo checks remain.
- Headless tooling build, forced BIOS build and forced nemesis_s cart build pass.
  The three precision idetests pass against the rebuilt ROMs.
- Six compiler oracle cases (three fixtures at O0/O3) have identical serialized
  code, constants and debug metadata before/after. This is fixture parity, not
  a claim that every cart binary was compared.
- IDE and new ownership-test/heap-profiler typechecks report only the
  pre-existing unused `depth` parameter in `semantic/definition_types.ts:312`.
  Including the broader IDE test harness also reports errors at unchanged
  `tests/helpers/runtime_sources.ts:181,192` and `intellisense.test.ts:235`.
- `git diff --check` passes.

Sequential, isolated runs against archived baseline `bacc7eb64`, with the same
285-file pietious dump, Node 22.23.1 and CPU as above. Body-statement edit/undo,
20 warmups and 50 samples per run:

| File | Baseline public update p50 / p95 (ms) | Ownership slice p50 / p95 (ms) |
| --- | ---: | ---: |
| director.lua | 9.17 / 11.60 | 9.05 / 12.22 |
| player/player.lua | 21.11 / 32.83 | 21.00 / 25.96 |

Medians are essentially unchanged; p95 variation is not evidence of an
incremental speedup. This slice eliminates duplicate parses on read/compiler
paths, not changed-file parsing or binding. The 2x edit target remains open.

The retained/released heap probe can be repeated with:

```sh
node node_modules/tsx/dist/cli.mjs --expose-gc --tsconfig tsconfig.base.json \
  scripts/analysis/profile_lua_syntax_lifetime.ts /tmp/pietious-workspace.json
```

| Heap delta after GC | Baseline | Ownership slice |
| --- | ---: | ---: |
| While retaining the workspace snapshot | 143.84 MiB | 168.02 MiB |
| After releasing the snapshot/workspace | 11.80 MiB | 2.15 MiB |

Source strings are loaded before the initial measurement. Construction runs in
its own stack frame; event-loop turns precede GC to release temporary roots.
These are V8 heap deltas, not allocation counts, browser heap or process RSS.
Keeping tokens for all 285 files costs about 24 MiB while the workspace is
alive; removal of the global cache improves release. The remaining released
heap includes initialization/JIT effects, not necessarily retained documents.
Compact reusable syntax/token representation remains work for 1b/2; this result
must not be described as meeting the final allocation/performance gate.


## Independent review checkpoints

2026-09-19 (fresh agent, no conversation history): reviewed `3075a9b50` against
live owners. The review reproduced same-text explicit-generation replacement
being suppressed in workspace updates. This existing contract gap is now fixed:
text-only updates may retain a generation, but explicit parses/facts are
published by identity. Regression tests preserve old snapshots and verify
republication of the same facts is a no-op.

The review also requires full-width trivia/recovery in the representation step,
not as a later parser patch. Relative statement/scope units with explicit
snapshot location lookup are preferred over AST range proxies. Source string
materialization and flat suffix copying remain separately measured work;
no regional-work claim may hide them. Context-token reads currently use a
writing project entrypoint; batching and syntax/binding ownership still need
attention as the document delta path is integrated.


## Publication subtask of slice 3

This independent, already-measured bottleneck can be removed before changing
syntax or binder identity. It is **not incremental binding**. Two fresh-context
reviews covered the design and implementation. They required separate contracts
for navigation precedence, global list multiplicity and written-source insertion
order, and a shared collection owner rather than a semantic-feature-local map.

`toolchain/ts/collections/hash_map.ts` implements a get-only immutable lookup
and a batch builder with owner-scoped mutation, following the structural-sharing
and publication ownership in [Immutable.js Map](https://github.com/immutable-js/immutable-js/blob/main/src/Map.js).
It uses the existing shared string hash, handles full hash collisions, and
retains trie roots directly rather than chaining snapshots. No SymbolID decoder
or second per-file declaration index was introduced. A published root cannot be
mutated by later builder operations.

Binder-produced globals have two explicit forms: all declarations in binder
order (snapshot enumeration), and root-global storage declarations deduplicated
by ID (last value, first key position). The index retains storage contributions
in publication order. Editing a file moves its storage contributions to the end,
as the old symbol Map did, but does not change its navigation file precedence.
Global enumeration is materialized only on request, from immutable snapshot
files; no full declaration flattening is deferred to the first query.

Validation includes old lookup roots, unread old lazy globals after edits,
remove/readd precedence, same-file ID tie breaks, duplicate declaration IDs,
two same-file replacements in one batch, and zero reads of unchanged declaration
arrays when publishing/enumerating globals in 1- and 100-file workspaces.
The independent reviewer additionally ran 200,000 mixed map operations with
200 retained snapshots against native Map. Its test-coverage observation was
fixed: generated keys and delete decisions now use different random bits.


Publication measurement (isolated sequential runs, archived `3b273cdca`, same
285-file pietious dump/Node/CPU as above, 20 warmups/50 edit samples):

| Body-edit workload | Baseline | Persistent publication |
| --- | ---: | ---: |
| director public update p50 / p95 | 8.37 / 9.47 ms | 3.13 / 6.95 ms |
| player public update p50 / p95 | 19.70 / 23.95 ms | 14.90 / 16.71 ms |
| director publication p50 | 4.10 ms | 0.54 ms |
| player publication p50 | 4.32 ms | 1.22 ms |
| player first member p50 / p95 | 1.56 / 5.02 ms | 1.27 / 4.69 ms |
| player completion after member p50 / p95 | 7.03 / 10.86 ms | 7.90 / 12.01 ms |
| Retained snapshot heap delta after GC | 168.01 MiB | 166.50 MiB |

The player 2x target is **not met**. Completion p50/p95 are about 12%/11%
higher in this run; this is not proven to be merely noise and is not hidden
by the faster publication result. First query costs include no
full-declaration flattening; retained heap uses the earlier probe's boundary.

There is a lookup/build tradeoff. `profile_lua_publication.ts` measures a fresh
workspace index over already bound files (10 warmups, 30 samples, warmed JS):
initial publication p50 rises from 5.15 to 8.56 ms. One sweep of all 26,219
declaration lookups rises from 0.50 to 9.03 ms because the trie hashes each
string key rather than relying on native Map's cached hashes. This artificial
whole-index sweep is not interactive latency, but it must be recorded. Initial
parse+bind in these two processes was about 420–428 ms; this is a single startup
sample, not a compiler performance distribution. No unbounded hash cache or
encoded-ID workaround has been added. A separate compiler probe with 1,000
static functions, retained strict syntax, 3 warmups and 10 compiles gives O0
p50 48.45 -> 51.85 ms and O3 p50 197.37 -> 198.78 ms. It excludes parsing and
cart linking. The added initial-index cost is visible, not claimed away.
The independent review accepted this isolated publication tradeoff, but did
not accept the final no-material-regression gate: real cartcompiler
distributions and the completed representation remain required.

Validation: full Lua suite (before the final three publication cases) 1,960
passed, one skipped, only the existing menu failure; all nine collection/
publication cases pass. Headless build and the three nemesis_s precision tests
pass. Six O0/O3 compiler-oracle outputs remain byte-for-byte equal. Targeted
and IDE typechecks still report only the existing unused `depth` parameter
(now line 313). `git diff --check` passes.

### Next representation gate (independent review)

A fresh fourth review made the missing origin-lookup algorithm explicit. The
candidate is a persistent, balanced source-order layout with unit markers,
disjoint text/gap leaves, width/newline aggregates and an inverse ID-to-record
index. Snapshot-specific parent IDs allow a marker to find its origin by
walking to the root and summing left weights. A splice changes tree spines and
the parent records of moved subtree roots, not every shifted unit. This is a
location index, not a second grammar tree. Random lookup has real logarithmic
costs; sequential binder/compiler walks need cursors with retained unit origins.

Before adopting it, prove old/new positions for the same retained occurrence,
distinct identical occurrences, changed parents retaining nested units,
logarithmic changed-record counts, no historical tombstones/overlay chains,
and linear bulk construction. Statement lists and token sequences also need
chunked/persistent composition; leaving flat suffix copies would not satisfy
the regional-work gate. This is reviewed design, **not implemented syntax**.

### Slice 1b foundation: persistent source locations (2026-09-19)

`syntax/source_layout.ts` is a source-order location index, **not an additional
syntax tree**. Text leaves include all trivia and skipped/error suffixes; unique
zero-width occurrence markers locate future reusable statement/function units.
An immutable AVL text/marker tree has snapshot-owned inverse parent edges in the
shared bitmap HAMT. Leading edits replace tree/index paths rather than relocating
all later markers. Removing a reparsed parent marker leaves retained nested
occurrences independent. Deleted records are removed from the current root;
old snapshots retain only their own shared roots. Adjacent text fragments coalesce
at edit boundaries, so temporary marker insertion/removal does not accumulate
fragments. Cold construction is bulk, not one persistent insertion per marker.

The existing shared string map became `collections/hash_map.ts`: key hashing
belongs to its producer, strict key identity to the map. Numeric occurrence IDs
are not truncated to their 32-bit hashes. Forking an old snapshot creates a fresh
mutable ownership epoch; constant-time size tracks actual entries, not history.

Reference inspection included Lezer's
[tree representation](https://github.com/lezer-parser/common/blob/main/src/tree.ts)
and [fragment mapping](https://github.com/lezer-parser/common/blob/main/src/parse.ts),
and Immutable.js's [owner-scoped Map mutation](https://github.com/immutable-js/immutable-js/blob/main/src/Map.js).
This adopts bounded leaf storage, occurrence/location separation and structural
sharing, not another grammar or an in-place rewrite of AST positions.

A fresh-context independent reviewer checked 50,000 edit/fork steps against text,
UTF-16 positions, exact AVL balance/aggregates, inverse parent edges and reachable
record counts; 200,000 numeric-map edits with collisions/forks/400 retained
snapshots; and every cursor seek over 1,000 initial/edited layouts. The reviewer
found a real source-retention bug: a 32-character slice retained its deleted
16-MiB source. The text-leaf producer now constructs bounded owned UTF-16 strings
(including unpaired surrogates), instead of storing arbitrary source slices.
Independent GC remeasurement: 0.137 MiB live delta, 0.136 MiB after releasing the
layout, versus the original 16.124/0.123 MiB. These small residuals include process
noise; record-count tests alone would not have caught the bug.

Durable probes: `tests/lua/source_layout.test.ts`, `tests/lua/hash_map.test.ts`,
`scripts/analysis/profile_lua_source_layout.ts`. On Node 22.23.1 / Ultra 7 265KF,
20 warmups and 100 samples, isolated p50/p95 milliseconds:

| Markers / UTF-16 length | Bulk create | Leading insert+publish | All random origins | Sequential marker/text walk |
| --- | --- | --- | --- | --- |
| 100 / 4,000 | 0.052/0.176 | 0.014/0.026 | 0.019/0.026 | 0.012/0.016 |
| 1,000 / 40,000 | 0.580/1.307 | 0.024/0.046 | 0.354/0.557 | 0.114/0.283 |
| 10,000 / 400,000 | 8.157/9.410 | 0.053/0.067 | 6.332/7.531 | 2.109/2.967 |

The cursor is an amortized sequential **offset** walk; repeatedly calling random
line/column projection does not make a consumer linear. Full compiler/binder
walks must use the appropriate projection path. These numbers are not parse,
bind or UI timings and do not satisfy the slice-1b integration gate. The existing
publication edit profiler after map generalization showed comparable medians
(player public update 16.2–16.8 vs 16.7–17.3 ms in four workloads), but variable
p95s (including 24.8 vs 17.6 ms for rename): no complete no-regression claim is made
from this single pair. Actual parser, tokens and binder are still whole-file.

Foundation validation: 11/11 targeted tests; full Lua suite 1,971 passed,
one existing named-workbench-menu failure, one skipped (1,973 total). Targeted
TypeScript check reports only the pre-existing unused `depth` parameter in
`definition_types.ts`; `git diff --check` passes. No compiler/IDE behavior claim
is made for the as-yet unwired source-layout index.

### Relative span integration — validated foundation (2026-09-20)

The parser now emits occurrence-relative UTF-16 spans directly
from the existing parser. Statement/function units retain distinct identity;
blocks, argument separators, fields and type references use the same coordinate
contract. A snapshot-owned `LuaSourceLocations` explicitly projects spans for
binder/compiler/IDE consumers. No AST getters/proxies or shifted suffix copies
are involved. Parser recovery owns discarded nested unit markers as skipped
syntax; lexical failure retains its unparsed source suffix.

Fresh syntax generations retain source plus the parser's native origins and
source-ordered placements. Their LF-only line index is lazy. The persistent
layout is materialized once on first edit-index access, not on every cold parse
or binding request. Layout-backed generations get their own empty origin/range
caches and never borrow the old absolute index. This follows the source-owner
separation in [TypeScript's lazy line map](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/scanner.ts)
and [Roslyn SourceText](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/Text/SourceText.cs),
not TypeScript's mutable incremental AST. First-edit materialization cost still
needs to be measured alongside subsequent edits: deferral alone is not a speedup
of the full incremental route.

The schema-owned syntax storage boundary is now explicit. ROM `compiled_start`
still identifies program modules; its Lua payload is consumed only by TS tooling,
not a TS/C++ VM datapath. `syntax/serialization.ts` persists plain syntax/tokens,
source/path, source-ordered unit offsets and a shared span table. Storage-local
ordinals are not runtime unit identities. Import allocates fresh occurrences,
preserves shared span identity and constructs the source owner without reparsing.
Locations, lazy indexes, cursors and query caches are never serialized. Existing
ROM artifacts must be rebuilt; there is no old-shape revival or compatibility
fallback.

Consumer ownership is explicit across imported tables and callbacks. Behavior
Lens retains the actual `FileSemanticData` for written fields, resolved tables,
FSM binding/callback/result evidence and source edits. Scene outline installation
publishes its source document before selecting/projecting rows. Compiler modules
and interpreter closures project against their own retained syntax generation.

Fresh-context reviews found and drove fixes for quadratic cursor traversal,
unowned recovery markers, premature diagnostic publication and lost shared-span
identity through the generic binary serializer. A far cursor projection over
10,000 markers now uses tree summaries (42 HAMT lookups, height 16), covered by a
height-bounded regression test. Independent probes checked 437 tracked Lua files
plus 238 prefixes and 1,500 recovery token mixes; the workspace parser oracle
compares 1,566 sources. Syntax storage roundtrips 1,098 whole/truncated workspace
sources, and direct versus stored O0/O3 output/debug metadata are tested.

**Cold performance gate remains open.** Same isolated pietious edit harness,
Node 22.23.1, 20 warmups/50 samples; function-body edit, p50 / p95 milliseconds:

| Phase | Pre-relative layout foundation | Eager layout projection | Native cold source owner |
| --- | ---: | ---: | ---: |
| director parse | 0.84 / 1.33 | 1.11 / 1.49 | 0.86 / 1.00 |
| director bind | 1.63 / 4.03 | 2.01 / 4.51 | 1.85 / 4.24 |
| director public update | 3.32 / 6.91 | 3.91 / 7.58 | 3.57 / 6.96 |
| player parse | 3.21 / 3.94 | 5.00 / 9.32 | 3.36 / 6.60 |
| player bind | 9.14 / 11.09 | 12.11 / 14.17 | 10.45 / 11.87 |
| player public update | 16.30 / 18.55 | 20.97 / 26.05 | 17.76 / 19.15 |

This removes most of the measured eager-index regression, not all overhead.
These distributions do not establish cold cartcompiler/heap acceptance, and the
2x edit target is not met. Full relative token/trivia representation, persistent
statement/token sequences, editor deltas, syntax reuse and scope binding remain
unimplemented. No completed incremental parse/bind claim is made.

One earlier ownership claim needs qualification: source removal/diagnostics use
retained syntax tokens, but insertion/move/transfer still relex source for trivia.
That is existing work, not solved by passing source locations. Replacing those
scans with the current trivia-free token sequence would be incorrect. Complete
the full-fidelity token owner in slice 2 and then consume that retained sequence
for these edits, with a no-extra-lexer-pass regression test.

### Additional integration measurements (2026-09-20)

`profile_lua_compilation.ts` now makes the cold-syntax compiler check
reproducible from the workspace dump and BIOS import sidecar. Every pass parses
new syntax and compiles the dumped entry plus its reachable modules at O3;
this is warmed JavaScript, not process startup, ROM packing or entry composition.
Four warmups and twelve isolated samples on the same machine:

| pietious, 207 modules / 2,131 functions | Pre-relative `27ae61b2c` | Relative source owner |
| --- | ---: | ---: |
| parse + select, p50 / p95 ms | 120.56 / 185.61 | 118.37 / 155.09 |
| compile, p50 / p95 ms | 3155.84 / 3209.66 | 3202.97 / 3307.11 |
| total, p50 / p95 ms | 3294.38 / 3333.31 | 3356.60 / 3426.98 |

The complete program/debug output hashes are identical:
`3fdb5f9056ff7c83be99a65f19e856cd75546327a18ccc0ec7fe6dbad32ca64d`.
Total median/p95 overhead is 1.9%/2.8% in this sample. The retained bound
285-file snapshot grows from 166.51 to 175.20 MiB after GC; releasing the
snapshot leaves 2.20/2.25 MiB respectively. This is a measured 5.2% retained-heap
tradeoff, not an allocation reduction claim. The absolute semantic presentation
records still coexist with relative syntax until scope binding changes.

The optional workspace arguments to `profile_lua_source_layout.ts` measure the
previously deferred first-index cost separately (20 warmups, 100 samples):

| Initial native source | materialize p50 / p95 ms | materialize + leading edit p50 / p95 ms |
| --- | ---: | ---: |
| director.lua, 32,148 UTF-16 units | 0.20 / 0.94 | 0.22 / 0.96 |
| player/player.lua, 100,293 UTF-16 units | 1.33 / 3.65 | 1.36 / 3.67 |

These results characterize the foundation only. They do not close the final
edit-latency/allocation gate or establish incremental parse/bind performance.

Integration validation: 2,002 Lua tests, 2,000 passing, one pre-existing named
workbench-menu failure and one skip. The 16 rompacker/lint tests pass, including
cross-file source positions and multiline duplicate-statement endpoints. Lint
results for pietious, nemesis_s and BIOS match the pre-migration baseline.
The lint rules now carry `{ locations, issues }`; cross-file diagnostics retain
position facts rather than syntax/whole chunks. A fresh independent review
checked mixed C++/Lua helpers and confirmed their non-Lua logic is unchanged.

Node headless tooling, BIOS, nemesis_s and pietious rebuild successfully with
the new syntax payload. Precision idetests against the rebuilt nemesis_s pass:
`semantic_inherited_factory` (8 assertions), `semantic_dynamic_receiver` (5),
and `semantic_heap_effect_receiver` (3). Targeted tooling/IDE checking still
reports the pre-existing unused `depth`; the wider scripts/tests typecheck has
unrelated baseline errors, but no remaining lint-owner migration errors.
`audit:core-parity` and `git diff --check` also pass.

### Next lexical/reuse gate: independent review findings

The fresh-context lexical review confirmed the next boundary is an immutable
full-fidelity lexical generation, fed by ordered editor changes, before adding
statement reuse. Token payloads must shed absolute positions; a persistent
width/token-count sequence and cursor must retain trivia and lexical failures.
Neither flat token-array copying nor rebuilding every `body` array proves
bounded work for a large unchanged suffix.

In particular, `determineLongBracketLevelAt` can read arbitrarily far through
`=` even when the result is a plain `[` token. Relexing just one previous token
is not sound. Retain actual read extents, including failed probes/EOF, and
aggregate dependency ends in the lexical sequence. Synchronization requires an
unchanged mapped suffix boundary with matching lexical state, not a fixed
number of equal tokens.

Parser reuse must include entry context, consumed/read extents, previous-token
newline context and per-unit recovery status. Initially reparse recovered units;
clean nested statement/function occurrences can be candidates independently.
The ancestor marker surviving is insufficient: children such as arguments in
`f(a, b, c)` still share ancestor-relative offsets, so an insertion before `b`
requires reconstructing them. Reuse only independently anchored statement or
function units until a finer owner is explicitly introduced.

Editor events currently carry replacement lengths, not inserted text. Choose
either replacement text at the producer or composed change mappings into the
current text reader; do not pretend those length-only events can replay literal
layout replacements. Full replacement remains an explicit mode.

### Relative full-fidelity lexical generation

The lexer now produces immutable blocks of at most 32 lexical items, retained
in a persistent balanced sequence. Each token is itself a block-relative span;
there is no separately allocated per-token span wrapper. The sequence aggregates
source widths, significant-token counts and actual read dependencies. Its cursor
supports forward/backward traversal, source-offset and significant-rank seeks,
and non-mutating significant lookahead. A block replacement shares the untouched
prefix/suffix and reconstructs only balanced ancestor paths. This is a storage
primitive, **not yet an incremental lexer or parser**.

The producer emits whitespace and comment items directly. Parser consumers skip
trivia through the cursor, retaining inter-token newline context. Source-edit
commands now use the chunk's lexical generation rather than scanning its source
again. Formatter-only scans have an explicit lexical location owner. Significant
matching for source correspondence deliberately ignores trivia; Myers prefix,
suffix and matching runs traverse cursors rather than copying a significant-token
array or searching the tree for every sequential token.

Read extents include failed long-bracket probes and EOF. This follows the explicit
lookahead dependency in [Lezer's token stream](https://github.com/lezer-parser/lr/blob/main/src/token.ts),
not a fixed number of predecessor tokens. A recovered EOF has a point syntax span
at the failure, an empty grammar spelling and the raw lexical diagnostic; its
full width and LF count cover the skipped suffix in the source owner. It does not
pretend that skipped failure text was consumed as ordinary grammar. Valid token
spellings reconstruct source; malformed losslessness is source plus item coverage.

ROM storage persists the lexical blocks and storage span/unit ordinals explicitly,
not the sequence tree, methods, absolute positions or caches. Decode gives every
import fresh runtime occurrences. The parser merges lexical and statement/function
placements in source order; discarded AST occurrences remain separate from lexical
occurrences during recovery.

Correctness evidence: independent pre-change/changed parser and lexer comparison
on 1,569 complete/edited sources; a separate agent compared 345 repository Lua
files. The full pietious O3 output and debug hash remains
`3fdb5f9056ff7c83be99a65f19e856cd75546327a18ccc0ec7fe6dbad32ca64d`
(207 dependencies, 2,131 functions). Durable tests exercise persistent forks,
random cursor direction changes, significant ranks, bounded dependency searches,
8,192-block suffix sharing and real lexical edit probes. Review caught an incomplete
LF summary on the recovered EOF; that summary now includes the skipped suffix.

Integration validation: 2,015 Lua tests, 2,013 passing, one pre-existing named
workbench-menu failure and one skip; all 129 rompacker tests pass. Rebuilt
headless tooling, BIOS, nemesis_s and pietious succeed. The three precision
idetests against the rebuilt nemesis_s pass (8/5/3 assertions). Core parity and
`git diff --check` pass. The broad tooling/scripts typecheck still has the existing
unused `depth`, rombuilder `Resource` mismatch and unrelated test/machine baseline
errors; no new token/IDE/lint-owner errors remain.

Measured costs, same dumped pietious inputs and Node 22.23.1:

| Boundary | Before lexical migration | Relative full-fidelity tokens |
| --- | ---: | ---: |
| Retained bound 285-file snapshot, MiB after GC | 175.21 | 205.79 |
| Released snapshot, MiB above initial heap | 2.26 | 2.43 |
| Parse + select, p50 / p95 ms | 113.35 / 125.81 | 181.49 / 248.90 |
| Complete O3 compilation, p50 / p95 ms | 3141.86 / 3199.53 | 3297.48 / 3395.03 |

Compilation used fresh syntax per pass, four warmups/twelve samples. These are
warmed-JS timings, not process startup. An initially wrapped token-span payload
retained 221.52 MiB; removing that unnecessary allocation saved about 15.7 MiB.
The remaining full-fidelity/dependency data still costs memory, and complete
compilation is about 5.0%/6.1% slower here. **The final no-material-regression gate
is still open.** Do not count this foundation as edit acceleration: whole-file
parsing and binding still run, and the earlier 2x target is still unmet.

The next section records lexical edit transport. Remaining: source-layout edits
with context/read/recovery-aware syntax reuse, then scope binding.
Before retaining lexical blocks across generations, eliminate original-source
backing-string retention at the lexical text producer (not a consumer-side copy).
Keep an explicit full-replacement mode. The inspected
[CodeMirror ChangeDesc](https://github.com/codemirror/state/blob/main/src/change.ts)
provides the matching reference for composing length-only edit descriptions:
keep changed/unchanged ranges and retrieve replacement text from the latest source,
without retaining another inserted-text history or diffing the entire document.

## Edit-driven lexical reuse and delta transport

`SourceChangeMap` owns length-only edit composition. Its unchanged runs preserve
provenance, not guessed text equality; disjoint edits keep their intervening gaps.
It does not retain replacement text or diff whole source strings. Editor text
changes use this shared representation rather than a second toolchain DTO.

`updateLuaTokens` starts at the earliest block whose recorded read extent crosses
an edit. The scanner resumes only at base-state item boundaries, consumes entire
comments/strings and synchronizes at a proven unchanged old block boundary.
Partial final blocks permit synchronization after token insertions/deletions;
requiring exactly 32 new items would otherwise prevent early resynchronization.
Persistent block replacement shares the prefix, intervening islands and suffix.
Long-bracket edits can legitimately consume the rest of the file. Raw lexical
failures are retained in EOF and presented once through the new source owner.

`OwnedSourceText` detaches bounded 1,024-code-unit chunks at the lexical spelling
producer. The forward scanner retains only its latest detached chunk, and numeric
scanners pass their already extracted spelling to token construction. This is a
lifetime requirement, not an optional optimization: a retained small token must
not pin a historical whole-file string. `profile_lua_lexical_lifetime.ts` reproduces
that boundary. Retaining 24 identifier tokens from separately generated 1 MiB
files retained 24.024 MiB with the preceding lexer and 0.049 MiB here, after GC.
Keeping only the spellings retained 24.016 versus 0.047 MiB. These are Node heap
measurements, not browser evidence or allocation counts.

Projects key analyzed baselines by selected model identity and revision. Full
source publication, removal/re-addition and same-path domain ownership changes
reset the edit baseline. Equal-source no-ops still advance the analyzed revision.
Normal frontend, context-menu, diagnostic and highlighting paths consume retained
model buffers. Explicit source/supplied-parse callers remain explicit publication
modes; `LuaSemanticWorkspace.updateFile` additionally accepts a current-generation
`SourceChangeMap`. A supplied same-text parse remains authoritative.

Independent review caught an event-order defect before acceptance: completion's
public listener can precede the lazily created project, and workspace edits apply
all buffers before publishing each public event. Consequently delta delivery must
happen in the model's apply phase, before public callbacks, not by relying on
listener registration order. Projects only track/invalidate in this internal
phase; analysis stays lazy. The reference is the distinction between internal
model updates and public content notifications in
[VS Code TextModel](https://github.com/microsoft/vscode/blob/1.105.0/src/vs/editor/common/model/textModel.ts).
An additional delayed-highlighting regression is covered by invalidating the
scheduled request when its model changes, rather than analyzing newer content
under the old scheduled version.

Differential evidence includes 1,569 complete/edited source comparisons against
the earlier compiler parser, 6,000 independently generated multi-edit lexical
comparisons, exhaustive lexical-position edits, 160 multi-generation parse/repair
comparisons and 8,000 change-composition batches. A 12,000-line local edit asserts
fewer than 100 emitted items and 5,000 character probes/copies, while retaining the
old suffix. Separate tests cover disjoint islands, genuine whole-suffix lexical
invalidation, generation-relative diagnostics and retained snapshot answers.

Validation of this slice: 2,040 Lua tests, 2,038 passing, the existing named
workbench-menu failure and one skip; all 129 rompacker tests pass. Rebuilt
headless tooling, BIOS and both carts pass the three nemesis_s precision idetests
(8/5/3 assertions). The previously reported `signature_help` null-after-paste
failure still reproduces (the multiline user-call popup does not open); it is not
counted as passing. Core parity and `git diff --check` pass. Broad typechecking
still reports the existing unrelated baseline errors, with no new changed-owner
errors. A fresh integration review independently reproduced both event-order
failures, then verified the corrected apply/public order across all mutation
paths, including compound Undo/Redo: analysis never runs in the delta phase and
the internal/public phases share their computed change arrays.

The durable `profile_lua_edits.ts` now separates full-source phases, incremental
lexical phases, full-source public updates and map-driven public updates. Its known
forward/undo edits are composed outside the timed region; an additional disjoint
workload verifies multi-edit composition. Work instrumentation runs only after
all timed passes. Twenty warmups/fifty samples on the same pietious dump gave:

| Function-body edit boundary | Full-source path p50 / p95 ms | Map-driven path p50 / p95 ms |
| --- | ---: | ---: |
| director.lua lexer | 0.718 / 0.915 | 0.077 / 0.103 |
| director.lua public update + snapshot | 4.296 / 8.141 | 3.536 / 7.706 |
| player/player.lua lexer | 2.812 / 6.872 | 0.081 / 0.112 |
| player/player.lua public update + snapshot | 24.092 / 27.276 | 18.874 / 24.948 |

The forward body edit emits 37 items in two blocks instead of 7,648 / 28,463
items in 239 / 890 blocks respectively; undo emits 27 items in one block.
These counts include consumed widths, not every lookahead character probe.
Player's first member query remained 1.412 / 5.098 versus 1.280 / 5.989 ms;
its tail did not improve in this sample. These are separate warmed phase/public
passes, not actual model-event/keystroke-to-frame timings. The complete public
update is only about 1.28x faster at its median here, **not the required 2x**.

**This is not incremental grammar parsing or binding.** The parser still creates
new AST units and the binder still visits the entire edited file. The cold and
2x public-edit acceptance gates remain open. Against `aeb160d68`, a repeated
pietious O3 cold-syntax run (four warmups/twelve samples, Node 22.23.1) measured:

| Boundary | Previous lexical foundation | Edit-capable lexer |
| --- | ---: | ---: |
| Parse + select, p50 / p95 ms | 158.52 / 281.55 | 187.44 / 245.93 |
| Complete O3 compilation, p50 / p95 ms | 3295.74 / 3363.66 | 3289.26 / 3525.82 |
| Retained bound 285-file heap, MiB | 205.79 | 207.45 |
| Released heap above input baseline, MiB | 2.43 | 2.47 |

Do not call the noisier cold tail or +18.2% parse median a passed cold gate. The
full pietious program/debug hash still matches
`3fdb5f9056ff7c83be99a65f19e856cd75546327a18ccc0ec7fe6dbad32ca64d`.
The heap comparison uses the same dumped workspace and explicit-GC procedure as
the preceding lexical foundation; it is not a per-keystroke allocation count.

## Lowest-priority follow-up: absent-value convention

User request, 2026-09-20: after the incremental parsing/binding work and its
validation, audit the apparently arbitrary mix of `undefined` and `null`
(e.g. an absent call argument versus an absent named table field). Choose one
explicit absent-value convention for these APIs, using C++-style optionality
and representation clarity as a design check. `undefined` is acceptable; no C++
port is requested. Change producer/consumer contracts coherently, not through
callsite normalization or fallback wrappers. This is deliberately last and is
not part of the current implementation slice.
