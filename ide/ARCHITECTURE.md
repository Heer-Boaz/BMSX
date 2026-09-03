IDE structure follows a simple ownership split inspired by VS Code's `editor` and `workbench` layers:

- `editor/`
  - Editor-only behavior and state.
  - Text model, editing, caret, code area rendering, editor input, and editor contributions such as intellisense, suggest, rename, references, find, symbols, and runtime-error navigation.
- `workbench/`
  - IDE shell and chrome around the editor.
  - Tabs, top bar, status bar, prompts, context menu, debugger UI, problems panel, resource browser, and workbench-owned input/rendering.
- `language/`
  - Language-specific tooling shared by editor features.
  - Lua, AEM, and YAML parsing/highlighting/formatting layers live here.
- `common/`
  - Small shared kernel only.
  - Shared types, constants, text/layout helpers, character tables, and lightweight scheduling primitives.

Rules:

- Do not put workbench panels or chrome in `editor/`.
- Do not put editor text/caret/render/input code in `workbench/`.
- Do not grow `common/` with owner-specific state.
- If a new module is mainly owned by one surface, place it with that surface even if other modules import it.
- Prefer moving code to the real owner over adding wrapper layers or generic host/facade abstractions.

## Text models, working copies, and editor inputs

Editable text is retained by resource identity, not by the currently visible
tab. `editor/model/model_service.ts` owns exactly one `EditorTextModel` for each
`(domain,path)`. That model owns the PieceTree buffer, monotone content version,
saved-state identity, dirty state, runtime-applied version, undo/redo history,
and content/save/revert events. Its public buffer is read-only; typing and
programmatic changes both enter through model edit operations. A multi-edit is
one undo element and publishes one content event.

A code-editor input owns only its resource model reference and its independent
cursor, selection, desired-column, and scroll state. The active code editor is
the single widget attachment to one such model/view pair; activation does not
copy document data into an active-tab buffer. Closing a tab therefore does not
discard a retained dirty model or its history. A later visual behavior editor
must retain the same resource model and issue targeted model edits; it must not
maintain a second JSON/source buffer or replace the whole document for a
property change.

Workspace recovery persists dirty model contents separately from code-editor
view metadata. Rename, behavior-source indexing, Hot Resume, and autosave read
resource models directly. Diagnostics reads the models of retained code-editor
inputs without consulting an active-tab document copy. Completing an
asynchronous save records the exact captured model state; an edit made while
the write is outstanding remains dirty.

This follows the production VS Code ownership pattern rather than its full
service surface:

- the model service indexes models by resource and creates the retained model:
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/common/services/modelService.ts#L440-L481>;
- a text model owns content events, monotone and undo-revisitable versions, and
  atomic edit operations:
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/common/model/textModel.ts#L244-L266>,
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/common/model/textModel.ts#L737-L792>, and
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/common/model/textModel.ts#L1336-L1348>;
- the resource/model edit stack groups operations and retains cursor snapshots
  with the undo element:
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/common/model/editStack.ts#L384-L440>;
- the editor widget attaches a model while view and contribution state are
  saved/restored separately:
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts#L499-L535> and
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts#L1038-L1071>;
- working-copy dirty tracking follows content/undo identity and a completed save
  only cleans the version actually written:
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L592-L642> and
  <https://github.com/microsoft/vscode/blob/dc85eaf99d21fb62cc4d8b43a21625a93863cf1e/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L953-L970>.

### Structured text projections

A typed visual editor does not turn its parsed graph into another working
copy. `BehaviourTreeDocumentModel` retains a derived projection of an
`EditorTextModel<'behaviour_tree'>`. The typed document, diagnostics, stable-id
index and exact JSON paths are rebuilt exactly once for each text-model content
event and shared by all views of that text model. A render pass reads the
retained projection; it never parses or rebuilds topology.

Structured commands write through `jsonc-parser` edit results and
`EditorTextModel.pushEditOperations`. The adapter in
`editor/model/jsonc_edit.ts` only translates the JSONC library's offset edit
contract into the canonical text-model edit contract. It does not own content,
undo state or domain semantics. A property command therefore creates one text
undo element and the normal content event updates source and visual consumers.
No command may mutate the parsed projection or replace the complete document
to change one property.

The production references are VS Code's custom text editor contract—one text
document, multiple views and minimal workspace edits—and Microsoft's JSONC
edit contract, whose edits address the original source and preserve surrounding
formatting:

- <https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L34-L52>
- <https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L140-L166>
- <https://github.com/microsoft/node-jsonc-parser/blob/ee57b71dad28a973488b02d5577778c54784d76a/README.md#L256-L299>

## Resource editor resolution

A ROM resource keeps its producer-owned asset type. The workbench does not add
an `editorKind` to `RuntimeResource`, and resource navigation does not decide
between Lua, AEM, binary previews or future visual editors. Instead,
`ResourceEditorResolver` selects an ordered built-in editor contribution by
asset type or filename suffix. The concrete contribution owns input creation;
the final wildcard contribution owns the ordinary resource viewer. Editor ids
also allow another matching editor to be selected explicitly without changing
the resource or duplicating its document.

Resolution returns the retained editor input; it does not activate it. Resource
navigation gives that input to the editor group and owns activation and text
selection. Workspace recovery uses the same contribution factory to recreate
each dirty input without activating it, then hydrates the resource-owned
`EditorTextModel` directly. Code cursor and scroll metadata remain code-input
state and are restored separately. A dirty structured document therefore does
not need a hidden code tab or a second recovery model.

`runtime/sources.ts` indexes source-backed ordinary `data` and `aem` assets as
data resources alongside the Lua source registry. It does not identify which
editor will open them. Only the active execution domain contributes data
resources to the visible catalog, while the existing domain-qualified identity
map retains all installed domains. Compiler-owned `code` payloads and assets
without a source path are not source documents.

This is the deliberately small built-in subset of VS Code's editor resolver:
editors register independently against resource patterns, resolution chooses a
matching editor/factory, and custom editors match the resource rather than
reclassifying it:

- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/editor/common/editorResolverService.ts#L271-L284>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/editor/browser/editorResolverService.ts#L446-L478>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/editor/browser/editorResolverService.ts#L606-L683>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/workingCopy/common/workingCopyEditorService.ts#L20-L48>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/contrib/customEditor/common/customEditor.ts#L100-L126>

BMSX has no extension marketplace or user editor associations, so it does not
copy VS Code's dynamic registration, priority and configuration machinery.
Built-in contributions are composed once when the workbench starts and are
ordered from specific to general. A future Behavior Tree contribution may
therefore claim `*.bt.jsonc` while the machine-facing asset remains ordinary
`data`; it must not add a BT asset type to the ROM TOC.

## Editor pane lifecycle

An editor input is data and retained view state; an `EditorPane` is the one
workbench control that presents inputs of that kind. `EditorPanes`, scoped to the single
editor group, creates each pane only on first use and retains that instance.
Switching inputs calls `clearInput()` on the old pane and `setInput()` on the
new pane. Reopening the identical retained input calls only `setOptions()`, so
a navigation selection can be applied without rebuilding or reattaching the
control.

The active pane owns all input-specific update, draw, keyboard, pointer, wheel,
and status-bar behavior. The outer workbench still owns global commands, tabs,
panels, blocking modals, and chrome. Consequently a Behavior Tree editor can
become a real editable workbench control instead of adding another
`switch (activeTab.kind)` to every frame and input router. The frame hot paths
call the cached active pane directly: factory resolution, map lookup, and pane
allocation happen only during activation.

The lifecycle is the deliberately synchronous subset of VS Code's retained
editor-pane model. VS Code keeps an editor control alive across inputs, gives
it `setInput`, `setOptions`, and `clearInput` lifecycle calls, keeps lightweight
pane descriptors separate from retained instances, and resolves or creates a
pane only while opening an editor:

- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/browser/parts/editor/editorPane.ts#L34-L49>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/browser/parts/editor/editorPane.ts#L103-L146>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/browser/editor.ts#L24-L112>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/browser/parts/editor/editorPanes.ts#L323-L407>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/browser/parts/editor/editorPanes.ts#L425-L484>

BMSX uses one exhaustive built-in factory table instead of copying VS Code's
dynamic pane registry. It does not add DOM containers, asynchronous
cancellation, multiple editor groups, dependency injection, visibility events,
or extension registration before those product requirements exist. It also does not make panes disposable
per tab: one pane instance may present many retained inputs, while the inputs
and their resource-owned document models outlive visibility independently.

## Retained lists and panes

`workbench/ui/list_view.ts` owns the common retained-list contract: row storage,
selection, scroll, hover, viewport geometry, hit testing, reveal, and scroll
clamping. A feature owns the meaning and formatting of its rows; it must not
copy these list mechanics into a panel-specific controller. A multi-pane input
retains one list state per pane. Inter-pane focus belongs to the containing
input, while each pane keeps its own rows and viewport state.

This follows VS Code's split-view contract, where each view item receives its
own layout, and its list widget, which retains items and scrolling behind one
list interface:

- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/base/browser/ui/splitview/splitview.ts#L35-L109>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/base/browser/ui/list/listView.ts#L230-L298>

## Commands, keybindings, and menus

Workbench actions follow the same ownership split as VS Code's `Action2` and
menu/keybinding registries:

- a typed command id identifies an operation and `IdeCommandController` owns
  execution plus enabled/active state;
- command presentation metadata owns the human label once;
- the keyboard layer contributes bindings to command ids and resolves the
  highest-weight applicable binding; a feature view does not branch on a
  command shortcut itself;
- workbench menus contribute ordered command ids to named menu locations;
  top-bar dropdowns and view-title action bars project those contributions
  through shared render and pointer owners;
- pointer, keyboard, and controller activation converge on the same command
  id before the feature controller performs the operation.

Tree/list navigation remains input owned by the focused view, just as a list
widget owns cursor movement. Operations such as run, rerun, and cancel do not:
they are commands with contextual enablement. Status text reports retained
view or operation state and never embeds manually maintained shortcut strings.
If a surface presents a shortcut, it obtains the label from the keybinding
catalog rather than duplicating it in a menu or view.

The production references are VS Code's single action registration path, which
publishes one command descriptor into command, menu, and keybinding registries,
and its weighted/contextual keybinding resolver:

- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/actions/common/actions.ts#L679-L779>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/keybinding/common/keybindingsRegistry.ts#L62-L68>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/keybinding/common/keybindingResolver.ts#L320-L395>
