# Resource-owned workspace edits and history

2026-09-13; baseline `ff4874936`. First implementation under D1 of
[`behavior_definition_inspection_design.md`](behavior_definition_inspection_design.md).
This closes the shared text/history prerequisite, **not** cross-file graph
authoring or loaded-definition inspection.

## Production reference and concrete defect

VS Code was inspected at `8e35945bae3f2b0b3d0276963281180f1ce10cb0`:

- [BulkTextEdits](https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts)
  resolves resources, admits model revisions and creates a single-model or
  multi-model history element before application.
- [editStack](https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/editor/common/model/editStack.ts)
  retains each model's inverse changes and before/after state inside the element.
- [UndoRedoService](https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/platform/undoRedo/common/undoRedoService.ts)
  puts that element in each resource stack and checks the other participants
  before workspace Undo/Redo. Its optional splitting/recovery, asynchronous
  model reopening and history serialization are **not** copied into BMSX.

The BMSX Lens correctly withheld cross-file mutation, but the existing Rename
already edited multiple files using unrelated histories. Undo in the initiating
file could therefore leave renamed references behind. Rename also skipped
generated sources, potentially applying only part of its proposal.

## Live ownership

`EditorTextModelService.history` now owns the resource stacks. A normal
`EditorUndoRecord` is its single-resource element: no extra wrapper/participant
array per typed edit. A workspace element references the participating models'
records and occupies one entry in each stack. The existing PieceTree still
owns inverse subtrees; there is no whole-document rollback or copied history.

`EditorModelEdit` carries one model revision, its ascending, non-overlapping
edits and optional editor-owned before/after state. The model-keyed proposal
groups edits by resource at the producer. The history service admits versions
and write access for the **entire** proposal before changing source. These are
mutable document/admission checks, not validation of internal syntax/DTO values.

Application and replay have three phases:

1. Every participant emits its existing pre-change event and closes coalescing.
2. Every buffer/version and the shared history positions advance.
3. Each model publishes its ordinary content and dirty events.

A content observer therefore sees all final source bytes, not an intermediate
half-renamed workspace. Code/graph selection state remains typed model history;
the history service knows neither Lua syntax nor view state representations.
Save retains its existing state-id semantics, including a write completing
after further edits. Closing a view does not close its resource history.

## Conflicts and lifetime

Undo/Redo may only replay the shared element when it is next in **all**
participating stacks and the sources are writable. Otherwise
`EditorHistoryConflict` names the blocking source. The shared editor command
owner reports it without changing any source, version, stack or notification.
Undoing the intervening edit permits the original compound operation again.
No silently split refactor, implicit Undo of unrelated edits or best-effort path.

Branching discards a dependent redo tail in every affected source. Revert,
resource teardown and the existing history limit likewise remove complete
dependency prefixes. In a peer resource this makes the forgotten shared edit a
history boundary, not a hole allowing older inverses against incompatible text.
Later independent records survive. This is explicit history retention policy;
it never rewrites peer source to rescue an old record. Detached subtrees are
released once, including overlapping workspace edits.

Rename is the first product consumer. It builds one proposal from the semantic
reference result and verifies its participating authored sources against that
snapshot. Generated/stale targets reject the whole proposal. It no longer
mutates the active model first or opens tabs for background edits. The active
selection is mapped through preceding replacements on the same line and is
retained for Undo/Redo in the shared element.
The Rename prompt watches source changes only during its focused lifetime:
changing another workspace model dismisses the old reference proposal too.
This follows the source-state cancellation used by
[VS Code Rename](https://github.com/microsoft/vscode/blob/8e35945bae3f2b0b3d0276963281180f1ce10cb0/src/vs/editor/contrib/rename/browser/rename.ts),
with workspace scope because BMSX retains its reference result while editing
the new name. There is no inactive-prompt listener on ordinary typing.

## Scope and proof

No cartlib, compiler, machine or C++ change. There is no guest-tick work,
behavior resource, source evaluator, new Save format or second graph database.
The follow-through [composite input/save/focus contract](editor_composite_sources.md)
now admits edits within an imported provider. Cross-resource binding admission
is still required before a move between different files is enabled. Adding
this history owner does not make every imported graph operation safe.

- `workspace_text_history.test.ts`: complete-buffer notifications, typed state,
  both replay directions, intervening edits, read-only/stale admission, redo
  branches, overlapping groups, retention limits, Save and typing boundaries.
  Synchronous Save completion during a content event also has a regression
  test: dirty-before is captured for the operation, not inferred after listeners
  may have saved this or another participant.
- `rename_cross_file.test.ts`: real semantic references, background models,
  one Rename with Undo/Redo from either source and no new editor tab.
- `studio_workspace_rename.ts`: actual command palette, focused Rename draft,
  physical acceptance and cross-file Undo/Redo, dependency warning, same-line
  selection, and unchanged paused guest/media. Included in the common Studio
  workflow rather than introducing another browser harness.

Validation: `test:lua` has 1,702 passes / one existing skip; IDE typechecking
passes. The tests-project typecheck has exactly the same 51 diagnostics as the
baseline (compared diagnostic text, not merely the count). The complete Studio
workflow, including physical Rename, cross-file history and source-change
cancellation, passes on software, WebGL2 and WebGPU. Architecture boundaries
report zero issues; core parity, indentation and `git diff --check` pass.
The final removal of a redundant Rename-builder write-access check was also
retested at the shared admission/history boundary: access is checked there
once for all participants, not independently in every producer.

Targeted history cost was compared against the baseline in a separate worktree,
with no browser/build/test job running: 8,000 edits to a 48 KiB source followed by
the available Undo/Redo history, three alternating processes per version, 21
post-warmup samples per mode. Median coalesced typing was 4.33 ms before / 4.46 ms
after; programmatic replacements 5.00 / 4.46 ms. These small, noisy microbenchmarks
do not establish a speedup or full-workspace latency. Ordinary typing retains
its existing record/subtree representation; it allocates no workspace participant
arrays and no retention worklist when expiring a single-resource element.
