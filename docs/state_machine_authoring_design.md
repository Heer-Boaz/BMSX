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

## Retargeting: source contract before the gesture

`STUDIO-FSM-RETARGET-EVIDENCE-01` implements the next source boundary, not a
drag control or an enabled editor command. The existing selection history and
shared node-drag preview cannot be relabelled as transition-endpoint editing.

Stately's [reanchor operation](https://github.com/statelyai/xstate-tools/blob/fc7a85d780cd8ea4ea21fb423f2477e01e2f1dc3/packages/machine-extractor/src/MachineExtractResult.ts#L1308-L1382)
retains the actual transition and distinguishes source/target changes from its
external-transition semantics. Its [target descriptor owner](https://github.com/statelyai/xstate-tools/blob/fc7a85d780cd8ea4ea21fb423f2477e01e2f1dc3/packages/machine-extractor/src/MachineExtractResult.ts#L2487-L2566)
consumes concrete state addresses, not graph labels. BMSX follows those ownership
decisions but must use `fsm.lua`'s actual path-plan semantics:

- Retain the scope objects already produced by source binding. Their child keys
  and parent links identify occurrences; shared constructors are not one scope.
- Keep the resolved source value/proof separate from path binding. A locally
  known return remains known when a consumer has incomplete state membership;
  incomplete binding must not erase that shared source use.
- Retarget only a literal at the selected field/first return. A constant alias
  is not permission to rewrite its initializer; other return expressions and
  arbitrary Lua remain source edits.
- Preserve the old absolute/relative anchor. For a relative path, never reduce
  its existing upward count; widen that anchor only when the chosen target lies
  outside it. Ancestor traversal is not state entry. A zero-step relative plan
  without upward movement is unrepresentable, not an invented self-transition.
- Emit exact child keys through cartlib tooling. `_`/`#` aliases are not needed
  when the real key is known. Quote path delimiters separately from Lua string
  quoting. `''`, `'.'` and `'..'` are not addressable child keys in this grammar,
  even when quoted; do not silently reinterpret them. The full `no_op` sentinel
  must not replace a real child named `no_op`.
- The path owner produces both its text and parsed segments. Binding consumes
  those segments directly; a proposed descriptor is not encoded and reparsed
  once per consumer. Source relation binding parses a repeated text once per
  registration while retaining distinct return/slot identities.
- One analysis gathers recognized uses of the same resolved literal across
  registrations. Each candidate binds the proposed text in every such consumer
  and exposes their resulting plans. A previously unresolved or newly dangling
  recognized consumer prevents automatic retargeting. This is not a claim to
  enumerate arbitrary runtime calls or escaped Lua tables.
- Retain only the current candidate result for one source-operation lifetime.
  Repeated queries allocate/parse/scan nothing; changing target releases the
  previous evidence. Do not grow a candidates-by-consumers plan cache.

The [proof-history slice below](#retarget-edit-and-proof-history) now preserves
the exact selected transition through literal replacement and document Undo/Redo.
The [shared connection-control slice](graph_connection_interaction_design.md)
now supplies explicit endpoint press identity and retained preview geometry;
it is not a fake dragged node or an FSM-specific pointer loop. Concrete FSM
admission, shared-consumer acceptance and installation are connected in
[`state_machine_connection_edit_design.md`](state_machine_connection_edit_design.md).

### Owning representations

| Owner | Representation | Consumers |
| --- | --- | --- |
| `toolchain/ts/cartlib/fsm/state_path.ts` | Original/generated text plus decoded path segments; syntax failure remains explicit | Source binding, retarget analysis, compiled-runtime oracle |
| `state_machine_relations.ts` | Actual origin scope and resolved authored value alongside each direct/return proof, independently of target uncertainty | Graph projection, Details/Source, shared-use analysis |
| `state_machine_scope.ts` | Occurrence parent/name/depth and real child membership; bound up/step/concurrency plan | Relations and candidate binding; no graph-label lookup or synthetic AST literal |
| `state_machine_retarget.ts` | Selected literal, recognized source uses and one retained candidate result | Independent source-edit/runtime tests; gesture admission follows separately |

These are host tooling/source representations. Cartlib, compiler/runtime ABI,
TS/C++ machine state and the frame execution path are unchanged. The graph
consumes `transition.origin.rowKey`; the editor does not rejoin that key to a
second reconstructed scope tree or serialize scope objects into worker requests.

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

## Retarget evidence and costs — 10 September 2026

- Eight independent source tests cover anchors, exact keys, no-op/unrepresentable
  candidates, shared returns and direct/wrapped fields, aliases, syntax recovery,
  incomplete/dangling consumers, exact edit/Undo, and bounded current-candidate
  retention. These fixtures do not depend on a game's current definitions.
- The real BLua/cartlib oracle checks **16 explicit expected path plans** against
  the generated descriptors, including concurrent steps and the `no_op` child.
  Another compiled-runtime test installs the edited callback by ordinary library
  re-registration: the living FSM/data retain identity, a blocked guard prevents
  exit/entry, and subsequent accepted dispatch uses the new target with the same
  callback effects and exit/entry counts. A zero-step upward plan does not re-enter
  a state. This is a rebind/dispatch oracle, not a new host Hot Resume workflow.
- The ordinary Pietious navigation and full Studio suites pass on software,
  WebGL2 and WebGPU, including Source/Details, hidden history, Set Initial,
  pause/rewind, existing Hot Resume/reboot and Scenario Lab gates. Accelerated
  tests use Chromium/SwiftShader. Headless Behavior Lens passes **59 assertions**.
- Lua: **1,198 passed, one skipped, zero failed**. IDE typecheck, browser/headless
  product builds, strict architecture boundaries, core parity and indentation
  pass. Tests-project diagnostics remain **51**, with unchanged file/code/message
  counts against `f5a5596ea`; this is not a clean tests-project typecheck.

On Node 22.23.1, four isolated processes per case use ten warmups and the median
of 25 samples. The numbers below are medians of those four process medians.
An identical bundled retained-source projection probe compares `f5a5596ea` with
this source-owner change: **0.0650 → 0.0736 ms** for 32 registrations and
**3.5125 → 3.4591 ms** for 1,024. The small case has a measured cold cost increase;
the large case is not evidence of a general speedup or a no-regression guarantee.

The separate `tsx` conformance profiler measures one shared callback across
those registrations, without parsing the document or invoking an editor command:

| Registrations / recognized uses | Analysis + first candidate µs | Repeated current candidate µs | Source projection ms |
| --- | ---: | ---: | ---: |
| 32 | 1.89 | 0.00150 | 0.205 |
| 1,024 | 79.54 | 0.00145 | 6.895 |

Scope objects/child maps now remain with the source generation (96/3,072 scopes
in this fixture); this retention is intentional and not a zero-memory claim.
Candidate evidence retains O(shared uses × path depth) plans for **one target**,
not every visited target. Parser, layout, pointer routing, GPU, guest execution,
Hot Resume, total frame time and heap/GC profiling are outside these measurements.
Commands are in the [conformance README](../tests/conformance/behavior_graph/README.md);
local comparison harnesses, logs and real-backend captures are under
`/tmp/bmsx-fsm-retarget/`.

## Retarget edit and proof history

`STUDIO-FSM-RETARGET-HISTORY-01` connects admitted retarget evidence to the
ordinary document edit/history owner. This is the source operation beneath a
future gesture, **not** an enabled retarget command or endpoint-drag UI.

The production references remain explicit:
[Godot reconnect selection](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/animation/animation_state_machine_editor.cpp#L139-L163)
records transition selection on both sides of one Undo action;
[VS Code edit history](https://github.com/microsoft/vscode/blob/585a254fad3a58b3d454622a9a1cf61358e5fc58/src/vs/editor/common/model/editStack.ts#L395-L407)
retains computed selection with the actual text edit;
[ProseMirror bookmarks](https://github.com/ProseMirror/prosemirror-state/blob/ffad5d9450a0b93438be53a801deee1a223a81bf/src/selection.ts#L173-L183)
separate selection coordinates from the document being resolved. BMSX does not
copy endpoint-pair identity or nearest-selection recovery.

| Owner | Representation and lifetime |
| --- | --- |
| `state_machine_selection.ts` | The same slot/entry and binding/function/return-start proof anchors serve ordinary correspondence and history restoration. A live selection also references current AST evidence; a bookmark does not. |
| `source_bookmark.ts` | Extends the existing node/BT-edge bookmark union with FSM outcomes/entries. Captures an actual registration-to-consumer occurrence path and deep-copies only selected proof coordinates. No names, ordinals or graph ids. |
| `state_machine_edit.ts` | Consumes a selected current-source outcome and an available retarget analysis result. One centrally quoted literal replacement, with explicit before/after edit state. No repeated admission scan, callback rewrite, guest mutation or source installation. |
| Text model | Unchanged. The same edit record publishes after-state on edit/Redo and before-state on Undo, independently of the invoking pane. |
| Hidden Lens / projection | Maps one pending copy; performs no hidden parse/layout. The next source projection resolves the original occurrence path, then the exact proof, against current syntax. History values remain immutable. |

For a direct transition, the edit replaces the complete binding literal. Normal
tracking correctly collapses it; this explicit operation records the new token
range instead. For a callback return, the binding, containing function and
return-start anchors follow the edit. Two identical return strings remain two
proofs, and a shared callback remains shared across its actual consumers.
External comments, parentheses, quote style and additional return values are
untouched. Whole replacement by equal bytes is still deletion for ordinary
source correspondence; Undo does not invent an explicit selection for it.

The browser fixture supplies the chosen target directly to this source operation.
It uses real physical graph traversal, Source, code Undo, graph palette Redo and
worker publication to test the integration. That is intentionally not a fake
reconnect command. Shared connection-preview and pointer cancellation now have
their own domain-free control proof. Current-source/read-only FSM admission,
shared-consumer presentation/acceptance and a complete retarget Save/Hot Resume
workflow still belong to the endpoint-authoring gate.

### History validation and measured costs — 10 September 2026

- Seven independent source/history cases plus the real-worker retarget case:
  **33 focused tests pass**, including the existing BT bookmark and FSM selection
  regressions. The full Lua suite reports **1,206 passed, one skipped, zero
  failed**. No new fixture depends on a game's current definition or line number.
- Both full Studio and Pietious navigation pass on **software, WebGL2 and
  WebGPU**, including the new direct/return retarget-history workflow. Accelerated
  tests use Chromium/SwiftShader, not a physical-GPU performance oracle. The
  full suite retains its deliberate syntax/init-fault recovery gates; source
  lookup HTTP 404 messages are present, not uncaught page failures.
- Browser Studio and node-headless-tooling builds, IDE typecheck and the real
  headless Behavior Lens (**59 assertions**) pass. Strict architecture boundaries
  report zero issues; core-parity, indentation and diff checks pass. Tests-project
  typechecking retains **51 existing diagnostics**, with identical file/code/
  message counts against `1544f35f3`; it is not a clean tests-project typecheck.

Node 22.23.1, four isolated processes after builds/browser tests completed;
each samples 1,000 operations, ten warmups and the median of 25 batches. Values
below are medians of the four process medians, in **µs per operation**:

| Shared sibling branches / proof | Capture | Copy + map prefix insertion/removal | Resolve occurrence path + proof |
| --- | ---: | ---: | ---: |
| 32 / direct | 0.164 | 0.197 | 0.355 |
| 32 / return | 0.164 | 0.181 | 0.436 |
| 1,024 / direct | 0.189 | 0.166 | 13.064 |
| 1,024 / return | 0.169 | 0.172 | 13.027 |

Capture/copy retain only the selected path (seven/six steps here) and its proof
coordinates. Resolution still scans sibling occurrences and is not constant-time
in the number of siblings. After that correspondence, proof matching consumes
the **existing per-consumer reference index** instead of scanning every transition
in the registration. An identical bundled matcher probe, alternating baseline/
current order against `1544f35f3`, measures that match alone at **0.261 → 0.086 µs**
for 32 branches and **6.392 → 0.063 µs** for 1,024. Ordinary selected-proof mapping
measures **0.033 → 0.038 µs** and **0.033 → 0.032 µs**, respectively; this is not
a universal speedup claim.

These warmed probes exclude parsing, source-index construction, model events,
layout, pointer dispatch, rendering, guest execution, Hot Resume, complete edit/
frame cost and heap/GC profiling. Stable browser/Node frames retain the source
and geometry without replaying history. Reproduction commands are in the
[conformance README](../tests/conformance/behavior_graph/README.md); baseline
bundles, raw measurements, logs and captures are in `/tmp/bmsx-fsm-bookmarks/`.
