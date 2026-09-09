# Lua structural source-edit gates

These gates complement independent unit fixtures; they do not pin behaviour to
game-specific identifiers or line numbers. The corpus enumerates tracked Lua
under `cartlib`, `machine/bios` and `carts` without editing those files.

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

## Edit-associated selection

The independent `editor_edit_state.test.ts` and `behavior_source_bookmark.test.ts`
gates exercise before/after selection on the same document Undo record. The
actual Studio suites additionally run `studio_source_bookmarks.ts` against
physical source navigation, hidden Lens refresh and normal history commands.
`profile_bookmarks.ts` measures retained source-path capture/resolution and
typed-state history production separately from parsing/rendering. Contract,
primary references and commands: `docs/editor_edit_bookmarks_design.md`.
