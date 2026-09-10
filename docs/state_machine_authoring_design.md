# Source-backed FSM authoring

The FSM diagram becomes an editor of the existing Lua working copy, not a
second executable graph. This design starts with `STUDIO-FSM-INITIAL-01`.
State construction/removal, transition creation and endpoint dragging remain
separate, unfinished operations; this slice does not claim a complete editor.

## Production references and live owners

- [Stately's source-backed set-initial operation](https://github.com/statelyai/xstate-tools/blob/fc7a85d780cd8ea4ea21fb423f2477e01e2f1dc3/packages/machine-extractor/src/MachineExtractResult.ts#L1196-L1214)
  edits the declaring parent configuration, not the selected child's runtime
  state. Its typed edits distinguish initial, state, transition and reanchor
  operations. We do not copy its JavaScript AST printer or XState paths.
- [Godot reconnect](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/animation/animation_state_machine_editor.cpp#L131-L174)
  changes the owned transition, preserves its properties and records one Undo
  action. A line's geometry is not the authored transition. BMSX's outcomes can
  share callbacks and have multiple identical returns: endpoint pairs are not
  source identity.
- [TypeScript string emission](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/utilities.ts#L6087-L6141)
  owns quoting/escaping centrally and distinguishes delimiter style. BMSX must
  emit **Lua** escapes supported by its lexer, not JSON or JavaScript escapes.
- `cartlib/fsm/fsm.lua` owns initial selection, compound entry, concurrency and
  definition rebind. `initial` is an exact child key, not a transition path:
  slash, dot, quotes and `_`/`#` prefixes in the key are not normalized.

## First complete operation: Set Initial

Select an actual state card and invoke **Set Initial** through the shared
action bar or Command Palette. No gameplay shortcut, bespoke menu, text-dialog
substitute for graph interaction, or immediate guest mutation.

The source index produces eligible targets once per document generation:

- The selected occurrence has a known direct parent state map. Root cards,
  connections and opaque state values do not pretend to be child membership.
- Parent topology and state-map membership must be proven from local source
  evidence. Opaque callbacks and unrelated descendants do not revoke that proof.
- A duplicate Lua key is owned by its last field. An overwritten source
  occurrence must not set initial as if it were the runtime-selected child.
- An absent `initial` is inserted explicitly. An authored scalar atom (string,
  number, boolean or `nil`) may be replaced, including invalid scalar keys;
  arbitrary expressions and aliases stay source code. No shared constant is
  silently rewritten, no callback is evaluated.
- The already-explicit initial is a no-op. An implicit runtime default does not
  count as authored intent; choosing it writes the explicit field.
- Shared parent constructors stay shared. Editing a constructor changes its
  source uses, not a private copy under the selected registration.
- Concurrency is independent. This operation never changes `is_concurrent` or
  invents guest rules prohibiting representable combinations.

The contribution consumes the proven target. Lua syntax tooling owns string
quoting; the editor's source-edit owner replaces only the literal token, keeping
parentheses, comments and other bytes. Missing fields use the existing lossless
table insertion owner. Each operation is one `EditorTextModel` Undo element.

The current source/read-only gate and concrete graph focus own command
admission. Worker results do not mutate source: edits immediately revoke old
geometry, then the current generation is laid out normally. Selected state
syntax is not replaced, so existing source correspondence owns selection through
edits, hidden views and Undo/Redo. No second history or graph-id matching.

## Hot Resume means definition installation, not forced entry

Save/Hot Resume uses the existing compiler, installed-media and `<init>` route.
Changing `initial` must preserve the living FSM and its current state during
rebind. The new default applies when that scope is normally reset/entered or a
new instance is created. No host reset, runtime-table patch or private restart
is smuggled into the edit command.

This requires the cart's initializer to publish the newly constructed blueprint.
A module-local table retained in the heap is not re-evaluated merely because its
constructor source changed. Such source still edits normally and is consumed on
its next construction; the editor does not secretly patch the retained table.

## Subsequent architecture gates

1. **Transition retargeting:** distinguish direct paths from callback returns,
   resolve real origins and shared consumers, own path construction in cartlib
   tooling, retain guards/triggers and the exact return occurrence. An initial
   edge is not a generic transition and concurrency is not a replaceable edge.
2. **State construction/removal:** actual parent maps, names and Lua field
   syntax; account for references, active-instance rebind and closure lifetime
   before exposing removal. No automatic arbitrary-Lua rewrite or JSON graph.
3. **Physical endpoint dragging:** use shared pointer capture/graph feedback,
   with cancellation on source generation, focus and input lifetime changes.
   Expose only operations whose source, history and live installation gates
   have been demonstrated.

Each stage must remain useful and independently verifiable. Runtime observation
is not a substitute for authoring, and a source test is not a live-install proof.

## Evidence — 10 September 2026

- Independent Lua fixtures cover nested/shared parents across registrations,
  missing/scalar initial fields, duplicate keys, local membership uncertainty,
  arbitrary expressions, concurrent scopes, comments and exact child keys.
  String emission round-trips all byte values through the actual lexer, with
  quotes, trailing digits and Unicode. One atomic edit preserves exterior bytes
  and uses ordinary Undo/Redo; it does not serialize the parent table.
- Actual graph/ELK tests check initial arrows, retained command targets,
  immediate source-generation invalidation and selection through hidden history.
  Physical Studio tests exercise a held toolbar click, Command Palette, Source,
  code/graph focus, read-only resources and recovered syntax. They run in both
  the full Studio and Pietious navigation suites on **software/WebGL2/WebGPU**.
- A separate real-browser workflow saves and reboots an independent ordinary
  Lua entry, then edits its state card. **Three actual Save/Hot Resume installs**
  (edit, Undo, Redo) retain the living FSM/current state/data objects while its
  definition changes. An explicit Reboot creates a new FSM in the new initial
  state. All three backends pass; their 384×288 tiny-font captures were inspected.
  This is not a synthetic extension ROM, host table mutation or a game's current
  FSM source used as a golden fixture. Accelerated runs use Chromium/SwiftShader,
  not physical GPU performance evidence.
- Lua suite: **1,188 passed, one skipped, zero failed**. IDE typecheck, browser
  and headless product builds, headless Behavior Lens (**59 assertions**), strict
  architecture boundaries, core parity and indentation pass. The tests-project
  typecheck still has **51 pre-existing diagnostics**; file/code/message counts
  are unchanged against `4f8f54f9d`. It is not a clean tests-project typecheck.

### Cost boundaries, not a zero-regression claim

Measured on Node 22.23.1, four isolated processes per case, ten warmups and the
median of 25 samples in each process. Values below are medians of those four
process medians. Parsing, graph layout, focus dispatch, GPU work, Hot Resume,
complete frame time and heap/GC measurement are excluded.

An identical bundled index harness compares the retained source document with
`state_machine_index.ts` from `4f8f54f9d` against this implementation. The cold
index costs **1.10 → 2.03 µs** for 32 states and **31.71 → 61.38 µs** for 1,024.
The added map and target objects have a real O(children) cost once per source
generation; this is not a claim that indexing got faster. They remove repeated
parent traversal and source classification from command enablement.

The separately runnable `profile_initial.ts` measures the new index, retained
map access and explicit source edit plus Undo through the text-model owner:

| Children / field | Index µs | Retained map lookup µs | Edit + Undo µs |
| --- | ---: | ---: | ---: |
| 32 / existing | 2.60 | 0.00196 | 1.99 |
| 32 / absent | 2.32 | 0.00193 | 9.25 |
| 1,024 / existing | 72.06 | 0.00194 | 1.17 |
| 1,024 / absent | 74.03 | 0.00198 | 188.44 |

The absent-field operation invokes the existing lossless insertion lexer only
on the explicit edit, not during draw/input queries. These microbenchmarks are
not complete command latency or a JavaScript allocation proof. Reproduction
commands are in [the conformance README](../tests/conformance/behavior_graph/README.md).
Local logs, index comparison harness and real-backend captures are under
`/tmp/bmsx-fsm-authoring/`; no generated images or machine-specific golden data
are required by the tests.
