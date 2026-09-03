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

### Source-backed visual projections

A visual behavior editor is another view on the resource-owned Lua
`EditorTextModel`, not another working copy and not a generated behavior
resource. The Lua parser and the workbench-owned behavior recognizer derive a
retained BT-, FSM- or ActionEffect-projection once per text-model content
version. Render and hit testing consume that projection; they do not parse or
rebuild topology per frame.

Visual commands address syntax whose provenance is known in the current Lua
source and submit the smallest required `EditorTextEdit` batch through
`EditorTextModel.pushEditOperations`. That gives text and visual views one undo
record and one ordinary content event. A command never mutates the projection,
executes Lua to discover an edit target, or serializes the complete definition.
A dynamically composed construct can remain visible as incomplete while the
unsupported visual mutation stays unavailable.

This follows VS Code's custom-text-editor contract—one standard text document,
multiple synchronized views and minimal workspace edits—and Roslyn's
full-fidelity source-transform principle, where tokens, whitespace and comments
remain source information:

- <https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L108-L114>
- <https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L140-L166>
- <https://github.com/dotnet/roslyn/blob/6a0c2f224d2950393bb54e32c7a2ec460e9e5d83/docs/wiki/Roslyn-Overview.md#L92-L105>
- <https://github.com/dotnet/roslyn/blob/6a0c2f224d2950393bb54e32c7a2ec460e9e5d83/docs/wiki/Roslyn-Overview.md#L125-L137>

The normal Lua save and Hot Resume owners consume that same model. A visual
editor adds no ROM-packer cooker, cartlib admission decoder, callback manifest,
second graph database or behavior-specific machine representation.

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
ordered from specific to general. A future visual behavior contribution may
therefore be selected explicitly for a Lua resource while the ordinary code
editor remains available for that same text model.

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

### Concrete editor inputs

Every retained tab is a concrete editor input owned by its contribution, not a
plain workbench DTO. The abstract common input owns only stable input identity,
kind, title and close policy. Explicit read-only and working-copy subclasses
own the dirty capability instead of an optional model field. The code,
resource-viewer, Behavior Lens and Scenario Lab contributions own their
specific model or view references. The static `EditorInput` union remains the
product's exhaustive built-in composition boundary.

The code input projects dirty state directly from its resource-owned
`EditorTextModel`; read-only inputs inherit the read-only `false` contract. Tab
layout and rendering invoke `input.isDirty()` polymorphically and never infer a
working copy from the input kind or from the active code widget. Input objects
are allocated only when retained and are reused across pane activation.

This is the small part of VS Code's `EditorInput` contract needed before
multiple editable surfaces exist: the input owns type identity and exposes
dirty state, while concrete custom inputs delegate that state to their retained
document model:

- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/common/editor/editorInput.ts#L95-L145>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/common/editor/editorInput.ts#L204-L216>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/contrib/customEditor/browser/customEditorInput.ts#L252-L280>

Save/revert participation is deliberately not defaulted to a no-op on the
base. A later editable structured input must first attach the existing working
copy to the real workspace persistence owner; a read-only input cannot
accidentally claim save support merely because it has a tab.

### Working-copy save ownership

`workbench/services/working_copy/text_file_save.ts` is the persistence and
runtime-sync boundary for retained text working copies. It receives the
resource-owned `EditorTextModel` explicitly, snapshots the exact state being
written, persists through the workspace owner, and only then completes that
snapshot. Lua and AEM keep their existing producer-specific runtime update
semantics. A visual BT or FSM input participates through the Lua working copy
and therefore uses the existing Lua Hot Resume path rather than a separate
asset revision.

The ordinary Save command resolves the active `EditorInput` and participates
only when that input is a `WorkingCopyEditorInput`; it never reads the detached
code-editor widget. Workbench actions that can replace executable media are
different: Hot Resume and Reboot capture one stable batch of every dirty model
retained by `EditorTextModelService`, and the prompt keeps that exact batch
while the user decides. Save-and-continue writes the batch sequentially and
stops on the first working copy that remains dirty. Neither prompting nor
changing the IDE theme activates a code pane or changes the selected editor.

This follows VS Code's distinction between active-editor Save, a resource-owned
working-copy registry, and operations over an explicit set of dirty working
copies, without copying its multi-group, untitled, Save As, cancellation, or
dependency-injection machinery:

- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/workingCopy/common/workingCopy.ts#L80-L100>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/workingCopy/common/workingCopy.ts#L116-L218>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/workingCopy/common/workingCopyService.ts#L60-L115>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/workingCopy/common/workingCopyService.ts#L318-L344>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/services/editor/browser/editorService.ts#L968-L1048>
- <https://github.com/microsoft/vscode/blob/8d48b77e9fc7df97b659e8a04bc999bb6fb8f031/src/vs/workbench/contrib/files/browser/fileCommands.ts#L455-L500>

### Atomic authored-asset media batches

An authored-data update is a build input, not an editor-side runtime override.
`RuntimeRomAssetEditBatch` groups ordinary `(type, asset id, payload)` edits in
the fixed execution-domain order `[system, slot 0, slot 1]`. The BLua32 media
builder feeds each domain's complete list into `layoutBlua32PublicAssets` both
when it derives asset-address link values and when it emits the final tail.
`buildBlua32Tail` therefore materializes one self-consistent ROM and the runtime
installs that medium once. It never rebuilds and installs the same domain once
per dirty document.

The representation and mirrored machine boundary are deliberately narrow:

| Boundary | TypeScript representation | C++ representation |
| --- | --- | --- |
| Tooling edit | fixed domain tuple of readonly `RomAssetEdit[]` lists | none; C++ does not own IDE/toolchain inputs |
| Rebuilt medium | one raw `Uint8Array` per affected ROM | one raw `std::span<const u8>` at installation |
| Machine install | `Memory.installSystemRom` / `CartridgeController.installRom` | matching `Memory::installSystemRom` / `CartridgeController::installRom` |

The only callers that walk the edit lists are media construction in
`buildBlua32Media`, final tail layout in `layoutBlua32MediaInstallation`, and
the offline Scenario cartridge builder. None is a frame, CPU-fetch, memory-bus
or renderer hot path. The machine receives only finished bytes and retains no
source path, asset kind, batch, Studio callback or revision counter.

This follows Godot's production split between resource-specific importers and
an editor filesystem that first gathers a concrete file batch and then invokes
the import pipeline. BMSX does not copy Godot's dynamic importer registry,
thread pool, compatibility options or sidecar cache:

- <https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/core/io/resource_importer.h#L110-L167>
- <https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/editor/file_system/editor_file_system.cpp#L3237-L3299>
- <https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/editor/file_system/editor_file_system.cpp#L3317-L3380>

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
