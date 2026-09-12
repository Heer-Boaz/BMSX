# Lua structural source-edit gates

These gates complement independent unit fixtures; they do not pin behaviour to
game-specific identifiers or line numbers. The corpus enumerates tracked Lua
under `cartlib`, `machine/bios` and `carts` without editing those files.

## Function-source production

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/semantic_function_sources.test.ts tests/lua/semantic_function_summary.test.ts \
  tests/lua/semantic_write_owners.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_function_sources.ts
```

These independent fixtures distinguish each function body and written return
from its destination binding. They cover real compiled BLua and public workspace
resolution, not cart-specific registration spellings. Full source provenance,
all-return-lane modeling and source-edit completeness are separate contracts.

The profiler uses the same pre-existing public owners on baseline and current
code: retained-parse binding, fresh identities/summaries, fresh workspace plus
first member query, and retained lookups. Run it without other tests. It does not
measure parsing, rendering, guest execution, Hot Resume or heap allocations.
Evidence and remaining boundaries: `docs/lua_function_source_ownership.md`.
The profiler now reports both explicit-parameter functions and implicit-receiver
methods; group results by `declarationStyle` as well as body count.

`semantic_write_owners.test.ts` separately verifies that the body containing a
write is not inferred from the destination's declaration scope. It tests
summary partitioning, module writes, public member resolution and actual
instantiation plus a compiled BLua oracle. It does not turn hypothetical
composition into execution evidence; see `docs/lua_write_ownership.md`.

`semantic_parameter_context.test.ts` verifies entry values versus writable
formal bindings, captured writes and nested indexed storage. Its fixtures do
not depend on games. `profile_parameter_context.ts` separately measures fresh
workspace queries through three forwarding bodies at 32/256 callsites and
retained lookups, for both read-only and written parameters, using the same
entrypoints on baseline/current bundles.
Run it with the same command as the other profilers, without concurrent tests.
Scope, primary references and remaining gaps: `docs/lua_parameter_context.md`.

Named field provenance additionally runs through the existing contextual-source
and call-context fixtures: factory instances, captured storage, equal RHS write
occurrences, imports, unresolved bases and later admitted writers. The shared
`profile_contextual_sources.ts --members` fixture traces both argument lanes
through nested factory fields; without the flag it retains the call/alias
comparison. It admits the requested field facts before capturing the retained
answers, and includes both passes in its cold measurement. A newly discovered
field can invalidate an earlier read of the same factory base. These source
answers are may-provenance, not authoring completeness certificates; see
`docs/lua_member_source_provenance.md`.

`semantic_receiver_binding.test.ts` extends the binding contract to implicit
parameters, including O0/O3 compiled execution and receiver-dependent forwarding
chains. `capture_retention.test.ts` exercises rebinding a real captured receiver
cell before and after Hot Resume. See `docs/lua_receiver_binding.md`.

## Structural transfer

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/lua_table_transfer.test.ts tests/lua/fsm_hot_resume.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/transfers.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_transfer.ts
```

`transfers.ts` transfers the first/middle/last field of every nonempty constructor
to both ends of the next distinct constructor outside that field. Constructors
inside the selected field cannot be destinations. The whole resulting AST must
match exactly the source/destination field-list change, ignoring only source
locations. Every transfer verifies its final source range and real PieceTree
Undo. This is syntax correctness, not destination binding analysis.

`lua_table_transfer.test.ts` exhausts gaps and both directions on independent
sources, including named/array fields, shared spellings, nested constructors,
comments, empty targets, CRLF/Unicode, grouping and literals. Actual compiled
BLua checks order and a deliberately changed lexical capture. The cartlib
oracle checks actual BT composition, not a simulated host evaluator.

`studio_table_transfer.ts` is included in both browser Studio workflows. It
applies the language operation to the normal Lua working copy, consumes its
result through ordinary source navigation, and exercises actual palette Undo
and keyboard Redo. It must neither stall the IDE nor change the paused machine.
It intentionally does **not** pretend that a graph reparent gesture exists.

`profile_transfer.ts` separates construction, prebuilt PieceTree apply/Undo and
the full transfer entrypoint/Undo. Run it without other tests. Timings include
explicit lossless lexing but not semantics, layout or rendering. The inserted
payload must remain three UTF-16 units even when the gap grows from 1,600 to
102,400 units. This is not a heap-allocation or complete-frame benchmark.

Existing `moves.ts` and `insertion.ts` retain their independent full-AST gates;
transfer does not change their punctuation, layout or marker contracts.

## Lexical relocation

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/lua_relocation.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/relocation.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_relocation.ts
```

`relocation.ts` transfers the middle field of each nonempty constructor to the
next legal target and **rebinds the resulting source**. Ordinary edit-mapped
origin markers determine whether its declarations/receivers/varargs are still
the same ones. Prospective changed-binding evidence must match that actual
rebind. This is separate from the whole-AST syntax oracle above and from the
independent compiled BLua tests of ordinary captures, implicit `self` and `...`.

The profiler separates binder production from dependency collection and retained
destination queries. `--binder-only` skips relocation queries for comparison
with a bundle using the previous binder owner. Use identical bundling/settings
and run without other tests. No result is a guest, renderer, Hot Resume or
complete-frame performance claim; see `docs/lua_relocation_bindings_design.md`.

## Recursive value propagation

`profile_recursive_inputs.ts` builds independent linked-object fixtures and
queries both final leaf members through one recursive body. At both 8 and 64
links it requires the two correct source declarations and two retained root
frames. It measures a fresh query store over retained file facts, not parsing
or guest execution. `profile_parameter_context.ts` remains the acyclic
forwarding comparison. Run these without concurrent builds/browser tests;
owner contracts and validation: `docs/lua_recursive_inputs.md`.

## Edit-associated selection

The independent `editor_edit_state.test.ts` and `behavior_source_bookmark.test.ts`
gates exercise before/after selection on the same document Undo record. The
actual Studio suites additionally run `studio_source_bookmarks.ts` against
physical source navigation, hidden Lens refresh and normal history commands.
`profile_bookmarks.ts` measures retained source-path capture/resolution and
typed-state history production separately from parsing/rendering. Contract,
primary references and commands: `docs/editor_edit_bookmarks_design.md`.
