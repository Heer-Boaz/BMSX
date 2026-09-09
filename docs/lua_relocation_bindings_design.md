# Lua relocation: lexical bindings before graph reconnect

`IDE-LUA-RELOCATION-BINDINGS-01` follows the lossless
[table transfer](lua_table_transfer_design.md). It answers one question for a
complete current-source expression/field: which external lexical bindings
would change at a destination? It neither applies text edits nor claims that
evaluation order, object identity, BT ownership or live closure migration is
preserved.

## References and live boundary

- [TypeScript extract-symbol analysis](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/refactors/extractSymbol.ts#L2020-L2142)
  visits actual identifier usages, excludes declarations contained in the
  selected source, deduplicates actual symbols and resolves each name in the
  destination. BMSX adopts that analysis boundary, not TypeScript's source
  substitutions or automatic parameter generation.
- [Lua lexical lookup](https://github.com/lua/lua/blob/v5.4.8/lparser.c#L390-L477)
  searches active locals and enclosing functions before globals;
  [method parameters](https://github.com/lua/lua/blob/v5.4.8/lparser.c#L990-L1006)
  make implicit `self` a function-owned parameter. Receiver class inference is
  not binding identity. Lua's vararg lookup is function-local, not an ordinary
  name captured from an enclosing variadic function. BMSX keeps its existing
  compiler/VM behaviour for `VARARG`; this slice adds no Lua-language restriction.

The live `SemanticScope.declarationIndices` previously included every
single-segment declaration, including table properties and global assignments.
That is not the binder's lexical binding list. Its producer now records lexical
membership explicitly. Existing declaration ids, references, global indexing
and member/value-flow facts remain separate representations.

Scopes expose their kind, distinguishing `method` from `function` directly from
method syntax instead of retaining a redundant receiver flag. A lexical query
searches actual visible declarations, then the scope-owned receiver, then enclosing scopes.
It never derives a receiver from a class value or parses a value-graph key.
The nearest function/path scope owns `...`, even inside nested blocks.

## Contract and costs

- The caller provides one complete current-source field/expression range and
  the actual destination position in the **same immutable semantic file**.
  No recovered syntax, stale parse, inferred visual index or cross-file move.
- `LuaRelocationAnalysis` retains that semantic snapshot and prunes syntax
  branches outside the selected range. The existing AST walker and syntax-reference
  map distinguish identifiers from declarations/member labels. Expression keys,
  callback bodies, identifier writes and explicit nested scopes participate.
- Declarations and receiver/vararg function scopes contained in the moved source
  travel with it. Other bindings are retained as exact declaration ids, receiver
  scope indices or global names. Deduplication uses actual binder declarations,
  scopes and global names, never value equality or a namesake declaration.
  One representative source occurrence is retained per external binding; this
  is not a read/write-effect summary of every occurrence.
- Destination queries return concrete changed-binding evidence with the original
  source occurrence. Empty evidence means **lexical bindings unchanged**, not
  semantically equivalent execution. A global may keep its name while its value
  changes over time; moving a factory call may intentionally change its order.
- No clone/reparse/apply/restore of the working copy, runtime-value query, guest
  hook or C++ state change. Collection belongs to an explicit source operation;
  subsequent candidate checks reuse its dependencies, not a second analysis tree.

Graph-parent correspondence, target list/role/shared-constructor admission,
selection through Undo and actual Save/Hot Resume of relocated callbacks remain
separate gates. No reconnect UI is enabled by this slice.

The subsequent [edit-bookmark slice](editor_edit_bookmarks_design.md) supplies
explicit parent-changing selection through document Undo/Redo. It does not
weaken or replace this lexical analysis, target-role admission or capture/Hot
Resume correspondence.

## Evidence

- Eleven independent tests cover lexical membership, equal-valued shadows,
  initializer visibility, local/global changes, nested closures, recursive
  locals, computed keys, writes, implicit/explicit `self` and function-local
  varargs. Compiled BLua executes original and transferred captures, receivers
  and vararg operands; no running-cart heap is used as a semantic oracle.
- The corpus gate performs **4,277 transfers in 312 tracked Lua files**. It
  compares **4,787 external bindings**, including **680 changed bindings**, with
  a full bind after the actual text edit. Origin positions travel through the
  ordinary text-change mapping; Undo restores the exact source. This checks
  prospective evidence against an actual rebind, not just the same query twice
  on the original source. The syntax transfer's whole-AST oracle stays separate.
- Full Lua suite: **1,152 passed, one skipped**. Toolchain and IDE typechecks
  pass. The tests project's 51 existing diagnostics are unchanged against the
  parent; that project is not claimed typecheck-clean.
- Existing Studio workflows and Pietious navigation pass on **software,
  WebGL2 and WebGPU**. The actual headless Nemesis Behavior Lens test passes
  all 59 assertions; browser-Studio and headless-tooling debug products build.
  These are regression gates for the changed binder, not reconnect UI or
  relocated-callback Hot Resume proof.
- Architecture-boundary, core-parity, indentation and diff checks pass. No
  machine/C++ or guest hot path is changed.

Reproduction commands live in
[`tests/conformance/lua_source/README.md`](../tests/conformance/lua_source/README.md).
The corpus selects current syntax rather than fixed game names or source lines;
the independent fixtures establish the language contract.

## Measured owner cost

The binder retains **one additional scope-kind property**, copied from its
existing private scope kind. There is no new per-reference or per-declaration
property, syntax array or per-frame analysis. Lexical membership is selected
while creating declarations, not rebuilt or filtered at each query.

Node 22.23.1, identical esbuild bundles, baseline binder from `f49c56042` versus
this binder, four isolated process pairs. Each process takes the median of 25
samples after 10 warmups. The table gives medians across those four processes:

| Unrelated functions | Source UTF-16 units / scopes | Baseline bind (ms) | Current bind (ms) | Collect dependencies (µs) | Retained destination check (µs) |
| --- | --- | --- | --- | --- | --- |
| 32 | 1,591 / 34 | 0.0659 | 0.0675 | 0.832 | 0.0245 |
| 1,024 | 50,111 / 1,026 | 2.445 | 2.495 | 17.338 | 0.0340 |

Binder samples batch ten binds of the same retained parse. Baseline/current
process-median ranges were 0.0598–0.0748 / 0.0589–0.0835 ms at 32 functions,
and 2.370–2.526 / 2.383–2.517 ms at 1,024. This is a small overlapping cost
comparison, not proof of a speedup or of zero regression on every source.

Collection batches 1,000 explicit analyses; destination samples batch 10,000
checks of the same retained single-dependency analysis. Collection visits
ancestor/sibling bounds and prunes unrelated function bodies; it is not claimed
constant-time in file size. Each analysis owns its dependency list/Set, and a
query returns its binding-change evidence. These warmed microbenchmarks are not
heap-allocation profiles or complete edit/render/Hot Resume/frame timings.
