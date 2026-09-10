# Edit-associated source selection

`IDE-EDIT-SELECTION-BOOKMARKS-01` supplies selection before/after an explicit
source edit, including a parent change. It does **not** expose reconnect UI or
authorize moving a BT between arbitrary list roles or lexical bindings.

## Production references and ownership

- [VS Code edit stack](https://github.com/microsoft/vscode/blob/585a254fad3a58b3d454622a9a1cf61358e5fc58/src/vs/editor/common/model/editStack.ts#L395-L407)
  retains before/after cursor state with the actual text history element. Its
  [text drag command](https://github.com/microsoft/vscode/blob/585a254fad3a58b3d454622a9a1cf61358e5fc58/src/vs/editor/contrib/dnd/browser/dragAndDropCommand.ts#L23-L96)
  computes a destination selection rather than making deleted markers survive.
  Its [cursor owner](https://github.com/microsoft/vscode/blob/585a254fad3a58b3d454622a9a1cf61358e5fc58/src/vs/editor/common/cursor/cursor.ts#L205-L247)
  consumes resulting selections from the model event, not an Undo caller's
  private return path. BMSX also restores its one retained code input per
  resource while hidden; it has no multi-group code-view focus arbitration.
- [CodeMirror typed effects](https://github.com/codemirror/state/blob/9c801279cb83011e6f92af778f4443406e8f1200/src/transaction.ts#L43-L85)
  associate values with their producing type. BMSX uses that small typed-value
  boundary, not a new extension registry, arbitrary event bus or effect pipeline.
  The type-erasure cast is confined to the generic key comparison; consumers
  narrow by their own key, without inspecting/casting payload shapes.
- [ProseMirror selection bookmarks](https://github.com/ProseMirror/prosemirror-state/blob/ffad5d9450a0b93438be53a801deee1a223a81bf/src/selection.ts#L173-L183)
  retain document-independent selection coordinates for later resolution.
  BMSX does not copy nearest-selection recovery: deleted source clears selection.

The live text model previously imported `CodeEditorViewSnapshot` as its only
history-state representation. That prevented another source editor from
supplying an explicit edit result without another history or a callback into a
retained pane. `EditorEditState` replaces that dependency. The code editor owns
its snapshot type; the Behavior Lens owns source-occurrence bookmarks. The
model owns neither implementation and never interprets their payloads.

## Contract

| Owner | Representation and lifetime |
| --- | --- |
| Text model/history | The existing single `EditorUndoRecord` retains before/after typed state values alongside PieceTree operations. No second stack, graph ids, AST snapshots, editor references or restore callbacks. Clearing/branching/trimming history releases them with that record. |
| Explicit command | Supplies before-state and optionally computes after-state once, after the actual sorted edit batch. The callback receives the real application-order text changes. It computes state, not another edit; the history retains only its result. An empty edit list does not invoke it or create selection-only history. |
| Content event | Publishes the final text version, changes and associated result state together. Undo publishes the original state; Redo publishes the result. Ordinary edits/revert/restore have no invented selection. Coalescing requires the same edit-state type as well as the existing key/time boundary. |
| Retained code input | Owns its model-event subscription independently of the active widget. Applies its code-owned snapshot, including when Undo comes from another pane; subscription replacement/clear releases the old binding. Cursor anchors reuse the existing view-owned scratch storage, not a history object's coordinates. Widget activation/history reveal handles geometry separately. |
| Behavior bookmark | A path from the actual registration occurrence to the selected source occurrence, recording UTF-16 spans and node/behavior kinds, plus node versus connection selection. No definition names, visual indices, persistent row keys or shared initializer ids. |
| Hidden Lens | Accepts a copy of an explicit bookmark as one pending selection. Subsequent edits map that copy, never the history value. It does not parse, lay out, install source or execute Lua while hidden. A later history event replaces that pending selection with its own result. |
| New source projection | First builds the ordinary strict parent-correspondence/range index. Then resolves the explicit bookmark under each actual source parent, reusing that index. It selects the recorded definition/occurrence and opens only the ancestors needed to reveal it. |

Ordinary marker mapping still collapses a fully replaced/deleted source span.
Unannotated moves do not select the first equal-looking use after reparse or
Undo. A replaced pending path becomes unresolvable, rather than being repaired
by label, nearest range or a global search. A matching span under a different
parent or registration is a different occurrence.

Bookmarks are selection, not complete view snapshots. Pan, unrelated folds and
descendant fold preferences are not copied into history. Existing source
correspondence preserves surviving folds; new occurrences use the normal fold
policy. A reconnect gesture's subtree-fold policy belongs to its still-unbuilt
command contract, not to a universal history snapshot.

## Boundaries and remaining gates

- The new API carries explicit edit intent; it does not infer relocation from
  two equal source texts or weaken the compiler's capture correspondence.
- The fixture deliberately supplies the actual moving field, source path and
  chosen target occurrence. The ordinary transfer primitive produces the text
  edits and final range. This tests the live document/Lens route, **not** a mock
  reconnect command or a claim that mouse reconnect already exists.
- Source-list role/weight/shared-constructor/cycle admission and a live Save &
  Hot Resume proof for transferred callbacks remain required before reconnect.
- No machine, C++, cartlib, guest heap, installed-media or autosave format change.
  The history state is session-owned data, not persisted workspace metadata.

The subsequent [transfer-admission owner](behavior_tree_transfer_admission_design.md)
supplies source-list role/sharing, subtree and binding queries. It does not
turn these bookmarks into reconnect UI or remove the live-installation gate.

## Validation

`editor_edit_state.test.ts` covers publication after the actual edit, one-time
result computation, coalescing, type-owned grouping, no-ops, branch truncation
and revert. `behavior_source_bookmark.test.ts` uses independent authored Lua:
ordinary and weighted node/edge selection, duplicate registrations, repeated
destination uses, equal existing children, selected descendants outside the
transferred bytes, intentional registration changes, hidden edits, immutable
history values and deletion without recovery.

`studio_source_bookmarks.ts` uses the actual shared working copy and controller,
physical navigation and held Source clicks, graph/code focus, palette Redo and
code Undo while the Lens is hidden. It verifies exact source coordinates,
responsiveness and unchanged machine cycles/installed media. Both full Studio
and Pietious navigation workflows include it; no game definition or line number
is part of the new fixture contract.

The reverse direction is exercised too: physical code typing, then Undo/Redo
from graph focus, must update the hidden code input before the code widget is
reattached. No Undo/Redo caller applies stored cursor state a second time.
Two independent model-owner regressions also cover retained input replacement,
subscription disposal, foreign state types and non-aliased cursor anchors.

Reproduce the independent gates and profiling with:

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/editor_edit_state.test.ts tests/lua/behavior_source_bookmark.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_bookmarks.ts
```

Completed gates for this slice:

| Gate | Result |
| --- | --- |
| Focused history/bookmark/model-owner tests | 23 pass, including 12 new independent cases; no cart-source line contracts. |
| Full `npm run test:lua` | 1,164 pass, one skip, no failures. |
| IDE TypeScript | Pass. The tests-project comparison retains its 51 baseline diagnostics with no additions; this is not a clean tests-project typecheck claim. |
| Browser Studio and node-headless-tooling debug builds | Pass. |
| Actual headless Nemesis Behavior Lens | 59 assertions pass. |
| Full Studio workflow and Pietious navigation workflow | Both pass on software, WebGL2 and WebGPU, including hidden history in both directions. The gate rejects uncaught page errors; existing source-lookup HTTP 404 messages remain in the logs. |
| Strict architecture boundaries, core-parity audit, indentation, diff check | Pass; zero architecture-boundary issues. No native/runtime change is claimed or required by this host-only slice. |

## Measured costs

Node 22.23.1 on this development host, isolated from builds/browser tests.
The retained-projection profiler batches 1,000 operations per sample, with ten
warmups and the median of 25 samples. The table reports the median across four
process runs. The selected path has four steps and chooses the **last** child,
not the best-case first child:

| Sibling children | Capture path (µs) | Resolve path (µs) |
| --- | ---: | ---: |
| 32 | 0.100 | 0.381 |
| 1,024 | 0.098 | 12.869 |

Capture follows the existing parent index. Resolution scans candidate siblings
at each path step and compares already-produced UTF-16 spans; it neither
recalculates line offsets nor builds another index. Resolution is not claimed
constant-time in sibling count. These warmed measurements consume transient
results; they are not a retained-history heap or GC profile.

Four isolated baseline/current process pairs also measured ordinary typing plus
Undo using identical bundles and source/cursor snapshots, without view
subscribers. The baseline uses
`8c9949765`'s text model **and** undo-record owner. Each sample batches 1,000
cycles, with the same warmup/median method:

- Baseline process medians: 0.373, 0.332, 0.336, 0.296 µs.
- Current process medians: 0.388, 0.373, 0.344, 0.314 µs.
- Medians across processes: **0.334 → 0.359 µs/cycle**. This is not a speedup
  claim. The generic state representation adds two small typed-value tags per
  prepared typing edit; it does not copy the existing cursor values again.

The current-source profiler additionally compares the same code-snapshot
typing/Undo cycle with and without a registered retained code input. Four
process medians are 0.281/0.361/0.347/0.312 µs without that input, and
0.338/0.378/0.378/0.351 µs with it: medians **0.330 → 0.364 µs/cycle**.
This includes delivery/application of the edit and Undo cursor states, not
widget layout or focus/render work. It is a separate warmed measurement, not
an end-to-end latency or allocation-rate claim.

History still retains two state references per record. Explicit bookmark
capture allocates its path; accepting an edit/Undo/Redo copies that path once
for pending mapping, leaving the recorded value immutable. Source projection
consumes the pending bookmark. No stable draw/hit/enablement, parsing, layout,
autosave, Hot Resume, guest or complete-frame cost is represented by these
microbenchmarks. Logs, baseline bundler and captures are in
`/tmp/bmsx-edit-bookmarks/`.
