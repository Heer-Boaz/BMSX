# Composite source editors

2026-09-13; baseline `c772fdedd`. D1 follow-through, not a new resource format.

## Reference and boundary

Inspected VS Code at `8e35945bae3f2b0b3d0276963281180f1ce10cb0`:

- [MultiDiffEditorInput][multi] aggregates dirty state from its presented
  resources and saves the actual file models. Its view identity is not a
  replacement working copy. Its special close-handler workaround and
  asynchronous diff/observable infrastructure are **not** copied here.
- [SideBySideEditorInput][side] deliberately delegates persistence to its primary
  side. That policy is correct for that editor, but not for a BMSX graph which
  can author fields in several documents.
- [UndoRedoService][history] orders stack heads when finding the nearest
  operation for an Undo source. BMSX applies that ordering to the explicitly
  presented **resource set**, not an edit-origin filter: edits through the code
  editor in those resources participate too.

These are explicit BMSX adaptations, not a claim that VS Code has a Lua behavior
designer. Definition meaning remains the cartlib contribution's responsibility;
syntax, text/history, persistence and focus keep their existing owners.

## Implemented contract

- `TextEditorInput` is the persistence capability. Single-source inputs retain
  `WorkingCopyEditorInput`; `CompositeTextEditorInput` owns only membership and
  dirty subscriptions. Neither owns buffers, a source copy or private Undo.
- The Lens's `workingCopy` remains the stable **registration anchor** used for
  input identity and discovery. Other-view opening uses that primary source or
  the normal picker, not the first convenient member of its edit-history scope.
  It is not an implicit target for every edit.
- A Lens contributes the registration model and the actual authored/occurrence
  source models of its selected definition. Other definitions in the same file,
  transitive query dependencies and callback implementations are not thereby
  added to Save or Undo. A shared authored subtree/list remains shared.
- Newly represented sources join on source-definition replacement, not on draw,
  hover, pan or ordinary navigation. Each model has one dirty subscription
  per input. Aggregate dirty notifications reflect real changes, including a
  source already dirty when admitted. Closing the view removes subscriptions,
  not workspace models/history.
- Save first completes the invoking control's draft through the existing focus
  route, then passes the dirty writable members to the existing file saver.
  Every saver captures its own exact snapshot before awaiting persistence.
  Save is not an atomic filesystem transaction; failed sources remain dirty.
  Read-only members are not made writable because another member is writable.
- A participating source remains in the Lens's editing scope until the input is
  closed. Removing an import, deleting a definition or leaving an incomplete
  table must not remove the very document needed to Undo or Save that edit.
  This retains document identity, **not** stale syntax/geometry as a fallback.
  Scope does not grow from query-only dependencies. A new/restored input builds
  its scope from its represented sources; history is not a session payload.
  Dirty working copies outside any input still belong to the workspace and its
  global Hot Resume / Reboot save prompt.
- Lens Undo chooses the newest participating stack head, Redo the oldest next
  head. The shared service still admits **all** participants of a compound
  element; a blocking resource is not skipped. Selection/focus does not select
  an arbitrary last-visited file as the history owner. A focused value draft
  retains its own text history until accepted.
- Ordering adds one scalar to an existing history element, not another wrapper
  or resource array for typing. Typing cannot coalesce across an intervening
  edit in another model. The cold composite command scans only its retained
  resource heads; it performs no language query.

## Product consumers and limits

Imported ActionEffect expressions and individual requirement values can be
edited in the existing property cell. Parsing, buffer edits, selection ranges,
Save and Undo all use the field's actual source model. Multiline expressions
still use the full source editor. No callback is evaluated or serialized back
into a guessed expression.

BT duplicate/remove/reorder and cross-depth reparent now also operate inside an
imported provider file. Drag admission obtains that provider's semantic file;
review and application use the same model. The registering file receives no
dummy edit. Lexical binding, shared-list and initialization reviews remain in
force. **A move between two different source files is still rejected.** The
cross-resource relocation contract is not provided by this input change.
The follow-through [FSM source-owner slice](state_machine_source_ownership.md)
now admits imported initial/path mutations, including a literal in a separate
callback file. Its actual editable evidence joins the composite input; unrelated
callback implementations still do not. The recognizer's limited API-binding rule
remains open. D1 as a whole, and loaded-definition/instance inspection D2/D3,
are not declared complete by these slices.

## Proof

The existing harness is extended, not duplicated per cart or renderer:

- `composite_text_editor_input.test.ts`: membership, dirty events, mixed write
  access, detach/disposal and surviving resource history.
- `workspace_text_history.test.ts`: scoped chronological heads, an outside
  compound-edit blocker, and interleaved/coalesced typing.
- `actioneffect_properties.test.ts`: shared model-service fixture with imported
  blueprint/tag sources, another definition and a callback dependency. Actual
  field edits, registration identity, Save/dirty, source bookmarks, Undo/Redo,
  removing/breaking imported source without losing Undo/Save, and retained
  stable-input allocations.
- `studio_behavior_imports.ts`: real commands and physical draft/source input,
  provider-owned BT duplicate/remove, ActionEffect field editing, composite
  Save, code/Lens Undo/Redo and unchanged paused guest/media.
- `studio_bt_reparent.ts`: the **same** pointer/review/Source/Undo scenario for a
  local declaration and an imported provider, sharing one declarative fixture.

No cartlib, compiler, machine, ROM format or C++ runtime edit. There is no added
guest-tick work. Host typechecks, unit and browser proof are recorded separately;
they are not a claim of native runtime inspection or unrestricted cross-file edits.

Final validation: **1,706 Lua-test passes, one existing skip**; IDE typecheck
passes. The tests-project typecheck retains exactly the same 51 baseline
diagnostics (diagnostic text compared, not only the count). Full Studio workflows
and cold session restoration pass on software, WebGL2 and WebGPU. The workflows
include incomplete-provider Undo from the Lens, not just a successful property
edit. Expected negative compile/guest-fault probes retain their fault gates.
Strict architecture boundaries report zero issues; core parity, indentation and
`git diff --check` pass. The debug browser product is rebuilt.

The existing isolated history workload was rerun against `c772fdedd` using
Node 22.23.1: 8,000 edits to a 48 KiB ASCII source, then available Undo/Redo;
three alternating process pairs, 21 post-warmup samples per mode, no concurrent
browser/build/test jobs. Median typing: **4.38 ms before / 4.37 ms after**;
programmatic replacements: **4.49 / 4.36 ms**. This is no speedup claim or
whole-workspace latency guarantee. Stable input membership is retained, and
the added history order is a scalar on the existing element, not another
typing allocation. Logs are under `/tmp/bmsx-composite-*`.

[multi]: https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/workbench/contrib/multiDiffEditor/browser/multiDiffEditorInput.ts
[side]: https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/workbench/common/editor/sideBySideEditorInput.ts
[history]: https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/platform/undoRedo/common/undoRedoService.ts
