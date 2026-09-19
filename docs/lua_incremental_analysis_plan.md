# Incremental Lua parsing and binding

Date: 2026-09-19. Branch: `fix/lua-bounded-call-contexts`.

## Scope and decision

Follow-up to [the definition-based language service](lua_language_service_design.md).
Annotations, additional inference, and changes to the whole-program solver are
out of scope. Optimize edits, not the meaning of interactive queries.

Implement in the ordered slices below. **Only slice 0 is implemented here.**
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
| `ide/editor/contrib/intellisense/semantic/workspace/project.ts` | Queues changed paths; events currently discard edit spans | Project must retain the delta between its analyzed revision and current model revision |
| `toolchain/ts/lua/analysis/cache.ts` | Process-wide, 24-entry, path/source parse cache | Not the lifetime owner for incremental syntax or a workspace's previous version |
| `syntax/lexer.ts`, `syntax/parser.ts`, `analysis/parse.ts` | Whole-file token array and strict/recovering parser | One grammar for initial and incremental parsing; no second IDE grammar |
| `syntax/ast/index.ts` | Absolute line/column ranges on nodes and blocks | Changed positions currently invalidate otherwise unchanged nodes |
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

### 1. Fix syntax representation and document ownership

- Define immutable syntax payloads with relative widths/spans in `syntax/`.
  Snapshot-owned occurrence locations provide absolute source positions.
  Distinct occurrences remain distinct even when their payloads are identical.
- Make the existing lexer/parser produce that representation directly. No
  full-tree conversion after each parse; no parallel executable AST or proxy
  that silently rewrites ranges on access.
- Keep source-position conversion in the syntax/source owner. Existing range
  consumers get snapshot-specific locations without mutating shared payloads.
- Retain prior syntax in the document/project lifetime, not the small global
  cache. Carry model revision and ordered edits to analysis; coalesce edits
  against the last *analyzed* revision, including undo/redo and multi-edit.
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
- Account for publication: `LuaProjectIndex` currently copies the entire symbol
  map, and snapshot construction scans file declarations for globals. Carry
  immutable file/scope contributions into the resolver rather than flattening
  the entire workspace after each edit. Preserve existing lookup precedence;
  do not replace the copies with an indefinitely growing chain of overlays.

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
