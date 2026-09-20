# Incremental Lua parsing and binding

Date: 2026-09-19. Current branch: `master` (existing work fast-forwarded from
`fix/lua-bounded-call-contexts` at user request; no new branches).

## Scope and decision

Follow-up to [the definition-based language service](lua_language_service_design.md).
Annotations, additional inference, and changes to the whole-program solver are
out of scope. Optimize edits, not the meaning of interactive queries.

Implement in the ordered slices below. **Slices 0, 1a and 2, the relative syntax/edit transport, and the publication subtask of 3 are implemented.**
The production parser reuses unchanged grammar parts through the same cold
grammar. The first binding-reuse delivery now retains unchanged non-nested
function subtrees and composes their immutable facts into the current file.
Finer nested-body reuse and the original complete performance gates remain
follow-up work; see the user priority clarification and measured delivery below.

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
| `semantic/model.ts` | Single ordered binder; occurrence scope IDs, mutable build state; immutable published file facts | Cached function bodies cannot replay old ambient binder state |
| `semantic/symbols.ts:createSymbolId` | IDs contain defining syntax occurrence, not source line/column | Identity survives shared shifted syntax; semantic facts still require dependency checks |
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

### 3. Incremental binding by scope and dependencies — first delivery implemented

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

## Persistent statement parts — representation for grammar reuse

`LuaChunk.body` and `LuaBlock.body` now contain `LuaStatementSequence`, not
arrays. Bounded leaves and balanced persistent branches support split/join,
part splices, rank/offset cursors and clean-prefix selection using aggregate
consumed/read widths and local recovery flags. Selecting an unaffected run
shares its subtrees; there is no array proxy, suffix flattening or snapshot
chain. Indexed access requires an existing statement rank; optional first/last
consumers handle an empty body explicitly. Sequential compiler, binder, tooling
and cart-lint consumers use cursors; completion traverses backwards.

The existing parser produces the parts directly. Each part holds a statement
or a grammar gap, consumed UTF-16 width, farthest inspected token end, local
recovery state, newline exit state, and owned occurrence units. Nested statement
frames own their own units and propagate read/recovery summaries to parents.
If an attempted statement is discarded, its gap owns every unit allocated by
that attempt, including detached nested syntax. Recovery is recorded even when
an earlier diagnostic already occupies the file's first-error latch. Reads are
recorded on token advancement/lookahead, not on every repeated `current()` call.
The newline exit flag avoids rescanning arbitrarily long retained trivia when
later skipping a reusable run. Previous-token identity must still come from
the new lexical generation.

Coverage is explicitly **the grammar block**, from the preceding consumed
token's end through the terminating token's start. Module attributes are a
separate chunk-prefix production; a failed EOF token owns the remaining lexical
suffix and the chunk retains its skipped span. These are not statement parts.
A clean body summary is therefore not proof of a clean whole file. The future
reuse path must always reevaluate chunk prefix/diagnostic publication and also
prove lexical-block provenance, not merely inspect `hasRecovery` or text spans.
The wire codec persists part metadata and unit ordinals explicitly, rebuilding
the same sequence contract on decode; tree internals are not serialized.

References include the parser reuse gates above,
[Roslyn's internal syntax lists](https://github.com/dotnet/roslyn/blob/main/src/Compilers/Core/Portable/Syntax/InternalSyntax/SyntaxList.WithManyChildren.cs)
and [Lezer's persistent tree representation](https://github.com/lezer-parser/common/blob/main/src/tree.ts).
The independent fresh-context review covers source ownership, read/recovery
metadata, cursor operations, structural sharing and storage boundaries.

**This slice still does not skip grammar parsing or binding.** It removes the
flat statement-array prerequisite before introducing actual reuse into the
existing grammar. Incremental lexical placement and retirement of replaced
syntax units remain part of that next implementation, not deferred performance
claims. The cold and public-edit acceptance gates remain open.

Validation for this representation slice: 2,064 Lua tests report 2,062 passes,
one existing named-workbench-menu failure and one skip; all 129 rompacker tests
pass. The final parser/parts/sequence/codec bundle passes 70 tests. An independent
cold parser oracle agrees on 1,569 complete/edited sources. A fresh reviewer ran
5,000 persistent splice/balance/reuse/cursor oracle iterations, 3,000 source
mutations checking source widths and comprehensive unique occurrence ownership,
and 100 storage byte fixedpoints, with no blocker. The reported lexical-tail
boundary concern is now explicit above and covered by tests. Rebuilt tooling,
BIOS and both carts pass the three nemesis_s precision idetests (8/5/3); core
parity and `git diff --check` pass. Broad typechecking adds no changed-owner
errors to the existing unrelated baseline.

Paired pietious O3 runs against `5d1818c4f` (four warmups/twelve samples,
Node 22.23.1, no concurrent builds/tests during timing) measured:

| Boundary | Before statement parts | Statement parts |
| --- | ---: | ---: |
| Parse + select, p50 / p95 ms | 159.32 / 250.23 | 187.95 / 263.86 |
| Complete O3 compilation, p50 / p95 ms | 3260.52 / 3513.82 | 3298.48 / 3389.31 |
| Retained bound 285-file heap, MiB | 207.46 | 216.61 |
| Released heap above input baseline, MiB | 2.48 | 2.63 |

The program/debug hash remains
`3fdb5f9056ff7c83be99a65f19e856cd75546327a18ccc0ec7fe6dbad32ca64d`.
The added full-fidelity parts/ownership summaries increase retained heap by
about 9.15 MiB. Parse median is still about 18% slower in this paired sample;
a roughly 1.2% complete-compile median increase and a noisier faster tail are
**not** a passed cold-parse gate. Repeated `current()` bookkeeping was removed,
but actual reuse and the final cold/edit performance gates still require work.

## Actual grammar reuse — implemented

`updateLuaChunk` now supplies `LuaSyntaxUpdate` to the existing parser. The lexer
publishes its actual merged replacement runs (old/new source extents and original
emitted block identities). Reuse must fit inside retained lexical blocks,
including the part's farthest lookahead read, and match the parser context.
An ephemeral old-tree frontier seeks into persistent statement sequences;
unchanged runs are shared, not copied into a flat suffix. Changed ancestors can
reuse unaffected nested bodies. The chunk prefix and diagnostics always run.

`LuaSyntaxUpdate` owns coordinate translation and publication of new occurrences.
It retires discarded AST and lexical units **before** applying text edits, then
inserts only newly produced units. It never enumerates retained token placements
or shifts retained syntax. The parser resumes with the previous token from the
**new** lexical generation. If a newly parsed parent fails after retaining child
runs, those occurrences become recovery-owned; only that genuine failed region
collects their units. Successful reuse never enumerates their payloads.

Cold location owners lazily construct their persistent edit index on the first
edit. Work-count tests initialize that index separately; this one-time cost is
not claimed as bounded local edit work. Repeated generations do not retain old
chunks/location owners or accumulate retired occurrence markers.

Independent fresh-context review found no blocker after 50,000 edit generations
compared with cold syntax and a WeakRef/GC owner-lifetime probe. The durable cart
corpus runner compares 3,294 edit/undo generations across 549 files with fresh
parses and retained snapshots. Focused tests cover lexical provenance (including
zero-width EOF blocks), grammar/read/recovery gates, nested reuse, malformed
parents, codec roundtrips, O0/O3 code/debug parity and bounded large-file work.

An isolated pietious edit run (20 warmups / 50 samples, Node 22.23.1, no concurrent
agent probes/builds/tests) measured a function-body statement edit:

| Boundary, p50 / p95 ms | Full source | Incremental syntax |
| --- | ---: | ---: |
| director grammar + placement | 1.126 / 1.363 | 0.443 / 0.547 |
| player grammar + placement | 4.515 / 4.850 | 0.449 / 0.585 |
| player binding | 11.287 / 12.624 | 14.588 / 16.421 |
| player public update + snapshot | 24.055 / 27.443 | 16.531 / 17.716 |
| director public update + snapshot | 4.464 / 8.961 | 3.576 / 10.403 |

The corresponding forward edits parse 5 rather than 210 statements in director,
and 5 rather than 1,696 in player; both allocate 7 syntax units instead of
276/1,860, inserting 9 and retiring 7 occurrence markers. These are untimed
instrumented work counts after the measurement passes. The public player update
is about 1.46x faster, **not** the final 2x acceptance gate; director's tail remains
worse. Binding still walks all syntax, and layout-backed position lookups make
that old whole-file workload more expensive. Scope-owned binding is the next
owner-boundary change, not an excuse to flatten/shift syntax locations again.
First-query and completion timings remain separate from public update; these
are not UI-frame latency measurements.

Final parser-reuse validation: 2,097 Lua tests report 2,095 passes, the existing
named-workbench-menu failure and one skip; all 129 rompacker tests pass. Rebuilt
headless tooling, BIOS and both carts pass the nemesis_s precision idetests
(8/5/3 assertions). Core parity and `git diff --check` pass; broad typechecking
adds no changed-owner errors to the existing baseline.

Paired cold pietious O3 runs against `7a003569a` (four warmups / twelve samples,
no concurrent tests/builds) keep the same program/debug hash and 207 modules /
2,131 functions. Parse/select p50/p95 is 167.15/260.94 ms before versus
188.64/273.81 ms after; complete compilation is 3246.47/3336.95 ms versus
3276.55/3359.26 ms. Retained 285-file bound heap is 216.63 versus 216.64 MiB;
released heap above input baseline is 2.65 versus 2.66 MiB. The cold-parse gate
is still **open**; neither the unchanged heap nor approximately 0.9% total
compile increase cancels the observed parse regression.

## Binder prerequisite: declaration occurrence identity

Declaration IDs now use file ownership plus the defining syntax unit/relative
start, declaration kind and name path. Every declaration producer supplies its
defining syntax, including identifier and quoted table fields; the identifier
lookup map still contains identifiers only. No process-wide declaration interner
or source-text identity cache is introduced. A cold independent parse has new
occurrences; a reused occurrence keeps its ID, not its old presentation object
or binding answers. Existing snapshot-owned symbol maps publish the current
`Decl` for that ID while retained snapshots keep their own declaration record.

The audit found a real coupling between identity and behavior: same-file global
navigation selected the lexicographically smallest old position-based ID, so
line 10 beat line 2. Keeping this rule with allocation IDs would make navigation
change with edit/allocation history. Publication now explicitly selects the
first numeric source occurrence within the first-precedence file. This is a
deliberate correction of that tie-break, not an incidental ID-format change;
cross-file precedence, global enumeration and written-source contribution order
are unchanged. The publication bucket retains current declaration records, not
a second ordering/position authority.

This is **not incremental binding**. Absolute presentation/visibility points,
file-wide scope indices and ambient property/signature state remain in the
binder. Owned value IDs also remain binding-generation-owned until real local
fact units can own them; no temporary weak interning layer is added merely to
make a whole-file rebuild look reusable.

Next boundary: make lexical scope facts authoritative and relative at their
producer, migrate scope/visibility consumers together, then record successful
and failed external lexical/property/signature reads and outer contributions.
Do not cache or replay `visitFunctionExpression` into mutable ambient maps.
The reference is rust-analyzer's separation of local arenas/source maps in
[expression storage](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir-def/src/expr_store.rs)
and its [lexical scope implementation](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir-def/src/expr_store/scope.rs).
Its Rust body-isolation assumptions do not transfer wholesale to Lua's outer
writes and property discovery.

Validation of the declaration-identity prerequisite: fresh-context review found
no blocker; focused identity/publication tests pass 11/11. The full Lua suite
reports 2,102 tests: 2,100 pass, the same named-workbench-menu failure, one skip.
Broad typechecking adds no errors in changed owners; rebuilt tooling passes the
three precision idetests (8/5/3), and `git diff --check` passes. An isolated repeat
of the edit profiler measures director/player public function-body updates at
3.390/7.485 and 17.532/18.824 ms p50/p95 respectively. Player whole-file binding
is still 15.230/24.299 ms; this identity migration does not claim a binding speedup
or a passed final performance gate.

## Binder prerequisite: relative lexical boundaries

The producer now stores scope start/end and declaration activation sites as
`LuaSyntaxPoint { unit, offset }`, defined by the existing syntax-location owner.
Scope lookup and visibility compare offsets in the current generation;
source correspondence resolves points through each independently parsed owner.
Relocation, frontend scope checks and runtime local inspection consume the same
contract. There is no parallel absolute scope/activation copy or hidden getter
that changes presentation with the current editor revision.

Local activation remains strict after its activation token. Ordinary locals do
not see themselves in their initializer; recursive const closures activate at
their declaration name. Repeat scopes include their condition. Root scope ends
one position after the lexical EOF point, including recovered lexical failures.
A reused point resolves through the old or new owner without mutating either.

This removes two more absolute-location fields from future reusable facts. It
**does not** yet replace file-wide scope/declaration indices, `Decl.range`,
reference ranges, annotations or mutable ambient property/signature discovery.
Full-file traversal remains. Do not interpret this boundary migration as cached
scope facts, and do not preserve the remaining wrong ownership by wrapping it.

The retained-snapshot oracle exposed an existing location-owner inconsistency:
layout-backed projection discarded the residual offset after the final leaf,
while source-backed projection kept it. Both layout and sequential cursor now
carry that residual column offset, including empty documents and trailing
zero-width units. EOF+1/EOF+2 tests cover both paths; no binder fallback or
alternate scope endpoint was introduced.

Validation: a before/after owner oracle matches scope/activation presentation on
549 cart files against `f23a76327`; focused scope/visibility/correspondence/
relocation/capture tests pass 66/66 and layout/location tests pass 17/17. The
independent reviewer found no blocker, including malformed EOF probes. The
final Lua suite reports 2,108 tests (2,106 pass, the same workbench-menu failure,
one skip); rompacker passes 129/129. Broad typechecking adds no changed-owner
errors. Rebuilt tooling passes precision idetests 8/5/3; core parity and
`git diff --check` pass.

An isolated 20-warmup/50-sample repeat measures director/player public body edits
at 3.322/7.455 and 16.412/17.351 ms p50/p95. Player binding still costs
14.345/15.974 ms; its full-source public comparison is 25.085/28.304 ms. Retained
285-file bound heap is 215.33 MiB, released overhead 2.61 MiB. This remains
approximately 1.53x at the public player-update median, not the final 2x gate.

## Binder prerequisite: relative facts and explicit highlighting presentation

Declarations, references, member-access sites and module references now retain
`LuaSyntaxSpan`, not absolute `SourceRange` objects. Defining-name extents are
produced at declaration creation: identifier table keys cover the name only;
quoted keys preserve the written literal extent. Position queries compare
owning offsets; navigation and other presentation results explicitly project
ranges through the retained file generation. The resolver owns the single
snapshot file lookup map, also used by snapshot consumers.

Highlighting follows the same boundary: the binder emits relative
`SemanticTokenFact` records, without asking for positions or ranges.
`getLuaSemanticAnnotations` in the existing token owner projects and caches rows
only when a consumer requests highlighting, using a WeakMap keyed by the
immutable file generation. Code layout requests that projection explicitly.
This is syntax highlighting, **not** the deferred LuaLS type-annotation feature.
There is no mutable current-generation getter on retained facts.

This is still a prerequisite, **not scope-owned binding reuse**. File-wide
scope/declaration indices, ambient property/signature maps, flow-owner object
links and whole-file traversal remain. No body cache replays these mutable maps.
The next implementation must produce composable local facts with explicit
external dependencies, including failed lookups, before skipping scope work.

The edit profiler now separately reports highlight projection after queries;
phase totals include that work. Public updates have both analysis-only and
update-plus-highlighting passes, neither including queries. Compare the latter
against the eager-highlighting baseline; moving work must not be reported as
eliminating it. The heap profiler likewise distinguishes bound facts from a
snapshot with every file's highlighting materialized. Neither profiler is an
editor-frame measurement.

Independent fresh-context review found no blocker and explicitly called out
possible extra annotation-fact plus presentation allocations. A before/after
oracle matches all fact locations, signatures and highlighting rows on 549
cart files against `fda1dc801`. Tests cover retained shifted generations, exact
field extents, zero position/range calls during binding, lazy highlighting and
logarithmic ordered-span lookup. The full Lua suite has 2,113 tests: 2,111 pass,
the same named-workbench-menu failure, one skip. Rompacker passes 129/129;
rebuilt tooling passes precision idetests 8/5/3. Broad typechecking reports no
new changed-owner errors; core parity and `git diff --check` pass. The older
parameter-context and recursive-input conformance profilers fail identically
on the baseline before their migrated range assertions; they are not counted
as passing validation.

Isolated paired runs (20 warmups/50 samples, no simultaneous builds/tests)
measure function-body public updates **including highlighting** as follows:

| File | `fda1dc801` p50/p95 | Relative facts p50/p95 |
| --- | --- | --- |
| director.lua | 3.280 / 7.383 ms | 2.921 / 6.786 ms |
| player/player.lua | 16.794 / 17.851 ms | 13.873 / 15.220 ms |

Player's new analysis-only public update is 11.765/13.461 ms; it is not the
combined highlighting figure. Its whole-file bind is 9.392/10.624 ms and
highlight-after-query projection is 2.541/6.053 ms (separate phase percentiles
must not be added). Member query is 1.216/4.838 ms versus 1.301/5.132 baseline;
completion-after-member is 7.888/11.804 versus 8.380/12.797 ms. Current
full-source update plus highlighting is 22.919/24.998 ms: the incremental path
is about 1.65x at both percentiles, **not** the final 2x gate.

The relocation conformance helper is also migrated to the current syntax,
scope-point and transfer APIs (it still contained older absolute-AST accesses).
Its real edit/rebind oracle passes 4,508 transfers and 4,848 binding checks on
345 tracked Lua files, including 698 predicted binding changes.

A fresh paired O3 compilation of pietious (207 modules, 2,131 functions)
produces the same complete serialized output hash on `fda1dc801` and this
change: `dd405f9a1b6fb463b2f8b2fb8bdf9f81d0cb2c84d89a7f1e5d583bf0d19b51d5`.
Total compile p50/p95 is 3,237.98/3,388.87 ms baseline versus
3,231.20/3,262.64 ms current. The parse-only subphase is noisy and higher in
this run (169.30/222.98 versus 185.77/252.59 ms); this slice changes no syntax
producer, and these totals do not close the earlier cold-parser gate.

Retained 285-file heap is 192.10 MiB before highlighting and 205.59 MiB with
all highlighting projected, versus 215.20 MiB in the eager baseline. Released
overhead is 2.63 versus 2.50 MiB. These are post-GC heap deltas, not allocation
counts; temporary allocation and browser-frame claims remain unproven.

## Binder prerequisite: lexical scope handles and generation-owned attachment

Lexical scopes now have `ScopeID`, based on binding file, relative syntax point
and scope kind. A declaration records that handle rather than a file traversal
index. Lexical scope rows reference the published declaration objects directly;
no declaration-array indices escape into those rows. The temporary builder's
publication slot is private and does not survive publication.

Parent attachment is stored only in the file generation's `scopeParents` map;
`scopesById` resolves handles and the ordered scope array serves interval lookup.
These are indexes of the same facts, not shifted/rebased scope copies. Inserting
a sibling does not change an unchanged body's ID; rebuilding its outer body
changes the attachment in the new generation without modifying the old one.
Binding the same supplied syntax under different file paths produces distinct
scope IDs.

A function flow uses its body scope ID, and declaration writes identify their
writer by that ID. Flow facts no longer point at an enclosing flow object.
The call-hierarchy summary owner derives enclosing functions through the current
generation's lexical parent graph, including intervening block/loop scopes.
Source correspondence maps independent generations' handles explicitly; source
inspection, lexical queries and relocation no longer consume file-wide scope
indices.

This is **not a body cache** or an incremental-binding completion claim. Binding
still traverses every scope and builds fresh facts. Property/global witness
selection and signature mutation are still the old ambient contribution rules;
converting their indices to handles does not make those rules scope-owned. The
next boundary removes that discovery/mutation coupling, rather than recording
and replaying it. A property declaration's current scope association is not proof
that its write was performed there; writes carry their own flow identity.

Validation so far: the 549-file paired oracle matches lexical attachments,
declaration/activation presentation, signatures and write ownership against
`32ca8e7eb`. The full Lua suite reports 2,115 tests (2,113 pass, the same
workbench-menu failure, one skip); a subsequently added same-AST/two-file
identity test brings the focused lexical file to 7/7. Focused scope/receiver/
relocation/correspondence/capture tests pass 68/68, and flow/write-source tests
pass 55/55. Relocation conformance again passes 4,508 transfers/4,848 binding
checks on 345 files. Rompacker passes 129/129; rebuilt tooling passes precision
idetests 8/5/3. Broad typechecking adds no changed-owner errors; core parity and
`git diff --check` pass.

A paired one-shot O3 build of pietious (207 modules/2,131 functions) has identical
complete serialized output:
`a297b840826af25b3345872b9d31dc0a1efcfaf8437e4c9ddaf99c5ba54ac505`.
This is compiler parity evidence, not a one-sample performance claim; compare
hashes only between runs with the same parse/allocation sequence.

Fresh-context review found no blocker, including a shared-AST/two-file probe
and 63 targeted tests. It confirmed the property/global scope-association
qualification above. The final producer consumes the scope's ID directly when
creating its flow, avoiding a duplicate ID string/point allocation.

Isolated 20-warmup/50-sample runs, including highlighting: director public body
updates are 2.901/6.451 ms p50/p95 versus 2.830/6.376 ms on `32ca8e7eb`;
player is 14.206/15.755 versus 14.100/16.054 ms. An earlier pre-cleanup repeat
had a player p95 of 20.929 ms, so this is not evidence of a tail-latency
improvement. Current player binding is 9.165/10.762 ms, member query
1.186/4.561 ms and completion-after-member 7.917/11.718 ms. Full-source public
update plus highlighting is 22.552/27.769 ms; the final 2x gate remains open.

Retained heap for 285 files is 194.39 MiB bound and 207.88 MiB highlighted,
versus 192.08/205.58 MiB baseline: stable scope IDs and generation indexes cost
about 2.31 MiB. Released overhead is 2.53 versus 2.61 MiB. This is an explicit
ownership cost, not a memory/performance optimization claim or binder reuse.

## Signature facts and snapshot-owned optionality

The next body-binding prerequisite removes `Decl.signature` and the binder's
mutable signature map keyed by printed name paths. Two independent fixtures
showed that it selected a same-named function outside the lexical scope, or
missed an inner definition because it inferred the enclosing function before
binding its body. Merely caching that map would retain those errors.

Written function headers now come directly from occurrence-owned function
flows, indexed by their declaration within the bound file. Hover does not ask
for required-argument inference, alias evaluation or a call solver merely to
format a written header. Multiple functions written to one binding retain
separate headers/signatures rather than overwriting declaration metadata.

Required-argument analysis is a separate signature/diagnostic query:

- Intrinsic optionality recipes use bound parameter identities, not identifier
  spelling. These facts are cached with the bound file, independently of
  snapshot-derived callee answers. Builtin `type` availability is an explicit
  input; a local or workspace-global shadow cannot supply a builtin guard.
- Forwarding reads accept one directly bound written definition in the same
  file, or a direct function literal. Alias/value-return inference, dynamic
  receivers, multiple definitions and external callees are deliberately unknown.
  Signature-help target discovery still uses the ordinary definition layer;
  this narrower contract concerns only forwarded optionality evidence.
- Only relevant signature reads enter the dependency graph. Intrinsic unsafe
  use, local optional proof or unknown OR alternatives remove unneeded reads.
  Iterative SCC classification precedes evaluation; every intra-component
  read is unknown, and the component DAG is evaluated once. There is no
  parameter/effect fixpoint or recursion-stack-dependent answer cache.
- The existing local optionality policy remains: an unknown forwarded argument
  supplies optional evidence, while a known-required argument alone is not an
  intrinsic unsafe use. This is not a general Lua type-safety proof.
- Inferred answers belong to the workspace snapshot. Retaining a file or old
  snapshot must not retain a new snapshot's inferred dependency answers.

References revisited: rust-analyzer's
[function signature owner](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir-def/src/signatures.rs)
separates function-ID queries/source maps from bodies; TypeScript's
[binder](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/binder.ts)
does not justify replaying ambient name maps for sub-file reuse. These inform
ownership, not a claim that either implements this Lua optionality policy.

Validation of this owner slice: focused signature/frontend/edit-equivalence
coverage passes 96/96; the full suite
reports 2,138 tests (2,136 pass, the known workbench-menu failure, one skip).
Rompacker passes 129/129, rebuilt tooling passes precision idetests 8/5/3,
and the one-shot O3 pietious build again has exactly the full output hash
`a297b840826af25b3345872b9d31dc0a1efcfaf8437e4c9ddaf99c5ba54ac505`.
Broad owner/tooling/test typechecking adds no changed-owner errors (existing
`definition_types.ts` unused-depth and unrelated repository errors remain).
Core parity and `git diff --check` pass.
The fresh-context review accepted the final direct-only ownership contract;
it does not certify the still-unimplemented body cache.

The durable `profile_lua_signature_edits.ts` now measures independent first
hover, signature-help and full-file-diagnostic demand after real edit/undo,
not just the newly cheaper binding phase. The final isolated 20-warmup/50-sample run (p50/p95 ms) is:

| Update plus first demand | Current | `89c9690d5` repeat |
| --- | --- | --- |
| director hover | 3.782 / 6.381 | 3.801 / 7.035 |
| director signature help | 4.825 / 9.438 | 4.183 / 9.345 |
| director diagnostics | 3.955 / 6.842 | 4.060 / 7.007 |
| player hover | 12.939 / 14.402 | 12.435 / 13.516 |
| player signature help | 13.341 / 21.464 | 14.405 / 23.147 |
| player diagnostics | 14.605 / 16.537 | 14.408 / 15.752 |

Earlier direct-only repeats had player signature-help totals of 14.92–15.33 ms
p50 and diagnostics of 14.57–14.70 ms, compared with baseline 14.41–15.44 and
13.94–14.41 ms respectively. New signature ownership has a small query cost,
not an across-the-board speedup; timings and GC/JIT tails vary. No
keystroke-to-screen/UI claim is made from these CPU measurements.

Paired ordinary edit measurements, including highlighting: director body
updates are 2.875/6.633 ms p50/p95 versus 2.969/6.564 baseline; player is
13.836/15.049 versus 14.614/18.410. Full-source updates with highlighting
are 6.459/12.756 versus 6.567/12.325 for director, and 23.330/25.490 versus
24.073/26.231 for player. Player binding is still 8.929/10.031 ms; the final
2x incremental-edit gate remains open.

The lifetime profiler now additionally retains a frontend with diagnostics
for all 285 files, so lazy signature caches are included: bound/highlighted/
diagnosed heap is 193.58/207.08/209.52 MiB versus 194.41/207.90/209.20 baseline;
released deltas are 3.06 versus 2.91 MiB. Moving computation out of binding
is not presented as eliminating its retained query costs.

### Written-alias component correctness — implemented

A fresh-context signature review found a pre-existing definition-layer cache
bug: querying `alias` first could cache a partial answer for `sink` in this
written cycle:

```lua
local sink, alias
sink = alias
alias = sink
alias = function(x) return x + 1 end
```

`definition_aliases.ts` now owns the lazy finite graph of zero-step written
aliases. It condenses reachable cycles and publishes one complete shape union
for every member, after outgoing dependencies. Components are ordered by file
and numeric source offset, not by allocated syntax IDs. Source-value memoization
does not independently cache these alias edges. The traversal is iterative,
including long acyclic chains; it does not instantiate calls or infer effects.

The existing signature SCC traversal was extracted to
`collections/strongly_connected_components.ts`, shared by the two actual graph
owners. Traversal metadata exists only on temporary graph nodes, not syntax or
retained file facts. The iterative dependency-first contract was also checked
against [LLVM SCCIterator](https://github.com/llvm/llvm-project/blob/main/llvm/include/llvm/ADT/SCCIterator.h).

Normal and prototype evaluation now have explicit independent memo/pending
contexts. The former ambient phase/map capture-and-restore has been removed;
raw alias topology is shared by the snapshot, answers are not shared across
modes. This guarantee is deliberately limited to **pure written-alias cycles
with nonrecursive terminal evaluation**. Member/call/module/receiver/prototype
projections are not zero-step aliases; their existing recursion limitations
remain. Neither general definition-query order independence nor body fact
reuse is claimed by this slice.

Validation against `3efc6fcf6`: focused 64/64 (including 12 alias cases and four
SCC utility cases); the full run before the final singleton work-stack
simplification had 2,151 passing, one known menu failure and one skip;
rompacker 129/129; product build and precision idetests 8/5/3 pass. Relevant
owner/typecheck diagnostics are clean; existing unrelated broad type errors
remain. O3 pietious output (207 modules/2,131 functions) has the identical
one-shot hash `a297b840826af25b3345872b9d31dc0a1efcfaf8437e4c9ddaf99c5ba54ac505`.
Core parity and `git diff --check` pass.

New 300-reference sample comparisons have identical definition answers to
baseline on both carts. Pietious: zero contradictions and zero targets absent
from the solver. Nemesis: zero contradictions, but **one baseline-identical
target absent from the solver**, `aem.lua:160`'s
`target.source.loop_start_sample` -> `apu.lua:123`. Thus the strict zero-extra
oracle does not pass for that new Nemesis sample; it is not reported as a new
regression or hidden by excluding the reference. The previous handoff's sample
was different.

The fresh-context review found no blocker for this limited guarantee. Measured
completion overhead in the initial graph version prompted two owner-level base
cases: terminal definitions allocate no DFS topology, and singleton leaves need
no dependency-DAG work stack. Both retain the same recursion markers; an explicit
self-alias regression covers that case. Final director body-edit completion
p50/p95 is 7.881/10.552 ms versus baseline 8.041/10.455. Its public edit+highlight
is 2.837/6.479 versus 2.825/6.676 ms. This is CPU evidence, not UI latency or a
2x edit improvement. The last two-file run before the final leaf work-stack
simplification measured player edit+highlight 13.921/14.652 versus
13.857/15.169 ms; whole-file binding remains the dominant unremoved work.

The lifetime profiler now explicitly roots inputs and retained snapshot/frontend
owners through each GC measurement; local variable liveness alone was insufficient
once an all-member query pass was added. With 21,088 member/method references,
12,890 resolve in both versions. Rooted queried heap is 221.46 MiB versus 221.11
baseline; released deltas are 3.30 versus 3.43 MiB. These are whole retained-query
heap measurements (taken after the topology shortcut), not allocation counts;
the earlier local-only release measurements are not the new lifetime oracle.

### File-generation import provenance — implemented

Removed derived `moduleTarget` fields and their post-bind mutation from
`LuaCallSite` and `ModuleValueEntry`. Raw facts retain only their authored value
sources. `module_bindings.ts:getLuaModuleAliasTarget(file, source)` now owns a
lazy file-identity cache of the existing complete-write alias index and demanded
source answers. Module reexports and both Scene Editor/Behavior Lens discovery
supply the owning file explicitly; colon calls are rejected before demanding
provenance. The cache is not keyed by syntax/source identity alone: one retained
callee can have different answers in old and edited file generations.

The admission rules are unchanged: single-initializer local imports/copies and
static members are supported; a write anywhere in the binding's lifetime,
including a nested body, invalidates the alias chain. This does not move builtin
recognition, infer dynamic module contents, or cache body binding. The ownership
reference is TypeScript's checker-local node-link/alias answers, not placing
semantic results on reusable syntax. Canonical API documentation is updated in
[lua_source_api_bindings.md](lua_source_api_bindings.md).

A fresh-context review found no new owner/lifetime blocker. Focused import,
registration, scene and edit-equivalence tests pass 82/82. The new regression
queries the same frozen callee/export sources against old and edited file
facts in both demand orders: a nested captured write changes only the edited
generation's answer. Actual call-fact reuse remains the later body-binding gate.

Both durable demand/lifetime profilers now include import provenance and
snapshot reexport indexing. Moving work out of binding is not presented as
removing it: first demand builds the alias index and retains source answers;
repeat reads perform the owner-cache lookups.

Full validation: 2,153 Lua tests pass, with the known named-menu failure and
one skip; rompacker 129/129, product build and precision idetests 8/5/3 pass.
The broad typecheck adds no diagnostics in changed owners/profilers, but still
has unrelated existing failures. O3 output matches the preceding alias slice
exactly (same 207 modules/2,131 functions and hash above). Core parity and diff
checks pass. The independent reviewer also inspected the final required-source
contract, early colon filtering and retained-generation regression.

Isolated 20-warm/50-sample CPU measurement against the preceding alias slice
(archived `5eb7e6d85`; amended to `d8bc99017` with a comment-only correction):

| Edited file | Update + first imports p50/p95 ms | Baseline | Import demand alone p50, current / baseline |
| --- | --- | --- | --- |
| director | 2.495 / 5.366 | 2.489 / 5.259 | 0.159 / 0.107 |
| player | 11.390 / 18.911 | 11.401 / 19.911 | 0.491 / 0.350 |

The two files retain the same 20/44 authored dot-call import answers. Independent
hover/signature/diagnostic passes show no uniform speedup (e.g. player signature
13.919/18.821 versus 13.259/16.793 ms); these are not UI latency measurements.
The baseline profiler uses its published fields where the new profiler calls
the generation-owned query, otherwise the workload is identical.

All-file import demand admits the same 1,304 calls. Rooted heap before import
demand is 221.21 versus 221.47 MiB; after demand it is 221.71 versus 221.50 MiB.
Released deltas are 3.32 versus 3.31 MiB. Binding no longer retains an alias
answer on every call, but the demanded file-query maps have their own retained
cost. The final incremental-binding/performance gate remains open.

Remaining body-binding gate, independently audited: global/member storage is
still selected from prior traversal witnesses (`globalsByKey`,
`propertiesByOwner`, reverse declaration-write scans). Replace it with raw
storage paths plus per-occurrence written contributions and composition-owned
navigation witnesses. Generation-owned module aliases are now separate from
raw calls/exports, but the storage/contribution blockers remain. Reusing bodies
before those changes
would just replay ambient binder state. The final gate must demonstrate
unchanged sibling fact identity and zero binder visits, not just lower timings.

### Next cold-binding owner gate (fresh-context audit)

Before retaining bodies, separate three identities in `model.ts` and every
consumer: lexical storage remains a declaration ID; global/member storage is a
raw `globalValueSource`/member path; each nonlexical written definition has its
own occurrence declaration. Local reassignment keeps its original lexical
binding. An earlier navigation witness must never choose a later write's
storage or suppress another written function/constructor field.

Composition must keep writes-by-storage separate from writes-by-definition;
`written_sources.ts`, definition aliases, direct callable/signature selection
and whole-program fact ingestion must migrate together. Do not replace the
current witness with a synthetic canonical declaration. Navigation precedence
is a separate policy from storage multiplicity.

Additional live blockers identified by the independent review:

- Builtin recognition (`require`, metatable operations, iterator projections)
  currently depends on `callee.decl`/ambient static declaration lookup. Simply
  removing global witnesses would wrongly classify user-defined globals as
  builtins. Raw binding and composed builtin-availability facts need distinct
  ownership before reuse. The compiler's syntactic module dependency closure
  is not a semantic shadowing oracle.
- `Ref.caller` comes from the nearest named enclosing flow. Treat that as an
  attachment-owned projection or an explicit body input, not accidental old
  builder stack state.
- Valid reuse inputs include name-to-lexical-declaration lookup results **and
  misses**, activation position semantics, receiver and declaration metadata
  actually consumed. A set of captured IDs alone is insufficient. Prior global
  or property winners are not lexical captures and cannot be replayed.

Acceptance remains actual sibling fact identity with zero binder visits,
capture-miss invalidation, independent child reuse, repeated global/member
writes and alias owners, unchanged old snapshots, cold/edit answer comparison,
and first-query performance. This audit is a migration gate, not an implemented
body cache.

### Written member occurrences — implemented

The member-storage part of the cold-binding gate now produces one declaration
per authored member definition. A field in a constructor, a dot/string-key
assignment, and a member function statement each retain their own occurrence,
RHS and writer flow. The raw `MemberValueEntry.owner`/`name` path is separate
from that definition ID. Lexical variable reassignment still uses its original
binding. Member reads no longer inherit a preceding property witness.

The removed binder member maps and reverse declaration-write lookup are not
cached or replayed. A local root supplies visibility/scope metadata; an earlier
member declaration does not. The builder appends each member contribution
once, in its actual module/function owner, without the old coalescing scan.
This also corrects top-level methods on local tables being published as global
members merely because they were declared in file scope.

`written_declarations.ts` owns a lazy file-generation raw-member index and
cached direct written destinations. It follows exact member paths and directly
written constructor fields, consuming a path step per constructor projection;
it does not follow aliases, calls, dynamic indices or foreign modules. Unknown
and literal value roots are not storage identities. Signature optionality uses
this direct evidence only when it selects one written function; ordinary
interactive navigation/callables also retain the broader definition-shape
query. Diagnostics no longer depend on a binder-selected member target.

Navigation combines exact authored path evidence with definition-shape
answers. This keeps `external.run = ...; external.run()` navigable without
inventing a type for `external`, and keeps explicit writes on a parameter
navigable without inferring incoming arguments or another function's effects.
A write always names its own definition, including dynamic/unknown owners whose
other uses cannot be resolved. A member assignment position is now its actual
written declaration, rather than the first constructor field; reads and
find-references include the other definitions of that storage. Completion
remains shape-based: this change does not manufacture receiver shapes for
unknown values.

Written path caches use the central `semanticValueSourceKey` representation.
A regression with a valid NUL-containing Lua string key exposed an ambiguity
between one member component and a longer path. The central owner now
length-delimits arbitrary root/member strings and nested index keys; there is
no feature-local encoding. Structural equality/key tests cover the boundary.

The call hierarchy's demand index consumes direct written destinations as
**candidate selection only**, including string-indexed callees which have no
identifier reference. Reverse callable-use discovery can reach those authored
calls without publishing member effects first. Candidates never enter
`directTargets`: the solver must still resolve the actual callee/receiver
before instantiating a body or publishing a call. Tests include module-rooted
callback ancestry, callback aliases and an unrelated same-name method which
must not be invoked. Hover presents each distinct written header once while
navigation keeps every occurrence, avoiding dozens of identical field lines.

Production references: TypeScript's
[assignment declaration binding](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/binder.ts)
keeps authored declarations distinct from lookup tables; rust-analyzer's
[body-owned scopes](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir-def/src/expr_store/scope.rs)
separate bindings from traversal state; LuaLS's
[definition query](https://github.com/LuaLS/lua-language-server/blob/master/script/core/definition.lua)
is a lookup owner, not a mutable binder witness. None is evidence of BMSX body
reuse by itself.

Independent review caught and drove regression tests for unknown-root
cross-linking and loss of dynamic-write occurrence identity. Constructor
isolation, repeated member functions, aliases, nested locality, string keys,
writer insertion/removal, old snapshots and cold/edit answer parity have focused
coverage. The old tests which required two authored members to share one
navigation declaration were migrated to assert separate occurrences, while
retaining their original RHS/flow/public-answer checks.

Validation/performance against `e5615ea8e` (same 285-source pietious dump,
Node 22.23.1, 20 warmup + 50 samples, isolated sequential processes):

| Local body edit, ms p50 / p95 | Before | After |
| --- | --- | --- |
| director public update + highlighting | 2.871 / 6.634 | 2.174 / 6.227 |
| player public update + highlighting | 14.084 / 20.596 | 12.931 / 14.332 |
| director first member read | 0.584 / 3.194 | 0.650 / 0.877 |
| player first member read | 1.263 / 4.835 | 1.423 / 5.074 |
| director completion after that read | 7.668 / 11.027 | 7.821 / 11.514 |
| player completion after that read | 8.108 / 11.913 | 8.106 / 11.735 |
| director phase total, including queries/highlighting | 13.766 / 14.922 | 13.113 / 15.332 |
| player phase total, including queries/highlighting | 23.040 / 26.376 | 22.223 / 25.935 |

The durable profiler now explicitly chooses a member **read** (director
`world:set_space`, player `require('cartlib/clock').gameplay`), not the first member write whose
old bound witness bypassed lookup. Both revisions use that same revised
profiler. Public update passes and phase totals are independent workloads;
completion follows a member query, not an entirely cold completion. These are
CPU measurements, not UI-frame latency or the final 2x target.

A measured intermediate highlighting regression exposed duplicate,
out-of-source-order annotations at member function definitions. The producer
now emits one annotation: constructor keys own theirs, member write references
own theirs. There is no presentation deduplication pass. A focused regression
asserts one definition token per member identifier and no identifier token for
quoted keys. Player highlight-after-query p50 is 2.401 ms versus 2.265 ms before,
rather than the intermediate 4.001 ms.

Separate edit + first-demand p50/p95: director hover 3.093/6.291 versus
3.848/7.401; player signature 12.239/14.565 versus 13.398/23.925. Not every tail
improves: director signature is 3.632/7.696 versus 4.120/7.531. No uniform
speedup claim is made.

Explicitly rooted heap after binding is 193.30 versus 193.34 MiB; after
highlighting 206.65 versus 206.83; after diagnostics 211.15 versus 209.30; after
all member queries 226.84 versus 221.36; after import queries 227.35 versus
221.85. The additional lazy written-path index/answers cost about 5.5 MiB after
full demand. Released deltas are 3.36 versus 3.47 MiB. Of 21,088 member/method
references, 13,119 versus 12,890 resolve; this includes direct written-path
answers, not inferred receiver types.

Lua suite: 2,183 tests, 2,181 passed, one pre-existing named-menu failure and
one skip. Toolchain typecheck passes; the broader check has only existing
unrelated errors. Independent reviews covered the member owner, cache keys,
highlighting/hover presentation and candidate-versus-proven-call boundary.

Rompacker 129/129 and precision idetests 8/5/3 pass; O3 compilation of pietious
retains 207 modules, 2,131 functions and identical hash
`a297b840826af25b3345872b9d31dc0a1efcfaf8437e4c9ddaf99c5ba54ac505`.

The 300-reference solver comparison per cart has zero contradictions and no
new definition-only targets: pietious has zero extras; nemesis retains the
same single pre-existing extra at `cartlib/aem.lua:160`,
`target.source.loop_start_sample` (`cartlib/apu.lua:123`). The strict zero-extra
oracle therefore still fails that nemesis sample. Answers intentionally keep
more distinct authored definitions than before; they are not byte-for-byte
identical to the formerly coalesced navigation answers.

This is not the completed body cache: global storage/builtin classification,
caller attachments and actual body contribution reuse remain open. The final
acceptance still requires unchanged sibling fact identity and zero binder
visits, plus the end-to-end edit/performance gates.

### Call hierarchy caller attachments — implemented

`Ref` no longer retains the nearest named enclosing declaration from the
builder's flow stack. `scope_query.ts:getLuaCallHierarchyCallers` derives that
presentation owner lazily from this file generation's `flow.calls`, written
function declarations and `scopeParents`. A nested anonymous body remains a
separate execution flow; only its call-hierarchy presentation inherits the
nearest named ancestor. Module calls and anonymous bodies without a named
ancestor remain chunk callers.

The frontend and the solver's outgoing-fact index consume the same cached
file-owned projection. No call/reference field captures a parent declaration,
no old binder stack is replayed, and interactive features gain no solver
dependency. Most flows have a direct declaration; anonymous flows walk their
ancestry once, not once per call. This is not an unconditional linear-time
claim for arbitrarily deep anonymous nesting.

The implementation follows the occurrence/attachment distinction inspected in
[rust-analyzer's expression scopes](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir-def/src/expr_store/scope.rs).
Independent review additionally inspected
[TypeScript's call-hierarchy ownership](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/services/callHierarchy.ts)
and found no ownership or correctness blocker. Tests cover named/anonymous
nested flows, block scopes, module calls, public incoming grouping, and a
retained anonymous syntax occurrence after renaming its outer function. Old
file generations keep their original answers; cold and edited queries agree.

Validation: focused function/context tests 59/59, public hierarchy/frontend
65/65; complete Lua suite 2,186 tests, 2,184 passed, the same named-menu failure
and one skip. Toolchain typecheck, product build and precision idetests 8/5/3
pass. A corpus comparison against `ebd6b82a6` preserves all 10,783 reference-call
caller answers across 285 pietious files. First projection of all file caller
maps took 2.946 ms in that single run (not a distribution or UI latency).

The same edit profiler (20 warmup, 50 samples, isolated runs) measured body-edit
public update + highlighting p50/p95, before → after: director 2.154/5.561 →
2.333/7.192 ms; player 13.222/14.255 → 12.694/13.494 ms. Binding p50 remains
roughly unchanged (1.070 → 1.093 and 8.006 → 8.091 ms). This ownership slice
makes no edit-speedup claim; the projection is absent from the interactive
bind path. Player's phase run had a 53.692 ms maximum bind sample; tail numbers
are retained rather than discarded as noise. These results are not the final
2x edit-performance gate.

This closes the caller-attachment prerequisite, not body reuse itself. Global
storage/builtin classification and actual contribution caching remain open.

### Global storage and composed operation sites

The binder no longer keeps a traversal-order global-definition witness. Every
root-global write publishes its own declaration occurrence and an explicit
value transfer to raw global storage. A read uses that storage name, never a
previously visited write. Lexical declarations remain lexical, including their
activation rules; root-visible BSS/data/type declarations publish separately.
Navigation precedence remains an independent project-index policy. Definition
alias components and written-source queries consume all authored publications,
not that navigation winner.

This representation also reaches the hierarchy solver: raw global terms are
separate, selectively indexed storage. A function's global publication is a
call effect, not an unconditional body projection. Existing reverse writer
selection finds potential callers, but only proven applications publish their
values. Exporting a global copies its value rather than unioning module and
global storage identity. This is adaptation to the new facts, not an expanded
interactive inference engine.

A context-free review corrected the scope of builtin classification:

- `require` is compiler syntax (`compiler.ts:resolveRequireModuleBinding`),
  disabled by a lexical binding, not by another global write. Its bound call
  explicitly records the imported module and has no runtime callable in either
  interactive queries or the hierarchy solver. O0/O3 execution tests verify that
  an authored same-name global replacement is not executed.
- Metatable and table-iterator sites are raw body facts. A file composition step
  applies the existing finite file-local standard-library projections against
  **all** authored root-global names, including writes in later/nested bodies.
  Lexical shadows never produce these sites. A same-name global write disables
  the projection regardless of binder visitation order. Iterator projections
  consume already bound call arguments; they do not resolve syntax a second time.
- This declared file-local analysis contract is not runtime identity inference.
  Extending suppression to all workspace declarations would incorrectly reject
  the real BIOS's normal `setmetatable` aliases and `pairs` wrappers. No ABI
  manifests, BIOS path whitelist or general wrapper inference are prerequisites
  for body caching. The existing optionality check `!globals.has('type')` is a
  separate limitation, not copied as this slice's classification authority.

The composition creates derived facts only for active sites, without mutating
raw declarations/flows or retained snapshots. It allocates a per-body assignment
projection only where an operation exists. The complete-file declaration-value
index is built once after projection. This follows the explicit global/variable
facts inspected in [Luau's builtin analysis](https://github.com/luau-lang/luau/blob/master/Compiler/src/Builtins.cpp),
not a previous-visitor witness. The compiler import distinction is established
from BMSX's own compiler rather than imported from another Lua dialect.

Validation: complete Lua suite 2,212 tests, 2,210 passed, the existing named-menu
failure and one skip; rompacker 129/129, toolchain types, product build and the
three precision idetests (8/5/3 assertions) pass. Independent composition review
passed 66 targeted tests and found no blocker. The dumped pietious O3 program
and debug metadata hash is identical to `8572d6d06`:
`dd405f9a1b6fb463b2f8b2fb8bdf9f81d0cb2c84d89a7f1e5d583bf0d19b51d5`.
Compiler timings were not isolated from all concurrent testing and are not used
as performance evidence for this slice.

The 300-reference-per-cart comparison has zero contradictory answers in both
carts. Its strict subset assertion is **not green**: nemesis retains the existing
`cartlib/aem.lua:160` extra target; pietious now includes two authored `test.phase`
writes in `pietious_spyglass_input_assert.lua:40/44` that the solver does not
return. Static definition lookup considers all global publications, whereas the
solver requires application evidence for effects. Do not make that solver
publish uncalled effects just to force the subset metric to zero.

Isolated edit profiler, 20 warmups/50 samples, body-edit public update with
highlighting p50/p95 before -> after: director 2.112/5.874 -> 2.211/5.845 ms;
player 12.364/14.194 -> 12.340/13.552 ms. Player incremental-syntax phase binding
p50 is 7.577 -> 7.921 ms, first member query 1.459 -> 1.526 ms. This ownership
slice makes no edit-speedup claim; actual body caching remains necessary.

### First body-reuse delivery (user priority clarification)

The user explicitly prioritizes a substantial measured slowdown reduction over
finishing every incremental refinement in one delivery (2026-09-20). Implement
and validate reuse of unchanged non-nested function-body contributions first;
each contribution includes its nested bodies without duplicating descendant
facts into additional caches. Compare actually consumed lexical names, including
misses, and retain immutable facts, never binder stacks. Conservative context
invalidation is acceptable for this first delivery. Finer nested-body reuse and
avoiding every harmless invalidation remain follow-up optimizations, not a
reason to defer the working edit-speedup. Correctness and retained snapshot
safety remain mandatory. Keep reviews focused and non-overlapping.

### First body-reuse implementation and validation

`body_facts.ts` owns finished pre-projection contributions and ordered file
composition. The binder constructs a non-nested function and its nested bodies
in an isolated temporary builder, finalizes public declarations/scopes, and
retains only immutable facts. A syntax-keyed WeakMap retains one current input
variant per function occurrence; it has no file-generation history chain and
retains no `Scope`, parent environment or `SemanticBuilder`. Nested bodies are
part of their enclosing cached unit, not additional copies of its descendants.

Admission compares actual external lexical lookups, including misses and
unknown loop reads, plus written destination, parent attachment and receiver
inputs. It happens before parameters, completion analysis and body traversal.
Retained function values also feed the parent's declaration assignment: no new
owned identity points at an old flow. File-scope attachment is composed directly
into the final declaration/parent streams, without per-body projected maps or
replaying binder state. Named non-file parent changes conservatively rebind.
Builtin operations still compose from raw sites against the current full file.

`FileSemanticData.bindingWork` exposes bound/reused function and visited syntax
counts. The checked-in edit profiler reports these separately from timed passes.
A local body edit in dumped pietious `player/player.lua` binds one function and
reuses 162: statement visits fall from 1,695 to 195 and expression visits from
6,241 to 210. Unchanged body-local facts retain object identity. Top-level facts
and the final flat file maps are still rebuilt, an explicit remaining floor.

The implementation follows body ownership and temporary traversal state from
[rust-analyzer expression scopes](https://github.com/rust-lang/rust-analyzer/blob/master/crates/hir-def/src/expr_store/scope.rs),
not TypeScript's in-place AST updates. One fresh-context implementation review
found no concrete blocker in captures, external writes, receiver inputs,
function identity, composition order or retained-snapshot ownership.

Validation of the committed delivery:
- Focused reuse, occurrence, edit-equivalence and editor-project tests: 61/61.
  These prove skipped sibling/nested-subtree visits, retained identity,
  lexical misses/shadows, unrelated insertions, root attachment, outer writes,
  loop captures, recursive const closures, builtin recomposition, distinct cold
  generations, coalesced model edits, inactive documents and undo/redo.
- `scripts/analysis/check_lua_binding_edits.ts` compares cold answers with body
  edits, leading edits, undo and retained snapshots in real dumped sources:
  pietious 264 files / 1,056 edits, nemesis_s 243 files / 972 edits, all equal.
  Counts are 8,511 and 7,422 reused functions respectively. Files without a
  nonempty function body are not counted as edit workloads.
- Complete Lua suite: 2,224 tests, 2,222 passed, the existing named-menu failure
  and one skip. Toolchain types, rompacker 129/129, product build and precision
  idetests 8/5/3 pass. The final attachment-composition code was rerun through
  the full suite, both edit corpora, product build and all three precision tests.
- Fresh O3 compilation preserves the program/debug hash above. Isolated current
  compile p50/p95: 3,032/3,267 ms; total parse/select/compile 3,237/3,496 ms.
  This is compilation evidence, not a GUI frame-latency measurement.

Measured delivery (same dumped workspace, Node, 20 warmups/50 samples, isolated
runs; before is `32cb85e48`):

| Local body edit | Before p50/p95 | Reuse p50/p95 |
| --- | ---: | ---: |
| director public update | 1.743 / 5.897 ms | 0.870 / 4.040 ms |
| director update + highlighting | 2.211 / 5.845 ms | 1.226 / 4.538 ms |
| player public update | 10.080 / 10.771 ms | 2.608 / 6.468 ms |
| player update + highlighting | 12.340 / 13.552 ms | 5.477 / 9.112 ms |
| player bind, incremental-syntax phase | 7.921 / 9.159 ms | 2.016 / 5.017 ms |
| player first member query | 1.526 / 5.281 ms | 1.402 / 4.292 ms |

Player public update improves about 3.9x at the median, **1.7x at p95**. Thus the
original requirement of 2x at both median and p95 is not claimed as met. The
user's first-delivery priority achieves a substantial real edit win without
claiming that every remaining tail or frame stall has been eliminated.

Tradeoff: fresh player binding in this phase profiler grows from 5.034/9.273 to
9.364/10.219 ms. The new cold path builds body-owned contributions as well as
flat file output. Do not hide this cost behind the incremental result. A separate
single cold full-workspace load was 477.8 -> 483.9 ms (not a distribution).
Forced-GC rooted workspace heap was 191.25 -> 201.62 MiB; after 80 player edits
with the initial and latest snapshots retained, 199.29 -> 206.24 MiB. Releasing
the workspace leaves 2.54 -> 2.60 MiB above the pre-load measurement. This sample
shows roughly 5.4% extra initially retained heap and no observed growing
old-generation chain; it is not proof of every possible editor lifetime.

This delivery is real incremental binding, but not arbitrary nested-scope
incrementality. Editing an outer function rebinds that entire subtree; changing
an external declaration's syntax identity may conservatively rebind dependents.
Those refinements and actual GUI frame profiling are deliberately not claimed
as complete.

## Lowest-priority follow-up: absent-value convention

User request, 2026-09-20: after the incremental parsing/binding work and its
validation, audit the apparently arbitrary mix of `undefined` and `null`
(e.g. an absent call argument versus an absent named table field). Choose one
explicit absent-value convention for these APIs, using C++-style optionality
and representation clarity as a design check. `undefined` is acceptable; no C++
port is requested. Change producer/consumer contracts coherently, not through
callsite normalization or fallback wrappers. This is deliberately last and is
not part of the current implementation slice.
