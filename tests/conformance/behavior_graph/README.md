# Source-backed behavior graphs

The concrete BT and FSM Behavior Lens graphs consume the typed source projection.
Lua remains the document; graph cards, links, fold state and geometry are not
runtime or authored scene data. See
[the owner contract and pinned production references](../../../docs/behavior_graph_design.md).

## Independent contracts

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/behavior_source_graph.test.ts tests/lua/behavior_tree_graph_view.test.ts tests/lua/behavior_tree_membership.test.ts \
  tests/lua/behavior_tree_edit.test.ts tests/lua/lua_table_moves.test.ts \
  tests/lua/workbench_tree_layout.test.ts tests/lua/workbench_graph.test.ts \
  tests/lua/editor_focus.test.ts
```

The shared `tests/helpers/behavior_source_fixture.ts` is authored Lua, not a
fake parser, second graph schema or generated game ROM. Tests cover:

- independent registrations in one file and distinct uses of shared subtrees;
- ordered children, parallel roles, choice weights, attachments and blackboard;
- a weighted link's **choice use**, distinct from its shared initializer/child;
- partial membership and dynamic roots without fabricated ordered endpoints;
- local list evidence independent from descendant warnings: opaque builders do
  not hide known children/choices, wrapper weights or attachment slot counts;
- source-backed node/edge selection, hidden edits, removal, Undo and pan anchors;
- variable-width/height tidy layout, asymmetry and a 10,000-level iterative tree;
- shared retained geometry, clipping, pointer capture and focus/input lifecycle.

## Actual Studio, all three backends

Build the BIOS and the two debug carts through the normal product toolchain.
Playwright/Chromium is a host test tool. If installed outside this checkout, set
`BMSX_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs`.

```sh
mkdir -p /tmp/bmsx-bt-graph
node tests/conformance/runtime_replay/browser.mjs --studio-navigation nemesis_s \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bmsx-bt-graph/nemesis.png
node tests/conformance/runtime_replay/browser.mjs --studio-navigation pietious \
  dist/bmsx-bios.debug.rom dist/pietious.debug.rom /tmp/bmsx-bt-graph/pietious.png
node tests/conformance/runtime_replay/browser.mjs --studio \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/bmsx-bt-graph/studio.png
```

Each command runs software, WebGL2 and WebGPU independently. Accelerated tests
use Chromium/SwiftShader, not a software fallback. The current game-source
navigation cases are integration smoke; they do not define the graph contract.

`studio_behavior_source.ts` and `studio_behavior_graph.ts` install the same
independent Lua fixture into a **text model only**, open registrations through
the real Command Palette and exercise keyboard, controller and pointer routes.
They test held Space, modifier/focus scoping, spaces typed in the palette,
Children/Details/Source actions, weight/decorator field
navigation, physical edge selection, pane return, hidden edits and Undo. The
paused machine's position and installed media do not change. The original
source is restored before further product workflows; only the final screenshot
presentation leaves its fixture in the unsaved text model. It never installs a
fixture cartridge. Captures show the expanded weighted fixture at 384×288 with
the actual IDE tiny font, not a mock drawing or a screenshot of a game BT.

`studio_bt_membership.ts` installs `behavior_membership_fixture.ts` in the same
paused textmodel and tests known sibling slots around opaque builders, a nested
unknown list, weighted connection versus child/weight Source, held pointer,
keyboard/controller navigation, hidden UTF-16 edits, Undo and retained idle
geometry. The capture points are `STUDIO: BT partial children ready for visual
inspection` and `STUDIO: BT partial choices ready for visual inspection`.
The independent `behavior_tree_membership.test.ts` tests also retain original
list constructor/issues, alias identity, known mutation and numeric/computed
keys. `fsm_hot_resume.test.ts` runs that exact authored source on its existing
real BLua/cartlib CPU harness; the opaque builders execute there, not in the IDE.

The full Studio suite also checks the ordinary Scene Editor, FSM graph,
ActionEffect inspector, focus, source save, pause/rewind/Hot Resume, reboot and Scenario Lab.

`studio_bt_moves.ts` uses the independent `behavior_order_fixture.ts`: actual
Earlier/Later palette commands, held Source pointer, metadata versus child order, weighted
wrappers, shared initializers, expanded source selection, graph/code/palette
Undo/Redo, source navigation, readonly/current-generation admission and retained
warm geometry. Capture markers: `STUDIO: BT reordered children ready for visual
inspection` and `STUDIO: BT reordered choices ready for visual inspection`.
The [authoring contract](../../../docs/behavior_tree_authoring_design.md) keeps
this bounded action separate from a complete visual editor or a live-BT-rebind
end-to-end claim.

The Pietious navigation profile additionally runs `studio_source_recovery.ts`:
the first code view can follow a visual edit and its timed autosave. Source,
Enter, double-click and Details navigation must emit no content edits or dirty
state; the ordinary timer and closing/reopening the IDE remain active.
Independent collection/session tests live in `workspace_storage.test.ts`.
See [the recovery contract](../../../docs/studio_source_recovery_design.md)
for the reproduced failure and the separate unreproduced dirty-source report.
Expected negative guest-fault cases retain their existing fault gate. A passing
build alone is not evidence for these workflows or physical-device performance.

The existing headless cart integration remains runnable after rebuilding its
product (its game-specific golden assertions remain a separate test-fixture task):

```sh
npm run build:product:node-headless-tooling -- --debug
npm run ide:test -- nemesis_s tests/ide/behavior_lens.idetest.js
```

## Separate cost boundaries

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile.ts
```

The profile measures source recognition on already-built semantic data, source-
to-card projection, tidy placement plus routes, hit testing and warm overlay
emission plus quad-stream conversion **separately**. It uses 24 and 1,024 shared
subtree uses, fully expanded (74 and 3,074 cards), each with complete source and
with an opaque child. Both shapes retain all those cards; a descendant warning
must not collapse the enclosing membership. Cold phases have 10 warmups
and 25 median samples; warm phases have 1,000 operations per sample. Font
measurement count and quad-backing identity are checked after draw warmup.
This excludes parsing, GPU upload/raster and total Studio frame time; it is not
a JavaScript zero-allocation proof or a speed guarantee for another host.

## FSM source contracts

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/state_machine_source.test.ts tests/lua/fsm_hot_resume.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_fsm.ts
```

`tests/helpers/fsm_source_fixture.ts` contains authored Lua independent from the
carts. Its path matrix is checked both against the source binding and the real
compiled `cartlib/fsm/fsm.lua` on the existing BIOS/cart CPU harness. Expected
plans are explicit; neither implementation generates the other's expectations.
The matrix covers root/relative paths, cancelled descents, concurrent steps,
exact/_/# lookup and quoted/escaped names. Source tests also cover first-result
callback evidence, scoped aliases, guards, parent handlers, initial entries,
multiple registrations, duplicate keys, partial source and known mutation.

The same browser commands above now run `studio_fsm_source.ts`: a real paused
Studio text model, registration picker, held Source clicks, hidden edits to a
const callback target, activation, retained idle generations and ordinary Undo.
It does not compile/install fixture media, replace the machine or depend on a
particular game's FSM line numbers.

`studio_fsm_selection.ts` also opens the actual Details action and command
palette on a reused callback with identical returns. A held click on the second
return opens that return's source. Prefix/return insertion, ordinary Undo,
deletion with hidden Undo, and invalidating an open source picker exercise the
input-owned proof selection and shared Quick Input session lifetime. The
fixture is `FSM_PROOF_SOURCE`, not the live Nemesis/Pietious source schema.
These source contracts now run through the concrete FSM graph and its shared
source inspector; they do not depend on obsolete outline twisties or row hits.
Returning from Details/Source must highlight the chosen proof without a new
layout. A source-only field must not leave the old graph card highlighted.

The implemented callback subset is inline functions and file-local `<const>`
bindings. Returns in nested functions, root entry and exit handlers are not
transition-return evidence. `no-path` describes only the returned-path channel,
not absence of imperative effects. Member/cross-file callbacks, arbitrary calls
and dynamic targets do not acquire guessed endpoints. An absent explicit initial
state does not acquire host `pairs` ordering. See the pinned reference and scope
contract in `docs/behavior_graph_design.md` before extending this subset.

The FSM profile separates whole source generation on cached semantic data from
source structure and scope/return binding. The two fixtures have 73/3,073 scopes
and 72/3,072 transition slots. It uses the same warmup/median measurement owner
as the BT profile; parsing, drawing and total Studio frame time are excluded.
It now also measures the cold reference index, input refresh with source
correspondence, and mapping just the selected proof through an insert/delete
roundtrip (1,000 iterations per sample, reported per iteration). The reference
index is built at source-generation boundaries; picker labels are built on
opening. Neither phase belongs to the lens draw/hover/pan loop.

## Concrete FSM graph and native transport

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/state_graph_view.test.ts tests/lua/state_machine_selection.test.ts \
  tests/lua/graph_layout_node.test.ts tests/lua/graph_layout_lifetime.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_state_graph.ts
```

The input tests use a real Node worker thread and the same upstream ELK endpoint
as Browser Studio. They exercise nested/concurrent scopes, shared occurrences,
parallel returns, cycles, self-loops, parent handlers, partial/unknown source,
path-to-nil selection, Undo, font changes, coalescing and explicit failure/close.
One fixture produces actual half-pixel ELK labels: the compound publication
boundary must snap to one integer canvas grid for text, bounds and reveal.
Transport tests cover native disposal, missing worker assets and registration
failure with a queued late reply. No no-op disposal or in-process host fallback.

`studio_state_graph.ts` is part of both browser navigation runs and the full
Studio run above. It installs `FSM_DIAGRAM_SOURCE` into the paused text model,
uses the actual registration picker and packaged worker, and checks physical
edge double-click, Tab traversal, pan, hidden source refresh, detached pointer
capture and canonical Undo. It does not advance the machine or install media.
The capture point is `STUDIO: FSM diagram ready for visual inspection`; it shows
two identical returns as separate selectable arrows and a labelled self-loop.
The headless IDE test uses its product-bundled native Node worker, not the
in-process engine used by the domain-free geometry unit tests.

The concrete profile has 4/37/145 scopes and 5/49/193 edges. It reports the first
layout including thread startup, then the median of five layouts on that thread.
That boundary includes source-to-card measurement, clone/transport, ELK routing
and publication, not parsing. Warm update and overlay/quad emission use 1,000
operations per sample. The viewport stays 384×288 and reveals one inner scope:
draw costs include normal culling, not emission of every offscreen card. Retained
model/buffer identities and no further font measurements are checked. These
numbers exclude GPU rasterization, total Studio frame time and physical-device
performance; the script is not a JavaScript allocation profiler.

## ActionEffect source prerequisite

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/actioneffect_source.test.ts tests/lua/actioneffect_trace.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_actioneffect.ts
```

`actioneffect_source_fixture.ts` supplies independent canonical Lua to both the
source recognizer and the actual compiled cartlib oracle. Source tests retain
all twelve supported fields, AST values without host evaluation/defaults,
requirement table/list provenance, shared constructors and distinct registrations,
computed keys, last static fields, known mutation, incomplete source and Undo.
Unrecoverable registrations are not reconstructed beyond the parser's output.

The existing component/compiler harness executes `actioneffect_phase_fixture.ts`
with the real public registration, registry and component owners. It verifies
grant-time initial cooldown, trigger admission, immediate/deferred commitment,
handler event/payload nil-versus-false semantics, periodic gate bypass,
refcounted activity and rebind preserving runtime state. This does not run in
the editor or add runtime metadata for visualization. Ordinary trace erasure
and measured hot-path/retained-heap tests remain part of that same suite.

Both browser navigation runs and the full Studio suite include
`studio_actioneffect_source.ts`: multiple effects in one text model, exact held
Source gestures, hidden UTF-16 edits, activation refresh, ordinary Undo, and
explicit computed fields and requirement-entry source links. The capture point
is `STUDIO: ActionEffect partial source ready for visual inspection`. Idle frames
reuse the source generation/property rows and request no graph layout; machine
cycles and installed media remain unchanged. The property-view slice below now
uses these same fixtures; the earlier source prerequisite proved only the outline.

The cold profile measures 24/1,024 registrations sharing a twelve-field
constructor (408/17,408 source nodes). It separates source generation on cached
semantic data, construction of a single typed body, and input refresh including
source correspondence (single-body timing uses batches of 1,000). These are
distinct experiments, not additive frame costs;
they exclude parsing, drawing, runtime execution and total Studio frame time.


## ActionEffect property inspector

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/workbench_property_tree.test.ts tests/lua/actioneffect_properties.test.ts \
  tests/lua/workbench_tree.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_actioneffect_properties.ts
```

The generic control tests use actual tiny-font metrics, retained tree nodes and
real overlay/quad emission. They cover bounded label/value columns, whole hittable
rows, footer clipping, navigation/collapse results, resize, scroll, gesture
identity and unchanged-frame storage/measurement invariants. The domain tests
use independent Lua, not current cart line numbers: one chosen shared registration,
all authored fields and requirement occurrences, partial/empty/removed source,
exact source excerpts (including spaces and long-string case), separate category
and source folds, hidden UTF-16 edits, Undo and no graph-engine startup.

`studio_actioneffect_source.ts` additionally drives the real pane through held
Enter, group double-click, controller navigation/A, palette interruption, property
double-click and the shared Source action. A popup interrupts even an unfinished
double-click; an edited larger requirement list exercises physical wheel and
Home/End before normal Undo removes it. Hidden edits invalidate old hit rows;
reactivation retains the corresponding field and ordinary Undo restores it.
The complete capture point is
`STUDIO: ActionEffect complete properties ready for visual inspection`; the
partial-source point above remains. Both depict the same real 384x288 property
view, not a separate test renderer or a graph layout with invented edges.

The profile varies the chosen effect's requirements from 1 to 256 to 4,096,
keeping all twelve effect fields. It separates cold source-to-property projection
from cold column/text layout. Warm concrete-input updates, pointer hit testing and
real overlay/quad emission use batches of 1,000 (10 warmups/25 median samples).
Source analysis and Lua execution are outside that boundary. The font counter,
retained roots/rows/quad storage and never-created graph engine are assertions,
not a JavaScript heap profiler or a claim about GPU rasterization, total Studio
frame time or physical GPU performance. Run measurements without other tests.

## BT drag-to-reorder

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/pointer_capture.test.ts tests/lua/workbench_graph.test.ts \
  tests/lua/behavior_tree_edit.test.ts tests/lua/behavior_tree_drag.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_drag.ts
```

`studio_bt_drag.ts` runs in both the full Studio workflow and the Pietious
navigation workflow, on software/WebGL2/WebGPU. It edits independent Lua in the
ordinary working copy, not cart-specific line numbers or a generated graph ROM.
Physical press/move/release covers nonadjacent sibling insertion, weighted
connection payloads, source navigation and hidden Undo, Escape, palette, outside
drop, readonly/source-version cancellation, physical wheel and edge scrolling
through a twelve-child tree. No viewport-state write is used to reach the
initially offscreen destination. A press/drag never installs or resumes a cart.

Capture points are `STUDIO: BT drag preview ready for visual inspection` and
`STUDIO: BT offscreen sibling insertion ready for visual inspection`.
Inspect payload text, insertion marker, clipping and the tiny font at the
actual 384x288 viewport. The software host exposes its real presented framebuffer;
GPU backends are captured from their actual canvas, not reconstructed geometry.

`profile_drag.ts` uses 24/1,024 siblings and measures stationary hover, stationary
capture, changing-pointer hit/admission and actual preview/overlay/quad emission
separately. One thousand operations per sample means the reported batch
milliseconds are numerically microseconds per operation. Ten warmups, median of
25; run without other tests. Retained geometry, feedback, quad backing and one
session/no stationary hit are assertions. This is not allocation profiling,
GPU raster/upload timing, full-frame timing or target-hardware certification.

## BT source removal

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/behavior_tree_removal.test.ts tests/lua/lua_table_removal.test.ts \
  tests/lua/editor_focus.test.ts tests/lua/fsm_hot_resume.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_edit.ts
```

`studio_bt_remove.ts` shares the independent authored order fixture with the
source and real BLua/cartlib tests. The actual palette, tiny-font Remove action
and focus-scoped Delete remove a single source-list entry, including a weighted
wrapper selected through its connection. Source navigation, code Delete, hidden
Undo/Redo, readonly/generation admission and a captured drag interrupted by a
source deletion use the normal workbench routes. The removed occurrence loses
selection; no successor or restored namesake inherits it. Runtime media and
the paused machine remain unchanged. Capture markers are `STUDIO: BT removal
action ready for visual inspection` and `STUDIO: BT removed child ready for
visual inspection`.

`profile_edit.ts` separates retained membership admission, syntax-edit construction,
PieceTree apply/Undo and the concrete source-removal entrypoint plus Undo at
24/1,024 siblings. Each timing uses batches of 1,000, ten warmups and the median
of 25. The last timing includes source snapshot/cache access after each Undo,
but no semantic refresh or graph rebuild. It is not a full edit-to-visible-frame,
heap-allocation, GPU or Hot Resume benchmark. Run measurements without other tests.

## BT source duplication

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/behavior_tree_duplicate.test.ts tests/lua/lua_table_insertion.test.ts \
  tests/lua/behavior_tree_removal.test.ts tests/lua/editor_focus.test.ts \
  tests/lua/fsm_hot_resume.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/behavior_graph/profile_edit.ts
```

The independent fixture covers first/middle/last/sole copies, metadata, alias
versus inline/builder syntax, complete weighted wrappers, CRLF/grouping/interior
trivia, shared constructors and selection/folds through repeated and hidden
Undo/Redo. The compiled BLua/cartlib oracle proves execution order and shared
alias versus distinct constructor identity; it is not a live BT rebind test.
Common removal-admission tests also cover roots, parallel roles, attachments,
unknown/keyed/mutated lists and recovery; duplicate consumes the same evidence.

`studio_bt_duplicate.ts` runs in both actual Studio workflows and the navigation
gate. It exercises held action-bar/shortcut input, palette origin, source links,
code focus, hidden history, readonly/current-generation admission and duplication
during an actually admitted drag. The paused machine/media must not change.
Capture markers are `STUDIO: BT duplicate action ready for visual inspection`
and `STUDIO: BT duplicated child ready for visual inspection`.

The additional `profile_edit.ts` results measure duplicate construction and the
entrypoint+Undo in batches of 100, and preconstructed PieceTree apply+Undo in
batches of 1,000, converted to microseconds per operation. All use ten warmups
and the median of 25 samples. The existing insertion owner's lexing is included;
semantic reprojection, graph layout/render, autosave and Hot Resume are not.
