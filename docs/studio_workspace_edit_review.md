# Captured source context and workspace edit review

Implemented above the existing model/history owners, independently of Codex.
`Edit: Rename Symbol with Preview` is the first ordinary Studio client; direct
Rename remains available. This does not add an agent process or filesystem edit
route.

## Ownership and admission

- `WorkspaceSourceContext` starts an explicit reading operation **before** any
  asynchronous analysis/tool result. `read(model)` returns a retained immutable
  model/version/source receipt without creating a tab or a Save/Undo boundary.
  Workspace source changes retire the context, including unchanged edit targets
  whose dependencies changed, unopened catalog discovery, replaced socket
  catalogs and teardown with no retained models. A model saving its unchanged
  effective source does not invalidate the context merely by updating its base.
  Context scope is currently the whole workspace, not a claim of minimal
  dependency invalidation. It has no per-frame work.
- `WorkspaceEditProposal` accepts that context and copies the exact proposed
  edits. The caller transfers context ownership only after successful admission.
  Actual models/versions/writability and the existing history service, not paths
  or equal version numbers after reopening, decide edit rights. Source reads
  captured before a change cannot be refreshed implicitly when late edits arrive.
- The proposal is one-shot: pending, applying, applied, discarded, stale or
  failed. Source changes/teardown retire it; Apply ends its observation lifetime
  before submitting one shared history operation. There is no capture/rollback
  around writes. Unexpected operation failures are not called source conflicts
  or success. Discard/Close never mutate authored source.
  `onDidSettle` publishes its single terminal outcome after edit authority is
  retired and, for Apply, shared history has completed or failed. Settlement
  drops executable edit payloads and observer references while retaining the
  immutable review preview. Source Undo does not make the proposal pending again.
  Clients can observe this owner directly; they need no polling or second review
  state machine. The assistant uses it to update only the affected transcript
  heading, without rereading/reflowing message bodies or changing selection.
- `editor/text/edit_preview.ts` projects ordered text edits into exact before/
  after line-context hunks. It does not parse, invent another editable model,
  serialize canonical YAML, or run a quadratic full-file diff. Shared text layout
  preserves whitespace across wrapping and never splits surrogate pairs.
- `workbench/contrib/edit_review` owns the transient input, scroll/action focus
  and rendered hunk rows. Apply uses shared history; Save/build/install remain
  separate explicit operations. Source Undo/Redo works from either edited file.
  The pane explicitly does **not** hold guest execution; user/debugger pauses
  still belong to their existing owners.

The review input is not a persistence format. The group producer excludes it and
maps active/preview indices into the actual persisted sequence. When review was
active, reload selects its nearest persistent left neighbour, or the first
persistent input if none was to its left. Restore no longer silently skips failed
reconstructions and clamps indices onto a different resource: errors propagate.
Reload/reconnect cannot recreate accepted edit rights from a path.

Rename checks the exact current semantic snapshot before producing edits, not
only the files present in its old reference query. Its prompt owns a source
context and transfers it to the review. Newly discovered references invalidate
the old query even when no edited model changed.

## Production references

Studied VS Code 1.104.0 before implementation:

- [`BulkFileOperations`/preview](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/bulkEdit/browser/preview/bulkEditPreview.ts):
  preview is separate from authored models and groups exact resource edits.
- [`ConflictDetector`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/bulkEdit/browser/conflicts.ts):
  source/model changes retire captured edit context, not just an active tab.
- [`BulkTextEdits`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts):
  actual model references/version admission precede shared history writes.
- [`ChatEditingModifiedDocumentEntry`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingModifiedDocumentEntry.ts):
  the edit entry, not its rendered transcript, publishes acceptance/rejection.
  BMSX retains explicit one-shot review rather than copying live auto-application.

BMSX retains its own smaller source/model representation, input lifecycle and
host execution policy. No extension DTO compatibility layer, alternate source
database, service locator or generic operation bus was copied.

## Original slice validation

- Fourteen new context/proposal/preview/session cases plus live-owner Rename,
  save and disposal regressions: **34 focused passes**. Full Lua suite:
  **2309 passed, 1 skipped**. Six actual HTTP capability probes still pass.
- IDE/browser/Node typechecks and product builds pass; architecture audit has
  **0 issues**. Tests-project debt is **96 diagnostics**, down from 99 before
  this slice; no diagnostics remain in runtime replay or the new owners/tests.
  The whole tests-project typecheck is not claimed green.
- Actual WebGL2 review workflow: multi-file Rename preview, visible Apply and
  pointer Discard, shared source Undo/Redo, stale proposal after editing another
  tab, Close retirement and session exclusion. Forty-four replacements cover
  offscreen changes, keyboard scrolling and both fonts. The pending, final-file,
  MSX-font and stale screenshots were inspected. The real guest advances while
  the review is open; no source is saved or installed by review/Apply.
- The final forty-four-replacement workflow also passes on **software and
  WebGPU**, including both fonts, scrolling and the captured-context owner.
- The full WebGL2 Studio workflow and cold session reload pass. They cover normal
  source/visual/test/debugger/input clients alongside review integration. All
  browser evidence is automated, not a claim of UI-only development.
- The unchanged-frame check found needless text reflow after height-only chrome
  changes. Projection now keys on font/width; scrolling and height changes retain
  all row objects. A 16/256/4096-edit preparation probe measured median
  **0.014/0.076/0.853 ms**, and initial text projection **0.039/0.240/3.109 ms**.
  This is an explicit preparation size probe, not a before/after frame benchmark
  or universal performance claim.

Reproduction:

```sh
node --import tsx --import ./tests/lua/test_setup.ts --test tests/lua/workspace_edit_review.test.ts
BMSX_TEST_BACKEND=webgl2 node tests/conformance/runtime_replay/browser.mjs --studio-edit-review dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/review.png
node --import tsx --import ./tests/lua/test_setup.ts tests/conformance/runtime_replay/profile_workspace_edit_review.ts
```

## Settlement follow-through

The shared review/conversation/projection bundle now has **33 focused passes**;
the full Lua suite has **2344 passes and 1 skip**. Real-browser assistant review
and ordinary multi-file Rename review pass on software, WebGL2 and WebGPU.
Applied/discarded/stale transcript status is checked through visible commands;
stale Apply remains disabled and ordinary source Undo cannot restore edit rights.
Status-only updates preserve every body row, read/measure zero text and retain
selection, including a 60,000-code-unit later message and 1,000 unchanged frames.

Workspace teardown now explicitly resets retained transcript projection identity
before another frame or new entries can reuse old indices. The regression first
reproduced an old piece-tree offset being used against a new short message; no
range clamp, fallback or old-history reconstruction was introduced.

## External integration boundary

Resource context and multi-file review are now ordinary workbench capabilities.
The [Codex process](studio_codex_process_contract.md) and
[conversation](studio_assistant_contribution.md) now provide pinned schemas,
explicit tool admission and process shutdown/disconnect fencing without writing
behind these models. Neither the development HTTP capability nor this review pane
grants arbitrary file or guest authority. Agent/context serialization belongs to
the external boundary, not to these internal model APIs.
