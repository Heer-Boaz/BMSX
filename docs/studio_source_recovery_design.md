# Source navigation and workspace recovery

## Production owners

- [VS Code `EditorMemento.saveEditorState`](https://github.com/microsoft/vscode/blob/ada39222f5f2fb65f3aea23d95496629a8bbf697/src/vs/workbench/browser/parts/editor/editorPane.ts#L243-L270)
  creates a resource/group entry when that view first supplies state. The
  existence of a text working copy does not imply an existing view memento.
- [VS Code `TextFileEditorModel.onModelContentChanged`](https://github.com/microsoft/vscode/blob/ada39222f5f2fb65f3aea23d95496629a8bbf697/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L598-L641)
  derives dirty state from the text model's saved history identity, not opening
  an editor or moving its cursor.

BMSX already has these separate owners: `EditorTextModel`, retained code-view
state, and workspace recovery generations. No VS Code compatibility readers,
generic memento facade, or second text/history store is required.

## Reproduced fault

1. A visual contribution retains and edits a Lua working copy without creating
   a code-editor input.
2. Autosave backs up the dirty contents. `codeEditorViews` legitimately has no
   entry for that resource.
3. Source navigation creates the first code view and requests its metadata.
4. The old updater assumed a matching entry, indexed `views[-1]`, and read
   `cursorRow` from `undefined`.

Both the independent workspace test and the real Pietious `enemy_crossfoe`
workflow reproduce the reported exception with the pre-fix owner. The browser
test advances the normal 2,500 ms autosave timer; it does not replace autosave
with an immediate test-only save. Old browser storage is not necessary.

## Contract

- Dirty contents belong to the resource-owned model. Code views may precede
  or follow the content backup. Recovery still persists views only for dirty
  working copies; this is not a new clean-tab session-restoration feature.
- A metadata request captures the emitting **model/view pair**, not an active
  tab id resolved later. The widget may attach another model, the active tab
  may be a Lens, or the code tab may close before the timer runs. The retained
  input/view lifetime remains the workspace lifetime.
- A metadata-only generation inserts a first view or updates an existing one
  by resource domain/path. It reuses the dirty-file manifest and content
  records. Absence of a view is a normal lifecycle state, not corrupt data to
  hide with a default cursor or a compatibility reader.
- Metadata requests coalesce in a retained map, with one entry per model.
  Cursor-only capture does not materialize source text. Unchanged metadata
  returns the previous generation; clean navigation requests no recovery work.
- Save/Undo may make a queued model clean before capture. The ordinary dirty
  rebuild removes its backup and metadata; a metadata update never resurrects
  a clean model's recovery entry.
- Source navigation is not an edit. Never reset a dirty flag when opening a
  source to conceal an unintended mutation. Explicit visual commands and
  code edits share the existing text history; autosave never adds Undo entries.

## Regression evidence and limits

`tests/lua/workspace_storage.test.ts` uses independent sources for late view
creation, session reload, identical paths in different domains, a reattached
widget, unchanged metadata, clean navigation and Undo before capture.

`tests/conformance/runtime_replay/studio_source_recovery.ts` exercises the
reported `crossfoe` through the real picker, source command, keyboard, held
double-click and pointer-selected detail. It checks model version, dirty
state, byte identity, content-change events, recovery records and the paused
machine. Each clean route continues beyond the autosave delay, including
closing/reopening the IDE. It is intentionally a reported-cart smoke test,
not the independent owner regression fixture.

The separate report of **spontaneous dirty state on a clean source link** has
not been reproduced in these routes. A fresh-browser diagnostic also opened
the unmodified `crossfoe` source with version 1, no Undo and no dirty state.
The proven autosave failure must not be presented as proof of that separate
mutation's cause. No speculative navigation/text-model patch was added.

2026-09-09 evidence: `/tmp/bmsx-source-review/` contains the failing pre-fix
unit/browser traces and the corrected software/WebGL2/WebGPU browser runs.

Validation: 1,103 Lua tests passed (one existing skip), including 48 workspace
tests. The complete Studio workflow and Pietious navigation/recovery profile
passed on software, WebGL2 and WebGPU; the headless Behavior Lens test passed
59 assertions. Browser GPU runs use Chromium/SwiftShader, not physical-GPU
proof. IDE typecheck, browser/headless builds, strict architecture audit (zero
issues), core-parity, indentation and diff checks passed. The tests-project
typecheck still has 51 pre-existing diagnostics, with no additions; it is not
reported as green. The browser Studio bundle was rebuilt for local testing.
