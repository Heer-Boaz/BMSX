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

## Execution, view lifetime, and restored inspection

Host execution is independent of editor focus. `hosts/common/execution_control.ts`
owns the requested/fullscreen/initialization pause mask and explicit execution
notifications; `HostRewind` owns timeline review. The product injects these
services and the one `RuntimeTaskQueue`, not `HostFrameSession`, the quick-menu
object or `RenderPresentationState`, into IDE commands. Dependency audits keep
execution services distinct from presentation and product/frame composition.

The Run menu owns a single checked Pause toggle with no gameplay shortcut.
Turning it off releases requested pause and returns to the game, except at a
debugger stop where the inspector remains visible. Continue (F5) and source
steps are debugger commands, dispatched only by the active IDE keybinding
service; Continue requires an actual debugger stop. F5/F6 outside the IDE stay
guest keyboard input, including while the host is paused. The existing pointer
press edge handles the toggle once per click, without another input latch.
Source steps retain requested pause. No command overrides an independent
fullscreen/initialization pause, adds a guest pause register, or presents a
source step as one worldtick.

`CartEditor.onDidChangeActive` reports real view transitions. The workbench
composition dismisses the host modal with Retain on editor activation and
updates the host audio UI reason. Retain freezes a seek without branching or
returning to the recorded present. Explicit execution dismisses the modal with
Discard; the command or accepted media owner chooses timeline takeover. Input
reset and modal departure stay in the existing host-menu lifecycle. Features
do not reach back into that composition to implement their own transitions.

Hot Resume captures text-model versions, applies workspace sources and builds
the candidate revision inside the shared exclusive operation queue. Build
diagnostics do not fabricate a guest stack or prevent resuming the installed
program. The built revision retains which source domains were explicitly edited;
mechanically relinked media do not imply another cart's init should run.
Only the installed-source maps establish which code is applied. They are
compared with the current text, including undo/redo and edits made while a
build was queued; no model-side acknowledgement guesses that state. Installation clears old
runtime-error adornments and reports code installation, not a premature claim
that guest init has finished.

History is invalidated at accepted mutation, not queue admission. Supervisor
return and annotated-init batches run through the existing ordinary debugger
and scheduler but are not admitted as replayable physical-input execution.
History resumes after the batch completes. Compile failure before installation
retains the execution; a guest fault during init remains a real inspectable
fault, repaired through the existing supervisor/completion ownership.

The generic runtime's post-restore notification invalidates IDE execution stops,
plan state, fault/hover/completion caches and rebuilds breakpoint PCs and active
source identity. Breakpoint definitions and text models survive. The inspector
reacquires restored guest tables via `SuspendedGuestSession`, never a retained
host projection of the pre-restore heap. Deactivating the code view also ends
the live hover query. Machine snapshots contain none of this IDE state.

The production examples, combined browser-Studio proof and remaining authoring
scope are in [`docs/studio_development_workflows.md`](../docs/studio_development_workflows.md).

## Text models, working copies, and editor inputs

Editable text is retained by resource identity, not by the currently visible
tab. `editor/model/model_service.ts` owns exactly one `EditorTextModel` for each
`(domain,path)`. That model owns the PieceTree buffer, monotone content version,
saved-state identity, dirty state, undo/redo history,
and content/save/revert events. Its public buffer is read-only; typing and
programmatic changes both enter through model edit operations. A multi-edit is
one undo element and publishes one content event.

A code-editor input owns only its resource model reference and its independent
cursor, selection, desired-column, and scroll state. The active code editor is
the single widget attachment to one such model/view pair; activation does not
copy document data into an active-tab buffer. Closing a tab therefore does not
discard a retained dirty model or its history. A later visual scene or behavior editor
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

### Authored, saved, and installed source revisions

`workbench/services/working_copy/lua_sources.ts` captures all retained authored
program-models at command admission, including clean documents and documents
without a visible code tab. Capture is an undo boundary. Hot Resume, explicit
Reboot and Scenario Lab apply workspace overrides first and those captured
models last. `applyLuaTextModelSources` only dirties changed build inputs. A
later edit cannot silently become part of that accepted source batch.

`runtime_source_status.ts` projects the actual installed source, not an editor
version counter. The existing per-domain `installedBlua32Sources` maps are
replaced by media installation; saves and rejected builds do not change them.
The projection retains source resolution and caches text equality by model
version and installed source. Stable status drawing performs only retained
lookups, without rescanning text, parsing Lua or allocating source snapshots.
Undo can therefore return to installed source while remaining dirty relative
to disk, or return to saved source while newer code remains installed.

AEM's existing save/apply owner records its installed authored source and apply
failure in `RuntimeSourceState.aemSourceApplications`. Those are tooling-only
operation records, not a second asset store or serialized device data. Opening
an AEM file does not establish that its workspace text produced the loaded
cooked asset; before an actual apply its source status is untracked, not synced.
AEM preparation builds and relocates before installation and resolves assets
in the resource's domain, not the active view's package. A rejected source build
records an outcome without blocking the installed execution; failures after
installation retain the ordinary operational error boundary. No acknowledgement
is rolled back.
Source-only Lua documents do not claim executable-code apply status.

The production references and the combined text/lens/save/apply proof are in
[`docs/studio_development_workflows.md`](../docs/studio_development_workflows.md#w04-authored-document-versus-geïnstalleerde-bron).
No source undo changes emulation state or undoes guest initialization. Scene
instance synchronization and writable visual-property commands remain separate
contracts, not implied features of this source revision owner.

### Source-backed visual projections

A visual scene or behavior editor is another view on the resource-owned Lua
`EditorTextModel`, not another working copy and not a generated behavior or
scene resource. The Lua parser and each workbench-owned domain recognizer
derive its retained BT-, FSM-, ActionEffect- or sceneprojection once per text-
model content version. Render and hit testing consume that projection; they do
not parse or rebuild topology per frame.

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

Scene authoring uses the same document contract, but its runtime object and
viewport owners are deliberately not inferred from the behavior projection.
The accepted cross-owner design and prerequisites are documented in
[`../docs/studio_scene_authoring_design.md`](../docs/studio_scene_authoring_design.md).
The first writable primitive is deliberately narrower. Existing signed numeric
literals can be replaced exactly from their syntax range at the generic Lua-
language boundary. That layer returns an `EditorTextEdit` only; it does not
apply edits, know cartlib types, or become a second working-copy owner. This is
enough for the first transform edit without pretending that the current syntax
tree is already full-fidelity.

Table insertion, removal and reordering are a separate language-architecture
slice. The current parser consumes separators and the lexer discards whitespace
and comments, so AST field ranges cannot own those edits without guessing over
raw source. Before those operations exist, the Lua syntax owner must explicitly
model token/trivia ownership and its compiler, semantic, formatter, memory and
incremental-analysis costs. Scene, BT and FSM contributions must not each grow
their own comma/comment scanners in the meantime.

The first scene source adapter edits the registered structured Lua definition
and uses the ordinary save plus Hot Resume path. Registration changes the
definition used by future instantiations; it does not infer mutation of an
already living objectgraph. A later live-instance command requires its own
concrete cartlib operation and correspondence owner first. Until that owner
exists, the IDE adds no hidden module-root lookup, runtime `require`, heap scan,
generic call-by-string route, undo callback or guessed guest mutation.

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

## Scenario runs

Scenario testing keeps four boundaries distinct:

- `ide/testing/scenario/test_collection.ts` owns stable suite/test identities,
  lazy discovery and resolution of one selected collection node to ordered
  leaves;
- `ide/testing/scenario/execution_service.ts` owns one packaged guest protocol
  and deterministic input at logical-tick boundaries, without host time or media
  lifecycle;
- `ide/testing/scenario/result_service.ts` owns bounded retained runs, ordered
  test items and their logs, captures, failures and semantic facts;
- `workbench/contrib/scenario_lab/run_service.ts` owns the browser-only media
  session and serializes canonical build, per-item derived build/install/cold
  boot, cancellation and final canonical restore through `RuntimeTaskQueue`.

`ScenarioLabController` only resolves the current view selection, captures the
source batch and invokes that service. It does not loop over tests, retain an
execution queue, write cartridge media, aggregate result state or implement a
second cancellation path. One request and one retained run represent either a
leaf or the complete selected suite. A failed item does not stop later items;
cancellation marks unfinished items skipped. Rerun preserves the previous
resolved request.

Pacing belongs above the execution service. The browser workbench host consumes
wall time through the frame scheduler's scheduled bounded-tick operation;
headless tooling uses the explicit bounded operation without wall time and runs
as fast as possible. Both call the same execution service before and after every
completed logical tick. The direct libretro input-timeline host is a separate
native host workflow and remains unpaced by default; neither it nor the C++ core
imports Scenario Lab.

The blocking workbench and physical BIOS monitor are also different suspension
boundaries. Opening the workbench stops machine progress through existing editor
policy. Supervisor entry keeps the machine running but routes physical ICU input
to firmware and pauses only scenario tick/protocol progress. The contextual
Cancel command is exposed after the existing physical IDE chord reopens the
workbench; no Scenario-specific global hotkey or emergency control is added.

This follows VS Code's ownership of one live result for a resolved multi-item
request rather than issuing one UI command per leaf:

- <https://github.com/microsoft/vscode/blob/4290bede3cbc24e3fe9c979b655cebdf3b4e5f6b/src/vs/workbench/contrib/testing/browser/testExplorerActions.ts#L164-L182>
- <https://github.com/microsoft/vscode/blob/4290bede3cbc24e3fe9c979b655cebdf3b4e5f6b/src/vs/workbench/contrib/testing/browser/testExplorerActions.ts#L626-L650>
- <https://github.com/microsoft/vscode/blob/4290bede3cbc24e3fe9c979b655cebdf3b4e5f6b/src/vs/workbench/contrib/testing/common/testServiceImpl.ts#L251-L294>
- <https://github.com/microsoft/vscode/blob/4290bede3cbc24e3fe9c979b655cebdf3b4e5f6b/src/vs/workbench/contrib/testing/common/testResult.ts#L276-L348>

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
