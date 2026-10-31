# Studio main workspace and document editors

## Product boundary

The ownership and interaction contract below is the target architecture. The
capability table distinguishes existing owners from missing implementation.

The target is a persistent project work area whose authored context remains
available while independent document and asset editors are used. Home is
welcome/navigation content, not that context or its lifetime owner. This
document defines the workspace interaction and ownership contract, not an
Unreal feature checklist.

The target supports multiple independently living editor parts and Source
controls. It is not restricted to the number of windows in the first delivery.
Editor-group docking belongs to this workspace design; snapping a floating
window does not implement it. Project selection, target-free startup and native
host windows have their own admission/presentation requirements.

```text
Studio frontend — one attached workspace
├─ Permanent shell — Open Editors, menu and workspace status
├─ Project content — admitted files, resources and authored declarations
├─ Main workspace — one retained presentation family, without a floating titlebar
│  ├─ Primary authoring client — explicit authored subject and selection
│  ├─ Contextual hierarchy and Details — bound to that primary context
│  └─ Main editor part — ordinary document/asset editor group arrangement
├─ Explicit floating editor parts — the same group arrangement and input owners
│  ├─ Home / Source / Scene / FSM / BT / other document and asset editor tabs
│  └─ Normal/snapped/maximized placement, independently minimized visibility
├─ Output/tool presentations — explicit activity subjects and lifetimes
└─ Owned inspectors, popups and dialogs — scoped to their actual clients
```

These are composition roles, not a fixed arrangement of tool-specific panels
or a requirement for every region to remain expanded. The primary context and
project content survive document activation, hiding or rearrangement. Main's
ordinary groups remain available for independent editors; they do not own the
primary subject. All document editor kinds use the same opening, tab, split and
placement operations. Floating is explicit. Home can be opened or closed in
those groups without changing the primary context or project attachment.

The frontend's `MainWorkspace` composes named Hierarchy and Details regions
around the permanent `EditorParts.main` document arrangement in one presentation
family. A single retained primary authored context supplies both independent
region presentations. Requested side widths and visibility survive constrained
allocation; explicit region focus reveals its actual controls. An explicit
Scene declaration action or the explicit Main Scene chooser supplies the first primary client;
its hierarchy and Details use the same Scene controls as independent documents,
with a separate work context. The optional Game companion remains nested with
the documents and displays existing runtime scanout. Files is a toggleable project-content presentation, independent of command
results. Main restores its primary context separately from documents, and both
supply real locations to the shared navigation history. Call Hierarchy owns a
retained result input over its captured semantic query; existing editor groups
supply its split, move and floating presentation. Other activity regions and
project-browser session mementos retain their own composition requirements.

The existing Scene tool is a source-backed outline/property editor. Its Lua
resource may contain several scene declarations. Neither the running game frame
nor a runtime World is an authored level viewport. A visual level editor needs
its own source-backed scene, asset-resolution and rendering contract before
it can be advertised as such.

### Authored primary viewport

Main's primary content presents the authored Scene independently of document
tabs and runtime scanout. Its dedicated central allocation shares a resizable
split with the ordinary document part; opening Source never replaces the
authored context or silently covers its viewport. Hierarchy and Details remain
independent side presentations, not owners of the central content. Minimum
extents and overflow preserve both central clients, including without an
activity panel. Viewport focus is a primary-content destination, not a new
floating side-region role.

The Scene contribution renders the admitted source projection and its actual
asset providers. It consumes the existing spatial projection's retained world
affines and source occurrences; it does not instantiate a second World or run
constructors. Built-in visual producers supply concrete image/geometry inputs.
Custom rendering needs an explicit source-backed visual correspondence; a
Transform3D alone does not identify a mesh. Nonvisual spatial members may have
origin/axis helpers, never fabricated mesh or collision bounds. Unresolved
source or asset inputs remain explicitly unavailable.

The retained primary view owns 2D pan/zoom and 3D editor-camera intent,
Fit/Frame Selection, and their restoration. Picking uses the actual displayed
geometry and the context's one exact source selection. Translation, rotation
and scale tools retain a proposed affine until commit; Escape, attachment
retirement or source/provider invalidation writes nothing. A committed gesture
is one canonical edit/Undo unit, with the existing full-affine and physical
authority constraints. Camera changes are reading state, not document edits.
Static frames reuse admitted projections and decoded geometry/textures; source,
asset and camera generations invalidate only their own retained work.

This separates edited content, editor camera/helpers and shared selection as
in Godot's [canvas editor](https://github.com/godotengine/godot/blob/master/editor/scene/canvas_item_editor_plugin.h)
and [3D viewport](https://github.com/godotengine/godot/blob/master/editor/scene/3d/node_3d_editor_viewport.h).
The host still needs affine image drawing and an authored mesh renderer;
axis-aligned bitmap placement and a running frame cannot implement those
contracts. These rendering capabilities belong to the host rendering owners,
not to cart-specific ABI helpers or per-frame baked preview images.

At attachment, restore the primary context separately from editor groups and
their recorded subjects/views through the source owners. With no selected
primary subject, Main is explicitly unbound: project content and an action to
choose a supported authored subject remain available, while contextual editing
is inactive. Home may open as a welcome document; it neither fills nor pins the
primary client. A retained subject that cannot resolve is Unavailable, not
unbound. Neither state chooses a first file/declaration or a running frame.
Problems and Build Output are retained clients of Main's activity allocation,
independently of the authored context and document arrangement. Main owns
visibility, docked height, resizing and overflow. The activity part owns
selection and separately admitted native client surfaces; its selector and the
client's controls share one header row. Hiding or switching retires input, not
diagnostic correspondence, queries, selection or reading intent.

Move Activity Area to New Window moves the whole retained selector/client area
into the shared in-canvas window container. Move Activity Area to Main returns
that same native subtree to its docked allocation. Neither action constructs
document inputs or replaces controls, subjects, Find, selection or reading
state. The shell belongs to Main's physical family and uses its available work
area for resize, snap and maximize. Close hides the area in its current
placement; it does not roll up to a titlebar. Minimize retains the floating
shell, which remains available through the global window picker and minimized
count. Problems/Output reveal a minimized area rather than toggling it hidden.
The area header and floating titlebar provide the placement context menu.
Docked height and floating normal bounds/placement are remembered separately;
restoring layout preserves minimization rather than focusing it open.

Build Output chooses an admitted request independently of document readers.
The provider owns captured observations; each reader owns its presentation.
Choosing a result presents that observation before asynchronous refresh, so
late receipt/output publication cannot reopen a hidden activity or take focus.
Activity recovery remembers the selected tool, not a captured build request;
restored Build Output remains explicitly unbound until a request is chosen.

Build target discovery and receipt inspection admit their Quick Input session
before starting observational I/O. Pending input can collect a query or close;
only that exact session admits its resolved catalog or error. A binding's
`BuildOutputs` owner retires its UI readers even if the same transport object is
later reused. Source ownership is checked before replacing another presentation
and remains leased through acceptance/disposal and focus-return callbacks.
Accepted Submit/Cancel operations continue independently; closing their UI does
not repeat, forget or undo a producer request. Log delivery keeps the original
receiving group through receipt reads, refresh and cancellation instead of
choosing whichever group is active when the response arrives. The receiving
group's normal opening admission governs whether it can still present that log.
An admitted reader can retain captured documents after its live source retires;
receiver callbacks do not preserve refresh authority or require rolling back
the accepted view.
This follows VS Code's [promised Quick Input catalogs](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/platform/quickinput/browser/quickInputController.ts),
without a separate Build-window or cancellation framework.

An explicit authored-subject action binds Main; ordinary document opening
continues to use the common group-routing contract. Home, the Window menu and the
Command Palette expose Choose Main Scene independently of Files or open documents.
Each choice addresses an exact authored declaration, including multiple scenes
in one source file; selecting it uses Main's existing replacement and dirty-close
admission rather than opening a temporary Scene Editor document.

## Production references

- Epic distinguishes the permanent Level Editor, project Content Browser and
  specialized editors in its [editor interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-editor-interface).
  The transferable decision is the main/project versus document-tool boundary,
  not the assumption that BMSX already has Unreal's level model or viewport.
- Epic's [asset editor initialization](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/UnrealEd/FAssetEditorToolkit/InitAssetEditor)
  separates the edited objects, toolkit host, mode and standalone layout.
  [IToolkitHost](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/EditorFramework/IToolkitHost)
  supplies hosting and presentation relationships;
  [ILevelEditor](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/LevelEditor/ILevelEditor)
  separately exposes its selection, outliners, Details and viewports. The
  distinction informs Studio's composition: a window/group is not the authored
  context, and an asset editor is not the lifetime owner of the project work
  area. These public API contracts do not imply access to Epic's private
  implementation, or justify copying a toolkit/service hierarchy into Studio.
- VS Code's [editor parts](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorParts.ts#L57-L108)
  compose a permanent main part and independently living auxiliary parts.
  Each [part](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorPart.ts)
  owns its groups, arrangement and local activation. An
  [auxiliary part](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/auxiliaryEditorPart.ts#L178-L190)
  receives [scoped editor operations](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/services/editor/browser/editorService.ts#L87-L98),
  while document services remain shared. Studio adopts these ownership scopes,
  not a dependency-injection container or an operating-system window.
- VS Code's [command-context resolution](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorCommandsContext.ts#L19-L72)
  resolves concrete groups/editors, using the active group when no explicit
  context is supplied. Studio likewise selects a destination or subject at
  invocation; a delayed operation retains it rather than consulting later focus.
- VS Code separates [input matching](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/common/editor/editorGroupModel.ts#L984-L1052)
  from strict object identity and permits
  [inputs shared across groups](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L644-L669).
  Studio deliberately differs: its retained inputs already own view state and
  disposable view bindings. Independent Studio views share the working copy,
  not that input object. This preserves the existing ownership instead of
  copying VS Code class names with different lifetime semantics.
- VS Code's [group arrangement](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts)
  represents groups separately from the [split/grid geometry](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/grid/gridview.ts).
  Lumino's [dock panel](https://github.com/jupyterlab/lumino/blob/main/packages/widgets/src/dockpanel.ts)
  likewise distinguishes inserting a tab from splitting beside a group. These
  are references for one editor arrangement, not an additional document store.
- Qt's [MDI area](https://github.com/qt/qtbase/blob/dev/src/widgets/widgets/qmdiarea.cpp)
  separates retained windows, activation and stacking. This is a closer reference
  for overlapping canvas editor hosts than VS Code's native auxiliary windows.
  Studio keeps the host-selection route outside that overlapping area.
- VS Code's [window actions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorActions.ts#L2390-L2569)
  expose new windows and explicit move/copy separately from ordinary opening.
  Window membership alone does not make those operations discoverable. Studio's
  additional-view action uses each contribution's fresh-input capability rather
  than sharing a retained input or turning another tool into Source.
- VS Code's [group move operation](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/parts/editor/editorGroupView.ts#L1280-L1389)
  checks the input's move capability and transfers the existing input with view
  state. Studio likewise separates transfer from copying, but detaches the old
  pane first because its retained inputs own mutable view bindings.
- VS Code's [terminal editor](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalEditor.ts#L70-L94)
  attaches and detaches presentation around a retained runtime instance; the
  [terminal input](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalEditorInput.ts#L24-L85)
  keeps that instance independently of the pane. Studio likewise separates
  runtime-client intent from concrete focus, popup and guest-input authority.
- VS Code's [editor input](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/common/editor/editorInput.ts)
  and [code widget](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts)
  distinguish retained subject lifetime from an attached control. This supports
  Studio's domain/context/control/container boundary; it does not require every
  tool to inherit a universal context class or normalize its selection data.
- VS Code separates its [Explorer model](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/contrib/files/common/explorerModel.ts)
  from [Call Hierarchy's editor-local peek](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/contrib/callHierarchy/browser/callHierarchy.contribution.ts#L73-L158)
  and the [retained References view](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/extensions/references-view/src/tree.ts).
  Studio's Call Hierarchy result editor follows the independent result lifetime;
  it is not a claim to implement VS Code's peek presentation. Explorer-specific
  reveal policy belongs to project navigation, not generic document opening.
- VS Code's [search model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/search/browser/searchTreeModel/searchModel.ts)
  owns query, cancellation and results independently of the Search view. Its
  [source search owner](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/search/common/searchService.ts#L105-L147)
  gives canonical model results precedence over file-provider results. Studio
  likewise separates query and presentation lifetimes and reads canonical dirty
  text, without adopting a provider registry or admitting every file as an editor.
- Godot's [main-screen container](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/editor_main_screen.h#L49-L64)
  keeps the main area present, while its
  [dock manager](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/docks/editor_dock_manager.h)
  owns floating placement. Its [edited-scene data](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/editor_data.h#L97-L118)
  and [selection owner](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/editor_data.h#L247-L298)
  retain the edited scene and coordinate selection independently of individual
  controls. Studio adopts these ownership distinctions, not Godot's runtime
  Node model or docking implementation.

Window presentation and physical input follow the existing
[surface/window contract](workbench_windowing_design.md). Document/input
identity follows [definition inputs](workbench_definition_inputs_design.md);
selection bookmarks follow [navigation history](workbench_navigation_history_design.md).

## Capability translation and missing prerequisites

The [Unreal editor interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-editor-interface)
is a reference for separating a permanent work area, content navigation and
specialized editors. Translating that workflow requires distinguishing an
existing BMSX capability from missing presentation, and missing presentation
from a missing authored-domain contract. `cartlib` is independent gameplay
software, not a hardware specification or a mandatory Studio project format.

A gap is classified by the operation it prevents: **Studio presentation** over
an existing domain, an **authoring contract** that Studio and the cart must
agree on, or an optional **domain extension**. An absent editor is not proof
that cartlib lacks the runtime feature. Conversely, a runtime constructor is
not an editable asset schema or an isolated preview contract.

| Workflow | Existing BMSX owners | Missing capability or boundary |
| --- | --- | --- |
| Main workspace and document editors | `main_workspace.ts` owns the permanent presentation family and named-region allocation around the actual document part, with an explicitly selected Scene context as its first authored client. `services/editor/editor_parts.ts`, `editor_part.ts` and `group_arrangement.ts` compose real split groups, group-aware opening, retained-input moves and local sessions over shared documents; `editor_drop_target.ts` shares editor and whole-group insertion, split drops and explicit canvas floating through retained-input admission. | Primary recovery, navigation and project-browser session mementos are independent of document topology. Remaining output/tool activity composition must use its real owners without another group/window registry. Native host windows remain a separate host boundary. |
| Window navigation and additional views | The Window menu exposes main-workspace activation, a physical window picker, new editor windows and contribution-owned additional views. Shared window chrome exposes maximize/restore, keyboard Move/Resize through its Alt+Space system menu, and owner-admitted document minimization; document close requests go through `EditorCloseController`. | Snapping uses the shared placement/drag/keyboard contract below without moving editors or their inputs. Editor docking uses the group-transfer contract below; native host-window integration is separate. F6/Shift+F6 traverse the fixed visible outer work areas independently of local Tab, group navigation and the Window picker. Palette sizing commands address the invoking Files/Main region or document group through its retained split owner. Explicit split resize-handle entry/reset remains separate from floating-window keyboard placement. A contribution must supply a real fresh-view factory before its current subject can be opened in another window; an execution attachment cannot be copied as if it were an authored document. |
| Authored Scene work area | `cartlib/world/scene_library.lua` registers and instantiates compositions; `scene.lua` owns member spawning/disposal. Studio's `contrib/scene_editor/` retains exact declarations and full-affine source projections, with source-preserving rename, reparent, sibling order, removal and subtree operations. | A spatial authored viewport, object placement and transform gizmos need source-to-visual correspondence, asset resolution and an authoring renderer. A running frame or Actor Lab inspection is not that viewport. This is mainly Studio work over explicit domain data, not a missing Scene runtime. |
| Prefabs, objects and components | `cartlib/world/prefab.lua`, `world.lua` and `world_object.lua` provide classes, defaults, spawning and component factories. | A generic component palette and prefab editor need a contract for editable fields, component construction and visual proxies. Defaults and arbitrary Lua factories alone do not describe that editor contract. Studio adapters for known factories and cart-owned authoring metadata are possible producers; a mandatory new cartlib schema is not assumed. The read-only [runtime inspection contract](cartlib_inspection_contract.md) does not supply that authoring metadata. |
| Hierarchy and Details | Scene source projections derive selected Details facts directly from each authoring context. Independently attached hierarchy and Details controls retain their own reading state, field bindings and input scopes; Main and document compositions use those same controls. Main allocates separately resizable/toggleable side regions around its document arrangement and reveals a named region on explicit focus. Actor Lab separately inspects runtime actors/components. | The [cartlib spatial contract](cartlib_spatial_design.md) separates the admitted affine forest from component ownership, Space membership and Scene lifetime. Hierarchy, Details and the authored viewport consume one source projection; runtime hierarchy alone does not supply visual correspondence or manipulation controls. Other primary domains need their own source-backed hierarchy and editing capabilities, not a global document-selection alias. |
| Project content browser | `contrib/resources/panel/files_model.ts` retains project/shared/generated file trees. Workspace-owned `contrib/resources/content_index.ts` projects recognized Scene, BT, FSM, ActionEffect, progression, input-binding and animation occurrences over existing source/semantic owners. Files consumes these as file children; Main Scene choice consumes the same exact declarations independently of browser attachment. File/declaration activation opens its default/exact document editor; Files drags use shared group/split/floating placement. | Files presents only project content; results and ordinary Source navigation do not replace its browser-local subject or disclosure. Browser-owned source-correspondence mementos restore selection, disclosure and reading across frontend sessions independently of selecting a primary authored subject. Multiple selection, batch operations, thumbnails, richer filters, collections and cross-project migration are separate capabilities. Epic's [Content Browser](https://dev.epicgames.com/documentation/en-us/unreal-engine/content-browser-in-unreal-engine) distinguishes these operations from the level viewport. |
| Constructive authoring | Source templates create animation, sprite-animation, ActionEffect, progression, input and AEM resources. Scene and Behavior Lens edit admitted existing declarations and list members, including duplicating written BT children. | Guided creation of Scene, prefab, BT and FSM declarations, adding Scene members/FSM states and inserting BT node kinds from templates or a palette, including into empty branches, are missing Studio operations over existing cartlib domains. These require source-preserving edits and occurrence identity, but need not wait for a spatial viewport or introduce another asset format. |
| Query and output activities | Main owns an independent activity allocation and retained selector for Problems and Build Output, with separate native client families and one shared header. Problems retains resource/version-bound diagnostic selection and reading independently of native attachment. Build observations retain request results and shared captured buffers for the admitted provider; independent movable document readers own channel, selection, search and reading. Call Hierarchy owns a nonpersistent captured-query input with independent direction, lazy topology, selection and reading state. Workspace Search retains its query, explicit project/shared scope and captured file results independently of its control; canonical working copies take precedence over unopened authored text. Existing editor groups supply presentation, not Files. | Search result navigation requires correspondence with its captured source. Project replacement retires its source authority, not just its window. The whole retained activity area moves explicitly between Main and a shared floating shell; independent Build Output document readers remain separate views. Moving an individual activity to a different activity group requires its own concrete composition and is not implied by whole-area placement. Additional query/output activities must retain their real observation and source-authority owners before entering the same activity part; sharing captured buffers does not share reading state or native input authority. Build output uses a plain-text reader; interpreting terminal control/color sequences needs a separate presentation contract that preserves raw capture and clipboard integrity. A single activity registry or generic result DTO does not supply those domain lifetimes. |
| Workspace status | One shell status presentation allocates connection, window navigation, critical host/guest guidance and the actual client's retained semantic items. Shared measurement, admission priority and per-item clipping replace tool-owned status coordinates. Full values retain native reading/copy access independently of truncation. | User-customized visibility, ordering and persistent preferences belong to the later settings contract, not a new status plugin registry. |
| Content lifecycle and dependencies | Resource navigation, folder/source creation, file import, source-symbol references, canonical model editing, individual/workspace Save and scoped document-close operations exist. Files combines lazy physical project-directory observations with semantic source entries; raw files and empty folders do not require fake source resources. Folder-context creation retains its captured destination independently of the active document. Save All accepts the invoking draft and enumerates dirty canonical working copies independently of document views or Main; persistence does not apply a runtime revision. | Rename/move/duplicate/delete and folder relocation/removal need coordinated physical-address, authored-membership, document, recovery and reference lifetimes. Directory inventory is not source retirement: deleting bytes must not resurrect old authored paths from packaged source on reopen. Raw files without an admitted editor remain inventory entries, not invented editable assets. Asset dependencies/used-by and reference repair need domain-aware source relationships, not string replacement or an assumption that Lua symbol references cover asset IDs. These are more basic Studio gaps than collections or cross-project migration. VS Code's [file actions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts) and Epic's [Reference Viewer](https://dev.epicgames.com/documentation/en-us/unreal-engine/reference-viewer-in-unreal-engine) expose these as distinct operations. |
| Project/session entry | Project creation, Build Jobs, admitted source contexts and workspace recovery already have owners. | Selecting/opening/replacing a project in the frontend and starting without an execution target remain distinct lifecycle capabilities. Creating a cartridge or building it must not silently substitute for attaching its source workspace. The existing source-admission boundary, not an installed socket, owns that identity. |
| BT, FSM and action effects | `cartlib/behaviour_tree/`, `cartlib/fsm/` and `cartlib/actioneffects.lua` provide domains; Behavior Lens has source-derived graphs, editing and runtime inspection. Project file children open their exact authored occurrences. | Constructive authoring remains separate from discovery. A missing operation is not a reason to introduce a competing behavior format. |
| Graph camera and split presentation | `WorkbenchGraphViewport` owns responsive Fit and explicit graph-space reading center/scale. Authored BT/FSM and live FSM share native Fit/Frame Selection/zoom commands; source selection remains separate. Camera intent survives allocation changes, pending asynchronous geometry and view/history restoration. | Fit uses the supported overview range without inventing readable space for arbitrarily large diagrams. A minimap, richer graph navigation and domain-specific layout operations remain separate presentation capabilities, not cartlib or source-lifetime rules. |
| Input and progression | `cartlib/input/` provides action/state programs and ActionEffect bindings; `cartlib/progression.lua` owns progression rules. `contrib/lua_program/` edits written program tables and inspects explicitly selected live instances. | Project file children expose these authored programs alongside BT/FSM/effects. Input binding authoring is distinct from Studio keyboard preferences and player-facing rebinding; neither is supplied by the settings UI. |
| Cart maps | `contrib/cart_maps/` edits canonical YAML room objects and stage markers through explicit Pietious and Nemesis source adapters. | This is not a generic tilemap/level format or a spatial Scene editor. Supporting another cart requires its authored-data association and edit operations; sharing grid interaction alone does not establish a common cartlib map domain. |
| Animation | Timeline programs, seek/scrub and sprite animation have cartlib owners. `contrib/animation/` edits tracks, keys, curves, clips and frames; `frame_preview.ts` displays the selected sprite image. | An isolated authored playback/scrub preview still needs an explicit subject, property bindings, clock and side-effect policy. A selected image is not animation playback, and runtime seek alone does not supply that preview. Skeletal hierarchies and retargeting are separate optional domain extensions, not prerequisites for this nearer Studio gap. Epic's [animation editors](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-editors-in-unreal-engine) distinguish preview-subject selection from timeline editing. |
| Audio | `cartlib/aem.lua` and `apu.lua` support event-driven audio; `contrib/aem/` edits canonical maps, rules/actions and transitions, with explicit installed-target application and Actor Lab event audition. | Standalone waveform/asset audition needs a Studio preview owner. A graph projection of existing AEM actions would be Studio presentation; a signal-flow mixer/submix graph would require a separately agreed domain and execution contract. Neither follows from drawing nodes, and lack of a graph does not mean event-driven audio is missing. |
| Play/debug/edit correspondence | Isolated Play, Scenario Lab, Source breakpoints, Actor/GPU/GTE/Event tools, replay and explicit Hot Resume already exist. World/Scene retain definition, Scene and authored member identity for Scene-spawned objects. Scene Main contributes Run Project through its retained canonical file's source context and an explicit installed attachment choice, including when the Scene occurrence is unavailable but the file remains admitted. | “Play this authored Scene” needs an authored launch contract. Other primary domains must declare their own runnable-file/project capabilities; working-copy enumeration or Source navigation does not grant launch authority over a document behind them. Applying runtime transforms back to source still needs the exact source occurrence, property/override correspondence and normal source edits; procedural objects need not have an authored member. Retained runtime IDs alone do not supply writeback. Epic's [PIE/SIE workflow](https://dev.epicgames.com/documentation/unreal-engine/ineditor-testing-play-and-simulate-in-unreal-engine) is a comparison, not permission to reconstruct authored data from runtime state. |
| Source control and comparison | Working-copy dirty state, Undo/Redo, Save conflicts, recovery and proposed-edit review with before/after hunks have existing owners. | Repository status/history, staging/commit and general file/revision comparison and merge are separate Studio/host workflows. Proposal review is not version control, and rejecting a stale Save is not a conflict-resolution editor. VS Code's [SCM contribution](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scm.contribution.ts) separates that workspace activity from document editing; adopting it would not require a cartlib feature. |
| Contextual UI commands | Shared context menus, command registration and captured invocation contexts serve window chrome, exact editor tabs, group backgrounds, Files rows and contribution subjects. Scene outlines and Actor outlines/live graphs expose their existing subject actions through both pointer and keyboard context menus. The tab list has individual keyboard focus, independently of its group-action toolbar. | Coverage of other tool surfaces remains a separate UX task. Right-click and keyboard Context Menu expose owner-admitted actions without duplicating command state or borrowing the later active editor. |
| Editor/project settings | Theme/font commands, session placement and source-backed cart configuration exist at separate owners. | A searchable settings model and UI with explicit defaults, scopes and persistence are missing. Editor preferences are not gameplay configuration. Go to File needs a configurable project-only versus BIOS/shared-library inclusion policy based on admitted provenance; folder-name guesses and isolated tool toggles are not a settings system. |
| Region placement and layout recovery | Main Hierarchy and Details retain their own controls and move independently between their named allocation and a shared floating window. Main owns region membership and recovery; the window container owns physical placement and chrome. Reset Layout restores allocation and window defaults over the retained working set. | Joining document groups or gathering document windows into Main is a separate membership operation, not an implicit side effect of resetting geometry. Saved user layout presets remain a separate product choice. |

This mapping records prerequisites and product choices, not approval to build
every missing Unreal subsystem. Complete the main/document workspace using
existing source and execution owners first. Spatial authoring, project entry,
thumbnail/collection browsing and other domain extensions are separately admitted
work. Unified settings follow that workspace work; [VS Code's user/workspace
settings](https://code.visualstudio.com/docs/configure/settings) provide a scope
and discovery reference without requiring a new mandatory cartridge manifest.

Missing preview or domain operations remain explicit capability gaps, not a
running game frame, generic table dump or empty editor window presented as an
authoring feature. The composition below gives existing operations distinct
owners without requiring every missing Unreal subsystem.

## Owners and representations

| Owner | Retained state and responsibility |
| --- | --- |
| Attached workspace | Source/file authority, admitted resource catalog, working copies, semantic caches, Save, recovery and navigation. Execution attachments consume these owners; they do not supply authoring identity. |
| Domain model and projection | Canonical data and source/inspection facts in their own representations: text models and semantic generations, authored topology, physical histories and captured observations. Shared projections follow their producer's identity and invalidation, not whichever container is visible. |
| Retained work context | Exact authored subject, query or inspection session, its meaningful selection, source/session correspondence, availability and working-copy participation where applicable. A concrete input may own that work when their lifetimes intentionally coincide; control detachment and window/group placement do not redefine it. |
| Attached control | Concrete focus/native input, layout, scrolling, gestures, drafts and transient command authority. Coordinated controls bind a work context; presentation mementos can survive detachment without keeping the old control authority alive. |
| Frontend editor-parts owner | Permanent main part, floating-part membership, document-part activation/MRU and destination routing. Derives workspace-wide group/input enumeration from actual membership; a retained active group is not the primary authored context. |
| Permanent shell | Project navigation, workspace-wide Open Editors, menu and status outside the overlapping editor-host area. It is not the surface raised when an editor gains focus. |
| Main workspace composition (target) | Frontend-owned allocation and attachment of project content, primary authoring client, contextual hierarchy/Details, Main's document arrangement and output/tool presentations. It composes actual controllers and shared surfaces; it owns no duplicate source/domain services. |
| Primary authored context (target) | The retained work context explicitly selected for Main, independent of secondary document activation and physical execution. Its lifetime ends on admitted replacement/clear or workspace retirement. |
| Contextual hierarchy/Details (target) | Coordinated controls over the primary work context's projection and semantic selection, not separate subject owners or duplicate working-copy consumers. |
| Project content | Existing file/catalog and declaration projections, with browser-local selection/disclosure. Hiding its presentation retains browsing state; another activity does not replace its content identity. |
| Main editor part | A permanent arrangement of ordinary document/asset editor groups within Main's presentation family. Closing or changing its tabs does not replace the primary authored context. |
| Editor part | Group membership/arrangement, local active group, client bounds and local focus/capture scope. Main and floating parts use the same group composition; only host presentation differs. |
| Editor-group arrangement | Retained group leaves and horizontal/vertical split branches, requested proportions, minimum extents and published leaf bounds. It owns topology, not editor subjects or source data. |
| Editor group | Ordered inputs, active/preview input, pane instances, tab chrome, group focus/capture scope and outstanding editor-opening lifetime. Each concurrently visible group has its own panes and controls. |
| Editor input/view | Document presentation identity and retention of its work context, with contribution-owned reading mementos. A move transfers this view; an explicit independent view gets its own context/selection over the same domain data. |
| Working copy | Authored text, dirty state, versions and Undo/Redo for one admitted resource identity. Views of that same identity share this owner. |
| Surface/window owner | Paint order, placement, clipping, chrome and input admission. It does not own the document or choose a physical execution target. |
| Output/tool activity | Its build/log, diagnostic, terminal, inspection or preview subject and lifetime at the existing activity owner. Presentation may be an editor, panel or owned window without replacing the primary authored context. |
| Workbench navigation | One Back/Forward history of concrete destinations and contribution-owned selections, including the destination part. Creating or disposing a part does not reset unrelated history. |

The boundaries are **domain model/projection → retained work context → attached
controls → container**. This lifetime and ownership contract applies to Source,
authored tools and runtime inspection alike; it is not a proposed generic
subject/selection type, context base class or registry. Domain-specific owners
keep their real representations. Shared capabilities are introduced where a
consumer needs them: working-copy participation serves Save/final-consumer
close, while existing `InputEdit`, `InputInteraction` and `InputFocusScope`
serve field drafts, logical runtime intent and control-attachment authority.

Controls coordinated by one context share its semantic selection: Main's
hierarchy and Details act on the same exact member, and an Actor inspector's
controls act on its retained target. Independent Source, Scene or Behavior views
have independent contexts/selections even when their working copies match.
Independent GPU/GTE observations can retain different captured operations from
the same physical history. A Play context retains its admitted handle, not a
source-file identity. Neither common placement nor common data joins selections
or grants another context's source/session authority.

All parts in a frontend share its workspace services. A group is not a window:
several groups can be arranged within a part, and the layout owner supplies their
bounds. Reusing a pane within one group does not make that pane reusable by two
simultaneously visible groups.

An auxiliary editor is not another `RuntimeIdeState`, `StudioWorkbench`, native
Studio session or source authority. Closing it retires its controls and views,
not those shared owners.
Source-access and review capabilities belong to the attachment/session. Creating
or focusing another editor window cannot grant permission to edit or Save.

## Primary authored context and workspace regions

The main workspace composition belongs at the frontend composition boundary
alongside `RuntimeCartEditor`, not in the viewless `StudioWorkbench` or an
individual tool pane. It owns real region allocation, attachment and teardown.
Its retained authored-state owner and frontend region controls have distinct
responsibilities; they are not another feature-state collection inside
`RuntimeCartEditor`. Existing `WorkbenchMainAreaLayout` allocates document
groups and the Game companion, not this broader authored composition. Parent
allocation supplies actual child bounds before those existing clients arrange.
`EditorParts.main` continues to own its document groups; it is not replaced by
a second group registry, and it is not the primary authored subject. Main's
primary and document clients share one ordered presentation family rather than
two overlapping Main windows. Existing surface, layout, focus and capture
owners arrange and admit their actual controls.

Project content remains a workspace-level entry to admitted files and authored
declarations, reachable while a document host is foreground. A contextual tool
such as Call Hierarchy owns its own result presentation; it does not replace
the retained project browser. A narrow layout may expose a drawer instead of
an expanded region. Hiding a region retains its subject and reading state but
does not preserve unavailable control input or field-draft authority.

The primary client presents an explicitly chosen authored subject. Its
hierarchy and Details are coordinated views of that context, not global tools
that borrow the selected row from the active document. Secondary document and
asset editors retain their own subjects, selections and contextual controls,
even when they edit the same canonical text. Output/tools likewise retain
their activity subject. Opening a build result, selecting a diagnostic, or
focusing a BT editor never selects a different primary subject as a side effect.
Source navigation can open an independent document without replacing Main.

### Subject, selection and source generations

A primary subject identifies an admitted resource `(contextId, path)`, its
domain kind and the exact authored occurrence supplied by that domain's source
owner. A filename, Scene label, tab id, runtime object or browser row is not
that identity. Multiple declarations in one Lua file remain distinct subjects.
The context retains its working copies and source correspondence, not another
authored data model. Existing catalog, semantic and source-projection owners
remain shared and generation-cached.

Hierarchy, primary-client interaction and Details publish semantic selection
through the primary context: for example, an exact Scene member occurrence.
Files selection, document activation, keyboard focus, command invocation and
explicit run-target selection remain separate states.

Occurrence references are tracked through canonical edits by their source
owner. An AST node, range or projected property belongs to the source generation
that produced it. Commands retain the exact subject/selection and resolve its
surviving correspondence after draft publication; they never apply stale AST
coordinates to a newer model. Imported or multi-source subjects also retain
their actual dependency generations. Unchanged frames reuse those projections,
rather than querying all resources or re-parsing once per region.

Navigation records a primary-context destination separately from a document
input destination. Returning to the former uses primary-subject admission and
its exact contribution-owned selection, not a Scene tab lookup. Ordinary
document history does not replace Main's context. Both use the existing
workspace navigation owner rather than separate histories.

### Admission, replacement and unavailability

The context distinguishes **unbound**, **available** and **Unavailable**. Unbound
means no primary subject was selected. Unavailable retains the exact selected
subject reference whose source context, occurrence or required projection is
no longer available. A missing member clears that sub-selection; a missing
primary declaration makes the primary context Unavailable. Neither binds a
namesake, next row, first Scene, Home or runtime image. Source navigation may
remain available for a surviving resource. Explicit re-selection can admit a
restored occurrence; Undo does not revive retired control or command authority.

Choosing a subject for Main is distinct from ordinary file/declaration opening.
Project content and supported document contributions expose an explicit action
for it, enabled only when the domain can supply a real authored client. The
request retains its exact source subject, destination context and request
lifetime. Its completion cannot replace a newer admitted selection or acquire
focus from an unrelated later interaction.

Before changing primary subject or sub-selection, the outgoing control settles
its draft through its existing accept/cancel contract. Accepted edits publish
to canonical models before the domain resolves the requested surviving
occurrence and new contextual bindings. Refused settlement leaves the old
selection and bindings intact. Subject replacement/clear also passes any final
working-copy release through ordinary Save/Discard/Cancel admission. A failed
or superseded request does not roll back edits or Saves already accepted.
Only the admitted replacement retires the old context's controls, popups,
gestures and captured command subjects. Source/authority retirement instead
revokes invalid drafts and actions immediately; no stale edit is applied to
another occurrence or revived on returning space or rights.

### Region placement

Hierarchy and Details each retain their named dock allocation and their own
floating placement. Main's region owner moves the same native subtree; the
primary context, content controls, selection, canonical source and working-copy
consumer remain unchanged. The shared window titlebar replaces the embedded
panel header. Feature and placement actions compose with the ordinary window
system menu; they remain available through keyboard context menus and the
palette without a duplicate toolbar or a fabricated document input.

Float and return-to-Main change presentation, not authored values. A focused
body control keeps its exact pending draft, including invalid input; a real
focus departure follows that control's ordinary blur policy. Close hides the
region in its current placement. Minimize retains its discoverable window;
Focus or Show restores that same presentation. Hidden/minimized input retires
through the existing region attachment contract. Both region windows belong
to the primary modal family, independently of their source-command context.

The first floating placement uses the current dock allocation as its anchor
and the content's font-derived preferred/minimum extents. Subsequent placement
retains its own requested bounds, snap/maximize state and minimization,
independently of dock width and visibility. Recovery restores this intent
separately from the primary subject and never replaces newer user placement
or focus. Binding a different primary client retires old shell invocations;
it does not create another semantic selection or another window registry.

### Reset Layout

**Workspace: Reset Layout** restores the workbench's requested presentation over
the current working set. It leaves document parts, group topology, tab order,
active inputs, preview/pin state, canonical models, primary/activity subjects and
working-copy history intact. Separate views of the same source remain separate
views. This is neither workspace replacement nor a join-all-editors operation.

The baseline is explicit:

- Hierarchy and Details return to Main and are shown when a primary subject is
  bound. Their width requests and Main's allocation scroll return to defaults.
- The selected activity returns to its bottom allocation with default height.
  Its selected client and open/closed intent survive; no other activity is opened.
- Files returns to its default width without changing visibility, filter,
  directory expansion, selection or reading position. The Game companion's split
  returns to its default without changing whether the companion is requested.
- Each existing editor part retains its group tree. Split preferences return to
  their defaults and group maximization/arrangement overflow scroll are cleared.
  Existing document windows become normal and non-minimized in the same default
  cascade used for new document windows. Their memberships and MRU are unchanged.
- Retained utility windows request a fresh owner-produced default placement.
  Closed utilities stay closed. Inactive tabs retain this request until their
  real content owner is attached; reset does not instantiate hidden panes.

The window model distinguishes a pending default request from produced requested
bounds. Each contribution computes its actual default from current font, work
area and content measurements, using the same producer as first presentation.
The shared window container ends its own chrome gesture; the contribution still
owns its subject, lock, observed data and client controls. Constructor zero bounds
are not a placement policy, and font-cache validity does not imply that pending
placement has been produced.

A retained body keeps its concrete focus and unpublished draft during a pure
layout operation. If a floating titlebar disappears, focus returns to that
region's retained control. Ordinary Palette/menu focus departure follows the
control's existing edit admission; reset does not add an implicit Save or commit.
Only native geometry interactions are cancelled. Newer focus and placement
intent supersede older recovery work, without discarding its recovered subject.
Tool zoom, timeline/frame selection and document content scroll are not workbench
allocation and remain unchanged.

### First authored consumer

Existing Scene membership/property authoring is a concrete first consumer:
choose one source declaration, present its admitted member composition, select
an exact member, and edit written position/options or membership order through
canonical source edits. These are real operations already represented by the
Scene source/domain owners. Their projection and edit logic can serve both
Main and independent Scene documents; their selections and controls cannot be
the same retained `SceneEditorInput` or pane.

This consumer establishes primary-context, selection, Details and lifetime
contracts without pretending to be a spatial level editor. A spatial viewport
requires the source-to-visual, asset-resolution and authoring-render contract
listed above. Another primary domain must supply its own authored subject,
selection and editing capabilities. The workspace does not switch on Scene,
BT or another editor kind to fabricate a layout, and unsupported domains keep
their ordinary editors rather than receiving empty universal toolkit frames.
This is not an instruction to build a docking/plugin framework before a real
consumer, or to wrap group-bound tools in cosmetic forwarding hosts.

## Editor arrangement and docking

A part owns a retained tree whose leaves are real `EditorGroupView` instances
and whose branches split available client space horizontally or vertically.
Each group owns its tab model, pane cache, controls and opening lifetime. The
arrangement owns no substitute tab model or document registry. Its topology
changes on explicit split, merge, dock and group-removal operations, not during
painting. Group enumeration and the group-to-part mapping follow this membership.

Every retained part has at least one actual group and an actual active group.
Removing or floating its last group publishes a new empty leaf at the source;
it never leaves a retained Main or floating part without a routing destination.
Close Group on the final leaf closes its inputs through ordinary close admission
and retains that empty group. Closing a floating host is a separate Close Window
operation; Main closes only with the frontend/workspace. Removing a nonfinal
leaf selects a surviving group in local activation order. The arrangement owner
promotes a split's sole remaining child rather than retaining empty branches.

The arrangement belongs under `services/editor/`; the existing
`ui/split_view.ts`, `split_control.ts` and split renderer own reusable sash
geometry, capture and keyboard resizing. Extend that geometry owner where
nested minimum extents require it; a feature must not invent another sash,
fixed editor width or special Scene/Source arrangement. Requested proportions
survive work-area and font changes. Leaf minima come from actual chrome and
content constraints, rather than an arbitrary number of character columns.
Aggregate minima are computed bottom-up: child extents plus reserved sash space
are summed along the split axis, and their maximum is used orthogonally. The
root logical extent in each axis is the larger of its viewport and aggregate
minimum. Each sash therefore receives a feasible interval; an interval with
no remaining movement disables resizing that sash without changing topology.
When the host is smaller than the arrangement's aggregate minimum extents,
the arrangement retains those minima and exposes a scrollable layout viewport.
It never feeds contradictory min/max bounds into the two-pane sash primitive.
This overflow belongs to the arrangement, not an individual Source/Scene pane;
it reuses the shared scrollbar/input machinery. Presented leaf bounds and clips
include that viewport translation. Explicit group activation reveals its leaf
before native input or focus enters it. Requested proportions remain separate
from this constrained geometry and survive enlargement and font changes.

This follows the distinction between content extent and viewport extent in
[VS Code's SplitView](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/splitview/splitview.ts),
whose child minima and scrolling are layout-owned. Group maximize/restore and
group navigation remain explicit alternatives to scrolling; a narrow work area
does not silently close, float or merge editors.

| Operation | Membership and presentation contract |
| --- | --- |
| Open | Resolve an exact subject and activate its chosen group; no new floating host by default. |
| Split | Add a real neighboring group in the same part. An independent view requires the contribution's existing fresh-view capability. |
| Open to Side | Admit the intended subject in a neighboring group of the invoking part, reusing that neighbor or creating it when absent. |
| Move Editor | Transfer the retained input to an explicit group; canonical source and view state are not reconstructed. |
| Merge / Dock | Insert tabs into an existing group, or attach a group beside it in the destination arrangement. The destination's published drop zone chooses merge versus split. |
| Float | Explicitly transfer an editor or group into a floating part using the same input/group admission. |
| Snap / Window Maximize | Change floating-host placement only; no change to group topology or membership. |
| Maximize Group | Temporarily present one leaf within its existing part; restoring exposes the retained arrangement. Explicit reveal of a hidden sibling restores that arrangement before focus. This is not floating or window minimization. |

Tab dragging uses one shared transfer gesture. A single-tab group is draggable.
The target describes insertion into a tabstrip, splitting at a group edge or
explicit floating; the preview represents that actual membership result.
Every location, including the source strip, is resolved from the surface owner's
actual top hit and presentation ancestry. A covering inspector, popup or modal
is not a path through to a group below it; lifetime ancestry is not drop ancestry.
The last physical release resolves that location again. No eligible target means
no membership change, not implicit floating. Explicit Alt-drag requests floating
within Studio's canvas work area; it does not create a native host window. This
adapts VS Code's Alt-enabled new-window operation to the existing canvas window
owner. Preview and committed placement consume the same layout constraints.
Primary dragging unused tabstrip space moves the whole group; dragging a tab
moves that editor. `Move Group To…` exposes merge, directional placement and a
new floating host through the Window menu and Command Palette, including when
the strip has no unused space. Window-title gestures change host placement,
not the membership of whichever group happens to be active.
Pointer release and the equivalent keyboard command enter the same transfer
admission. Whole-group transfer admits all affected inputs, drafts and any
coalesced receivers before changing membership; publication exposes the completed
source/destination topology and active groups, not a sequence of half-moves.
Cancel leaves topology and source unchanged. A move does not invoke
an additional-view factory or serialize/reopen its input.

Files contributes a prospective opening, not a retained editor or group transfer.
Its source is an exact admitted resource or authored occurrence. Press selects
the row; release without a drag performs its ordinary opening with the captured
invoking group, unless a newer foreground interaction has taken over. Crossing the drag
threshold publishes feedback, without resolving an input or creating a group.
The same physical drop target supplies tab insertion, center opening, edge split
and explicit Alt-floating. Unresolved openings use the group chrome's intrinsic
minimum and the window owner's new-document extent, not another editor's bounds.
An explicit drop addresses that exact receiver rather than following editor MRU
affinity. Files resolves the file's registered editor or the declaration's own
contribution; the placement owner does not classify source syntax.

An accepted drop keeps the captured source authority alive through resolution
and group admission. The destination owns draft publication, opening generation,
coalescence, navigation and focus. Resolution precedes publication of a new
split or floating host. Abandoning an unpublished receiver disposes its own
construction, not an existing editor. Source retirement, Escape or loss of
capture cancels the hold; its later release cannot become a click or opening.
Dropped inputs are kept open. A matching retained receiver preserves its tab
position; a new input consumes the advertised insertion gap at the tab-model
owner. Moving retained inputs remains a separate operation over the same target
geometry.

Moving a leaf within the same part rearranges its existing group instance;
its group lifetime and pending openings remain valid. Cross-part group transfer
constructs a new concrete `EditorGroupView` in the destination part and transfers
the retained inputs and their ordered tab/active/preview/pin state through the
owning tab models. Canonical working copies and input/view identities survive;
the old tab model need not survive. Merging preserves an existing receiver's
preview/pin state; its preview wins a conflict with an incoming preview. An empty
source adds no editor-selection intent. A nonempty group with no selected input
retains that explicit selection state rather than choosing a substitute.
Home is portable read-only workspace content; matching Home views coalesce by
their admitted namespace while retaining the receiver's view state.
The old pane detaches before the receiving
pane binds those inputs. This is not reparenting a fixed focus/surface scope or
copying the inputs through storage.

Retiring the old cross-part group revokes its pending openings, pickers, popups,
native input and command-origin scopes. Those capabilities never follow the
retained input into its receiving group. Navigation entries for actually moved
views are retargeted to that concrete receiving group/part; destinations for
other retired group content end with the old scope. Unrelated later focus wins
over transfer completion. Placement reveals the receiving leaf independently
of keyboard focus. Moving the last Main group leaves a fresh empty routing leaf;
moving a floating host's final group retires that host after history handoff. Same-part arrangement changes and cross-part lifetime
changes are distinct operations, even when their drop previews look similar.

## Composition and lifetime

The frontend composes the primary authored client, contextual regions and real
editor parts over one shared workspace. Main workspace composition owns their
allocation, not their domain services. The editor-parts owner retains actual
part/group membership and document activation; each part owns its arrangement,
retained client bounds, surfaces and focus/capture ancestry. Its local active
group is distinct from primary-context selection and the frontend's activated
control.
The flattened group enumeration used by close and document operations is
derived from that membership, not a separately mutable second registry.

A group supplies its actual group, focus scope and content surface to its pane
factories. The pane cache remains group-local and lazy by editor kind. Source,
Scene, Behavior Lens and the other contributions receive that group's real
controls and opening destination; no factory closes over a primary-group alias.
Workspace caches and document projections stay at their existing shared owners.
Each part retains its group's inputs independently of another part's active tab
and Main's authored subject. Part activation selects its actual active group,
not a primary-group alias. Inputs retain their contexts; controls bind those
contexts rather than obtaining domain state through a container. A primary
client has its own admitted context and actual controls, not a hidden group input
or a pane borrowed from a document group.

Detaching or rebinding a control retires its gestures, popups, native input and
invocation scopes before another context can bind. Pending drafts follow the
actual control's accept/cancel contract, not a context-wide success stub. The
retained subject, semantic selection and domain lease survive according to their own
owners. A source edit invalidates the relevant source generation; guest
execution releases borrowed rows; target replacement retires that target's
authority. These are different events, not a universal reset on tab/window
change. Retaining a context or restoring an inert memento never revives the
old control's commands, source coordinates or guest-input authorization.

Composition follows a concrete ownership order:

1. Attach admitted sources and shared services; recover canonical dirty models
   once before resolving either the primary context or document inputs.
2. Construct Main's workspace composition and permanent document part, then
   restored floating parts. Resolve the recorded primary subject through its
   domain/source owner, or retain its unbound/Unavailable state. Construct
   the corresponding retained contexts and independent views before binding
   contextual controls over the recovered models.
3. Attach project content, primary/contextual regions, group controls and
   activity presentations within their actual surface and focus ancestry.
   Publish allocation and presentation activation only after their destinations
   exist. Attachment/restored focus grants no guest input or execution action.
4. On a document-part close request, pass that part's actual group/input set to
   the shared close owner. Keep the part until close admission completes; Cancel
   leaves it available. Successful close retires its openings, controls,
   popups, navigation destinations, surfaces and part membership in owner order.
5. Workspace teardown first publishes terminal frontend admission and retires
   native controls, popups and pending presentation requests synchronously.
   Retained primary/document contexts and canonical models remain available
   while accepted operations drain and final recovery is written. That checkpoint
   precedes disposal of retained contexts, models, source authority and recovery
   bindings. Repeated or reentrant shutdown joins that same operation; editor
   activation cannot resume it. Project replacement uses that boundary; adding
   a project picker is a separate capability.

Each part arranges its groups within layout-owned bounds. Paint/input traversal
uses the shared surface owner; controls consume their group's retained client
rectangle. Drawing another part never swaps global editor bounds, focus or
source state. Layout and activation invalidate their owning projections; a
stationary frame does not rebuild pane factories, enumerate source registries
or reconstruct window state.

Projection sharing follows representation, not a universal document wrapper.
Code's canonical model/semantic facts are shared; `CodeDocumentProjections`
shares frontend token colors and font-generation measurements, not authored
topology. Behavior/Scene source documents share semantic topology. Runtime
histories and copied GPU/GTE observations retain physical-target and capture
generations. Context-local filtering or graph geometry is not canonical data.
Source inputs retain wrapping and reading preferences; attached controls derive
visual rows and hit testing and own completion/ghost text and local Find/Rename
interaction. New Source views start without automatic wrapping, preserving authored
rows and horizontal reading. Explicit wrapping retains measured continuation
indentation where the available text budget permits it; resizing does not change
the chosen wrap mode or insert source whitespace. Preferred visual-x intent belongs
to the attached control's current font/wrap projection, not its retained view
memento. An unchanged second view reuses
appropriate source/index/measurement generations instead of parsing, coloring
or measuring the same source again per window.

## Identity and admission

The attachment/recovery namespace, authored location, resource context, editor
view and physical target are distinct identities:

- The attached workspace's namespace is selected at attachment, not by the last
  focused tab or the CPU's current cartridge socket.
- Resource identity is a workspace-admitted **source context plus logical
  resource path**. A source context is an admitted source/module/asset-resolution
  namespace: entry/source sets, dependency bindings and generated symbols. Its
  stable admission identity belongs to workspace attachment metadata, not to an
  executing socket, build output, source-kind label or filesystem deduplication.
  Identical configuration values can still describe distinct admitted contexts.
  `RuntimeResource.location` describes project/shared/generated provenance.
  Content browsers consume that producer-owned provenance; folder names and
  socket numbers do not establish project membership.
- A shared provenance path can intentionally have distinct BIOS/cartridge
  resource contexts and working copies. This design shares models for the
  **same admitted resource identity**; it does not merge them by filesystem path.
  Restorable context identity comes from its owning workspace/project
  admission/configuration, rather than a process handle or the installed slot.
  Text edits, debug/optimized builds and socket relocation change generations or
  execution attachments, not that identity. Existing tooling does not provide a
  universal configuration key; publishing/persisting this identity is a central
  admission-producer requirement, not a new mandatory project manifest.
- FSM/BT/effect views identify the canonical model, declaration occurrence and
  kind. Semantic names are labels, not substitutes for occurrence identity.
  The primary authored context likewise retains an exact declaration and
  contribution-owned sub-selection, independently of a Scene or other document
  view. Occurrence deletion follows the unavailability contract above.
- A runtime subject belongs to its explicit target/session and current
  heap/media/history lifetime. Domain numbers and object hashes can repeat in
  the authoring machine, Play and test targets. They cannot identify an authored
  asset or be restored as if they did.

Project navigation retains real files and folders rather than replacing them
with a separate asset database. A file's disclosure opens its recognized authored
children; activating the file body or pressing Enter on the file still uses its
registered default editor. A declaration has a kind icon and its own source
occurrence, independent of the active editor. Declaration activation uses the
same exact-view lookup and group-routing contract as file activation. The
separate primary-subject action admits a context, not a document destination.
The domain controller resolves the subject; ordinary editor kind never implies
a hardcoded Main/floating destination.
Reopening preserves the retained view's subject, selection and reading position.

The content index consumes existing semantic/source projections without running
Lua or opening every canonical working copy. Canonical text changes map the
retained occurrence ranges; deletion or complete replacement retires them.
Undo can restore source without reviving a retired navigation capability.
Provider and semantic-project lifetime changes invalidate the projection even
when a consuming file's text is unchanged. Imported animation tables retain
separate data ownership, discovery context and consuming-source provenance.
The browser places a consumer-specific animation at that consuming file; a raw
export remains at its data-owning file. Captions never establish identity.

Files persists its own visibility, filter, requested width, native focus intent,
disclosure, selection and horizontal/vertical reading independently of Main's
primary context and document groups. Root and directory references retain their
admitted context and project/shared/generated provenance; files use resource
identity. A declaration additionally records its discovery context, authored
owner, consuming browser source, source fingerprints and exact occurrence range.
The content index resolves those references without opening working copies.

Recovery admits the browser request before dirty-source hydration, synchronizes
the authoritative producers afterward and applies the memento once. Unmatched
nodes keep their normal disclosure defaults. A missing or changed declaration
leaves no selected subject; its name, old offsets or containing file are not
substitutes. The saved selection does not force expansion or reveal: the user
may have deliberately scrolled elsewhere. Hidden reading remains inert until
allocation is available. New browser interaction supersedes pending recovery;
later semantic publication cannot steal that newer selection or reading.
An explicitly queued file reveal is a different operation: changing the filter
can make its file eligible, whereas newer subject/reading navigation retires it.

Only committed browser mutations request its autosave category. Unchanged
mementos retain object identity, and browser-only writes reuse independent source,
Main, document and breakpoint snapshots. A new request raised during snapshot
publication remains pending for its own generation. This follows VS Code's
[Explorer-owned tree persistence](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/contrib/files/browser/views/explorerView.ts)
and identity-based tree restoration, without copying its active-editor auto-reveal
policy or introducing a versioned workspace format.

Runtime tool inputs identify retained view sessions, not just a tool kind or a
physical target. Two GPU/GTE views can hold different observations from the same
history, including evidence that has expired from its rolling buffer. Their
view identities remain distinct when moved into one group. Ordinary tool open
reuses the invoking group's active matching view, then another view of that
same history; it does not merge two retained sessions. The same separation
applies to independent event readers and Game clients over one primary target.

The source catalog and canonical models use `(contextId, path)`. Physical
system/cartridge domain numbers belong to execution attachments, never resource
identity. The concrete loaded-project admission producer supplies authoring
seeds separately from its installed images. Additional source-only contexts
retain the same document, semantic, Save and recovery owners without requiring
an installed ROM. This boundary does not itself implement project selection or
target-free frontend startup.

An execution attachment maps its installed domains to admitted source contexts
through actual image/build provenance, including the exact installed source
generation. Context correspondence does not certify that today's unsaved text
is executing. Module and asset resolution consume their context's admitted
bindings instead of selecting packages through a physical socket or recreating
local-domain/BIOS lookup heuristics in features. Authoring owners can exist
without that attachment. Existing boot, debugger, Play and test owners retain
physical-target and installed-source lifetimes; they are not duplicated inside
editor parts.

Save locations and capabilities are producer-owned data separate from model
identity. Distinct contexts writing the same file retain distinct dirty buffers
and the existing expected-baseline conflict boundary; Save does not merge them
or mark another buffer saved. Recovery keys context/path inside the frontend's
workspace/session namespace, not the currently installed socket. All auxiliary
parts use those records once through the same authoring owners.

Project selection is a workspace-attachment operation. It resolves source
contexts and recovery namespaces, settles the old workspace's dirty/review and
operation lifetimes, and then replaces that attachment. It neither installs
media nor runs a program as an incidental side effect. The loaded-project
catalog is a concrete initial producer, not the architecture's project limit.

## Opening, activation and commands

Document opening resolves the canonical working copy and exact
contribution/subject.
Matching views deduplicate **within a group**, not across all parts. The retained
input object is the live view identity; its group membership identifies where
it is presented. A resource/subject matching key is not a workspace-global view
identifier. This needs no second UUID registry. An ordinary move transfers that
same input; close/reopen creates a new input. Coalescing preserves the destination
input and retires the departing one.

Ordinary open routing is deterministic:

1. An explicit destination group wins and reuses its matching view there.
2. Otherwise prefer an exact matching view in the invoking group, then the most
   recently activated matching view across actual groups/parts. Contribution
   owners determine exact subject equality; captions, filenames and kind alone
   do not establish a match.
3. With no match, use the invoking group, or the captured active part's active
   group when the invocation has no group. Project-browser and menu focus do not
   silently choose another group. Main's initial group is the startup destination;
   an ordinary open never needs to create a floating part.
4. Open to Side, New Window and an explicit additional view name another
   destination. Additional views use the contribution's fresh-view capability;
   moving transfers the existing input instead of copying it.

Open to Side bypasses ordinary existing-view affinity: a matching editor in
another host does not change the captured invoking group. The arrangement owns
directional adjacency; when several groups share the requested edge, their
part's activation order chooses the receiver. There is no wrap at the outer
edge and no neighbor in an overlapping floating host. The operation restores
a maximized group arrangement before resolving the neighbor, so retained hidden
groups are reused rather than duplicated. Side-group creation is an accepted
layout operation, not a transaction around subsequent asynchronous loading.
Opening or cancelling its menu changes no topology. This follows the separation
between explicit side placement and ordinary affinity in
[VS Code's editor-group finder](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/editor/common/editorGroupFinder.ts)
and its
[part-owned directional neighbor selection](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorPart.ts).

Files offers the default resource/declaration editor and, when different, its
canonical Source as separate opening operations, each with an explicit side
alternative. The menu retains the actual tree subject, invoking group and focus origin; later
selection or activation cannot substitute them. A declaration's Source uses
its tracked authored-owner occurrence, not the importing browser location.

The same document routing applies to Source, Scene, BT, FSM and every other
editor kind.
Domain openers produce the exact subject/input; the parts/group owner chooses
and admits its destination. A retired explicit destination revokes the request
rather than rerouting it. Switching a group's tab changes its active editor,
not the retained subject or selection of another tab. An asynchronous
open belongs to its destination group: replacement, close or workspace retirement
revokes attachment admission before a late result can attach. Another group's
independent open does not invalidate it.
None of these document operations replaces Main's primary authored context.

Source navigation captures the actual producing attachment and semantic subject
before settling its focused draft. Main's document arrangement supplies a
preferred receiver, not that subject's authority. The same admission chooses
ordinary text-view affinity or explicit side placement for Main and document
producers. Menu enablement consumes retained capability state without resolving
source or admitting semantic projections. Replacing or retiring the captured
subject revokes that invocation; rebinding its surviving occurrence through an
accepted source edit does not substitute another subject.

Attachment and activation are separate admissions. An open captures its departure,
destination and activation intent. If the user activates another group while it
resolves, it can still attach to the valid destination without raising that part
or stealing focus. Completion never infers its subject from the later-focused
control or treats a live destination as permission to activate it.
The same rule applies to synchronous callbacks during opening. The existing
opening generation arbitrates draft, clear and model publication; pane-show
callbacks can supersede attachment before layout or focus. Model selection,
the attached input and final activation remain owned by the surviving request.
Scope retirement, rather than that opening generation, defines the lifetime of
queued pane actions and prompts.

Because Studio inputs own view state and bindings, an additional view gets a
separate input over the same working copy. Source edits publish to every retained
projection, including the primary client behind the window. Parsing/indexing stays
cached by model/generation; view layout follows its own invalidations. Closing
a view releases its projections/subscriptions, not shared semantic, filesystem,
runtime or dirty-recovery owners.

Moving a view transfers group ownership after detaching its old pane; it is
different from closing/disposal or opening another view. Group removal cannot
dispose an input still owned by the destination group.
The input's move capability admits that handoff independently of its fresh-view
capability. It must account for live bindings and for whether the destination
already contains the same group matching key. A shared primary resource alone
does not establish that two authored occurrence views can coalesce.
When the destination already has a matching view, the move coalesces into that
view and applies the moved view's contribution-owned view state, preserving the
shared document. The departing view is retired only after that explicit
destination is admitted. Models retained there need no dirty-close decision;
any composite working copy losing its final authoring consumer still does.
Navigation references are retargeted by the move operation, not by
input-disposal fallback. The old
control's popups, asynchronous input and command-origin capabilities retire;
they do not gain authority over the surviving control merely because history
can refer to it.

Transfer settles the affected controls' drafts before changing membership.
Close and transfer share input-operation admission for the departing input and
any retained receiver. Both containers suspend new openings and window close
while the synchronous handoff changes their memberships; a new destination is
born under that admission. The destination's previous client undergoes ordinary
deactivation, not a move. Contribution-owned navigation selections carry reading
state into a coalesced receiver before the redundant input retires. Admission
is released before destination focus, and an unrelated later focus is retained.

Revealing a retained runtime tool resolves its actual current group. The invoking
destination is used only for an unowned/new input, not as a remembered Main
location. Reveal restores that part and its admitted local dialog without
rebinding an already active pane. Focus callbacks can supersede the request;
only the still-attached requested input may start a following action. Moves keep
the exact singleton Actor/Scenario input. Restoration reconstructs its recorded
view once in the recorded part, rather than another instance in Main.

Runtime prompts and queued presentation actions belong to the concrete pane's
group, picker and invocation scope. Attachment retirement revokes pending UI
work and queued guest admission; an already-entered physical mutation retains
its execution owner's completion contract. Play Reset replaces its exact
physical handle on the retained input. The input publishes subject retirement
before replacement so held actions, old prompts and guest bindings cannot act
on the new target. Closing the input closes its target; moving it does not.

Keyboard focus, active document part, primary authored context, hovered surface
and command subject remain separate:

- A focused control supplies the keyboard/clipboard/native-text target.
- A document command carries its part, group and concrete control/input subject.
  Menus and popups retain that origin while focus temporarily moves into them.
- Primary-client, hierarchy and Details actions instead retain their actual
  context attachment and contribution-owned selection. They do not manufacture
  a document input or borrow a later active group's subject. An action that
  opens Source captures an ordinary document destination separately.
  A Palette invocation from these controls retains that primary attachment and
  its accepting control after blur; the last active document pane does not
  supply a replacement command catalog.
- An asset's Source action carries its exact resource/location through ordinary
  group routing, or an explicitly requested Open to Side operation. An unrelated
  main selection or later-focused tab cannot substitute its model or destination.
- A workspace command has no document subject. A document command invoked from
  root chrome or the Command Palette captures the activated editor context when
  the interaction starts. It does not infer a different subject on submission.
  The Palette retains that editor context separately from the focused control's
  local capabilities and clipboard. Its editor context is the concrete pane,
  captured before blur; its ordinary control origin is resolved after blur has
  settled any draft. An ended property field cannot remain the catalog's local
  command owner. An explicit nonfocused chrome/control origin stays explicit.
  Reopening the workspace picker preserves a live invoking editor group's
  affinity rather than borrowing a later activated sibling group.
  The query field exposes that retained pane as its workspace-command context;
  Go to File exposes its retained destination group. Neither replaces local
  query history/clipboard, physical origin or focus return.
  A disabled command on a still-live local control never borrows the
  editor's action. Its fixed catalog retires when either contributing context
  retires, including during focus return after popup teardown.
  Local Palette actions use their control's accepting selection, while editor
  placement still uses the retained invocation context; a row-invoked context
  menu instead binds its specific clicked subject.
- Source-consuming commands accept the originating control's draft through its
  existing edit boundary before reading canonical source. Its subject owner
  resolves the surviving occurrence after that publication, rather than acting
  on a removed subject or substituting another selection.

Tab context menus retain the exact input alongside their actual group origin.
Right-clicking an inactive tab leaves the group's selected editor and attached
control unchanged. Close, Keep Open, Save, Move and New View consume that input;
an input removed or replaced while the menu is open revokes the subject instead
of selecting a substitute. Moving an inactive input leaves its active sibling's
control and draft attached. The tabstrip background and empty editor client
address group arrangement and lifetime actions, not whichever editor happens
to be selected later.

A window-title context menu addresses that real window's placement and close
capabilities. Minimize appears only where the window owner supplies it. Returning
from that menu focuses chrome rather than acquiring a guest viewport. The
existing Context Menu and Shift+F10 bindings invoke local capabilities on focused
window chrome, group action controls and empty editor clients; they do not
reserve gameplay keys.

Contribution menus belong to the selected authored or inspected subject.
Secondary presses select the hit row without activating it or toggling its
disclosure; Context Menu and Shift+F10 use the focused client's selection.
Scene menus consume the canonical working copy's source/navigation and member
editing capabilities. Source generation, subject selection and attachment
retirement revoke the menu before a dismissal callback can redirect its action.
Actor graph menus expose graph navigation and zoom; outline menus do not expose
graph-only controls. A rejected focus transition consumes the old pointer action
before the shared graph or contribution publishes selection, captures a drag or
opens a popup for a different subject.

Files context selection is separate from activation and disclosure. Its menu
retains the clicked file or authored occurrence and the resolved destination,
not a row ordinal or the later active group. Open uses the registered default
editor; Open Source requires an actual registered text-editor capability.
Declaration Source uses its canonical authored owner and current tracked offset,
including definitions browsed at an importing consumer. Folder/file disclosure
acts on the captured node. A changed tree presentation, filter, owner attachment
or retired subject revokes the popup; Cancel returns to Files without opening it.
Navigation does not override a newer foreground interaction during focus return.
Popup checked state, enablement and execution all consume the same retained
origin and editor subject. Menu dismissal keeps the existing focus-return
contract independent of that subject.

Files exposes Open to Side as a local command as well as a context action:
Ctrl/Cmd+Enter acts on the focused file/declaration, and Alt+primary body
activation expresses the same placement. Disclosure targets, directories and
Call Hierarchy keep their own navigation semantics. These bindings exist only
where the focused control supplies the capability; they do not reserve guest
gameplay keys.

Go to File uses Alt+Enter or Alt+pointer acceptance for explicit side placement;
ordinary acceptance keeps registered-editor affinity. Quick Input transports
the accepting event's raw modifier mask alongside the exact item. Keyboard
uses that key event and pointer uses its matching release, not a global key
sample or the earlier press. The resource contribution owns the interpretation,
captured invoking group, catalog identities and foreground handoff. Picker
teardown cannot turn a later-focused control into the old request's origin or
allow a retired resource to reopen through its same-path replacement.

F6 and Shift+F6 traverse the visible outer work areas in a fixed order:
Files, Main Hierarchy, Main documents, Main Details, docked Activity and status.
Hidden, detached and modal-blocked areas are skipped. Scroll-clipped controls
remain keyboard-eligible; their owning Main/part operation reveals them before
entry. The document stop is Main's actual document part, not whichever floating
editor happens to be active. A live floating/nonmember origin enters the first
eligible area forward or the last backward. This is workbench traversal, not
window switching: floating/minimized activities and editor windows are never
implicitly restored, and the Window picker retains that separate operation.
The collapsed menu remains on Alt/F10 rather than becoming an F6-opened popup.

The composition resolves the invoking attachment and one destination. A modal
origin cannot escape its keyboard scope; an ended origin or superseded request
does not choose a different current subject. Pure focus departure uses the
native field's ordinary blur policy: valid drafts publish once, invalid drafts
cancel without changing canonical source. Source-consuming and topology-changing
commands retain their explicit commit/veto paths. No work-area shortcut is
reserved while a guest viewport owns keyboard input.

This follows the separation in VS Code's [part-focus actions](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/actions/navigationActions.ts)
and Qt's [MDI window activation](https://github.com/qt/qtbase/blob/dev/src/widgets/widgets/qmdiarea.cpp),
not the assumption that canvas windows are separate native DOM windows.

The sizing actions exposed by Palette increase or decrease the invoking view's
width or height without themselves changing focus, committing a draft, selecting
another subject
or changing document topology. Files, Hierarchy and Details expose their width;
docked Activity exposes its height. Document groups resize their nearest owning
split on the requested axis, including in floating editor parts. Orthogonal
ancestors share that extent; a saturated boundary does not select a farther split
or resize the entire Main/window as a fallback. A sole or maximized group has no
resizable split. An unrelated floating inspector cannot resize its semantic
parent's document group, and a modal origin cannot resize the view beneath it.

The canvas-domain increment is two current font columns horizontally and two
lines vertically, projected to the native sash's feasible interval. Shared split
models project proportional intent to the nearest raster coordinate; commands
do not add pixel corrections or maintain another size. At a directional limit,
the corresponding command is unavailable. Pointer and command resizing publish
the same retained layout intent; retired split attachments cannot publish into
their former part. Command descriptors distinguish native-control actions from
semantic editor actions, so Palette availability and execution use the same
captured native invoker even when a separate authored editor subject is present.

This uses VS Code's [resize-action separation](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/workbench/browser/actions/layoutActions.ts#L1008-L1178)
and [grid-owned sizing](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/base/browser/ui/grid/gridview.ts#L1326-L1359)
as references, not an identical command contract: VS Code's axis-specific actions
target editors and its increment is in CSS pixels. Studio's commands explicitly
name the focused view and bitmap font units. They have no default global
keybindings and add no toolbar buttons.

Reset Focused View Width/Height restores that exact boundary's sizing rule
without changing focus or accepting a field draft. A proportional split restores
its raw default ratio; a fixed-edge region withdraws the requested size and
returns to automatic/preferred sizing. Reset remains available when the current
feasible interval cannot move: current constraints project the preference, not
replace it. A saturated nearest group boundary still owns reset; neither the
command nor the container chooses a farther ancestor.

Resize Focused View Width/Height enters the same attached native sash used by
the pointer. Arrows resize live in five-percent interval steps; Ctrl+Arrow uses
one canvas pixel, and Home invokes that owner's reset. Enter or Escape returns
to the exact live invoking control without reverting accepted layout changes.
The handle supplies active status guidance through its dedicated native scope.
Focus/admission loss, input replacement and either attachment's retirement end
the keyboard session; restoring admission cannot resume it or reclaim an obsolete
return control. Focus callbacks that admit another input/session win over an
outgoing cleanup or entry continuation. Other modified arrows retain their own
owners. Entry uses normal focus/blur admission, not a bypass for pending drafts.
Opening Palette also retains ordinary field blur handling; the sizing action
does not add a second commit/cancel path. Explicit-only workspace handles are
focusable only during their admitted keyboard session, so popup focus return
cannot revive an ended session. Existing tool-local Tab-linked handles keep
their owning traversal contract.

VS Code's [shared sash reset](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/base/browser/ui/sash/sash.ts#L276-L289)
and [SplitView forwarding](https://github.com/microsoft/vscode/blob/818341a41f15dd781888645df4915cbac604c5f6/src/vs/base/browser/ui/splitview/splitview.ts)
keep reset input separate from owner sizing. They do not supply a keyboard
handler or justify adding handles to F6 or local Tab order. Floating-window
keyboard placement is a separate container operation, not a split gesture.

The tab list is one composite keyboard control with a retained, exact focused
input separate from the group's selected input. `Focus Editor Tabs` enters at
the selected tab, or focuses the first tab when selection is explicitly absent;
it never creates an editor selection. Left/Right wrap through tab focus, and
Home/End focus the endpoints. Enter or Space activates on its matching release
while retaining tab focus; Escape enters the group's content. Tab leaves the
list through an actually available group toolbar, then content; an invisible
or disabled toolbar is not a focus stop. Pane-owned internal focus chains remain
with their contributions.

This uses [APG manual tab activation](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
because panes are lazy and can attach runtime input. It deliberately differs
from [VS Code's arrow activation with retained tab focus](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts#L1097-L1148).
Roving focus alone does not replace a pane, publish its draft or acquire guest
input. The focused tab's context menu and editor commands retain that exact input.
Reorder, labels, pinning and dirty-state publication preserve the binding; losing
the input ends pending command authority and focuses the following slot, otherwise
the preceding tab. Losing the last tab exits to the group's real empty client.
The shared strip projection reveals keyboard focus and paints its theme focus
outline independently of active-tab styling. Stationary focus, hover and popup
blur do not undo the user's manual tab scrolling. This canvas keyboard contract
does not by itself provide a DOM or screen-reader accessibility tree.
- Back/Forward records the part/group plus the existing reopenable
  resource-editor or retained-input identity and selection. A closed tab can be
  reopened in its surviving group. Group/part removal retires destinations in
  that scope, without clearing another scope's history or silently choosing a
  replacement window. Explicit view moves update their destinations.

The global active pane/group and `getActiveTab()` cannot remain implicit subject
providers for independently living parts. Likewise, pane teardown cancels only
its own capture/focus scope. These are ownership changes, not renamed globals,
state-swapping around drawing, or wrappers that forward to the old singleton.

Contribution composition separates discovery, primary-context admission,
document opening and domain actions:

| Responsibility | Owner and admitted context |
| --- | --- |
| Discover/resolve a resource or declaration | Workspace contribution using the shared source catalog, working copies and cached semantic projections. Produces the exact resource/occurrence, not an active-tab lookup. |
| Select/replace Main's authored subject | Primary-context admission retains the explicit declaration and outgoing draft/working-copy lifetime, independently of document opening. |
| Choose/open a view | Frontend destination routing and the selected group's opening lifetime. A picker retains its invoking context and chosen destination through acceptance and asynchronous resolution. |
| Edit, reveal Source or inspect a selection | The attached control's command binding, carrying its primary-context or document-input attachment and contribution-owned selection. The domain operation consumes those arguments directly. |

Shared domain operations receive explicit inputs. Group-bound opening logic owns
destination admission and lifetime; it does not forward to a controller's hidden
primary group. A new part needs its own actual controls, not another copy of
the workspace's domain services.

Command availability and execution use the same captured subject. After draft
publication, the subject owner resolves the retained occurrence against the
resulting source generation. A popup retains the originating attachment,
not just a reusable pane object: detaching/rebinding that pane or retiring its
input revokes the old action. An unrelated focus change does not redirect it.
A picker whose destination retires is dismissed; an already submitted open is
rejected by that destination's opening lifetime. Neither is redirected to main.

Modal admission follows ownership rather than paint promotion. A popup that
escapes its group's clip still belongs to the invoking group's admission family.
A later local modal or owner retirement revokes that popup and its gestures even
when the popup's presentation parent is outside the blocked group. Part-local
prompts/pickers block their part, while workspace replacement/close prompts block
the workspace; promoting a popup cannot escape either boundary.

Session ownership is explicit, rather than making every chooser another global
single-session control:

| Interaction | Session owner and admission |
| --- | --- |
| Command Palette or workspace-wide file search | One workspace interaction, with its invocation/destination context retained while root-modal. |
| Part-specific chooser or close prompt | The requesting part/operation; blocks that part. Independent parts can retain independent local sessions. |
| Context menu/submenus | One active popup family for the frontend display, owned by its invoking control. Opening another family dismisses the first rather than transferring its command authority. |
| Inline field/property interaction | The actual control/input binding and its existing commit/cancel lifetime. |

Shared control implementations and immutable command/menu contributions are
reused. Part-local sessions do not compete for a root controller's single slot,
and a separate command/semantic/filesystem service is not manufactured for each
prompt or window.

Local sessions use their host's physical modal presentation extent, not a
scrolled document lane. Main supplies that extent and presentation parent for
its document part; a floating part supplies its own client extent. The blocked
scope remains the requesting part even when presentation extends outside it.

An explicitly opened chooser takes foreground focus in its destination part,
even when invoked from another part. It retains the actual invoker for command
context and Cancel focus return. Publishing a background chooser instead declares
preserve-focus intent; owning a part is not itself permission to steal focus.
Moving to a sibling does not dismiss an already retained local session. A delayed
submission can complete its canonical edit without returning keyboard focus from
that sibling. A background close decision likewise remains local without
interrupting an unrelated part's draft. A decision for an explicitly minimized
part reveals that part when user attention is actually required; a clean close
does not reveal it.

## Window navigation and presentation

A permanent shell affordance opens workspace-wide Open Editors. It enumerates
all retained inputs from actual part/group membership, including inactive tabs,
background hosts and minimized windows, with their real group/host provenance
and dirty state. It remains reachable even when a floating part is maximized;
its availability is not conditional on `minimizedCount`. This projection has
no second mutable editor registry and requires no pixel-occlusion detector.
Choosing an input reveals its exact existing group/host; it does not create a
replacement view. Cancel preserves the invoking context. Group-local tab overflow
remains a separate list, not the workspace-wide discovery mechanism.

Dirty, label, active and Keep Open metadata update those admitted choices in
place, without reopening the picker or losing the query, field history, exact
selected input or manual scroll. If changed metadata no longer matches the
query, that choice becomes unselected rather than submitting a different input.
Actual catalog membership changes retire its choices; metadata is not retirement.

The Window menu also makes frontend membership actionable. Show Open Windows
projects actual window attachments in front-to-back order: Main, document
windows and modeless tools, including minimized windows and documents awaiting
a local close decision. The global status restore icon/count opens the same
picker. Choosing one reveals its real owner and focuses its retained local
dialog or client. Cancel returns to the invoking control; retiring or replacing
a listed attachment retires that picker generation, never a request to open a
replacement window. Open Editors remains the document/group navigator;
the tab overflow picker remains group-local.
Main workspace activation reveals its retained primary client and contextual
regions without opening a document or replacing its subject. Open Editors
continues to enumerate actual document inputs, not a synthetic tab standing in
for that primary context.

A document window retains its tab group: the window frame and group tabs
represent distinct scopes, even when
only one document is currently open. The main/document distinction must remain
legible through chrome and activation rather than suppressing group navigation.

Document minimization removes the full family without ending any document or
local session. The global status row's restore icon/count and the Window menu
make the retained owners discoverable. Owned utility inspectors have no roll-up
or minimize action. See [window presentation](workbench_windowing_design.md#minimized-document-windows)
for input, local-decision and restore lifetimes.

The shell and editor-host presentation have separate bounds and lifetimes.
Menu, project navigation, Open Editors and workspace status remain outside the
overlapping editor area. Main's **editorclient family**, including its primary
and contextual clients, ordinary document groups and owned overlays, and
floating editor families use ordinary host stacking inside that area. Floating
geometry and maximization are constrained to it.
There is no global Main tabstrip painted above a different foreground host.

Reveal first admits the exact input/group. If that group is hidden by another
leaf's temporary Group Maximize state, explicit activation restores this part's
retained arrangement before publishing bounds and focus. Passive/background
opening does not change Group Maximize or raise its host. Reveal then raises
only the destination editor-host family and focuses the admitted control.
Main is not an always-background surface: revealing its primary client or a
Main document can cover an explicitly floating Source, while Source keeps the
same inputs, placement, dirty state and reading position.
The permanent navigator remains reachable and selecting Source raises its
existing host again. Neither activation automatically minimizes, resizes,
closes or docks another host. Raising Main never raises the full opaque shell.

Comparing two document editors uses two groups in one arrangement. Working in
Main's primary client beside a Source or asset editor uses their distinct
workspace allocations; it does not require copying Main into a document tab.
Switching focus leaves the presented clients visible. Empty document groups
retain their ordinary focus/navigation boundary without becoming a primary
subject or routing typing to a covered host.

There is one fixed-height workspace status row. Its interaction context comes
from the attached view bound to the actual input scope. Menus, part-local
choosers and decisions borrow their real invoking scope; frontend chrome keeps
the selected context until that attachment retires. No later active tab or
background Main pane is substituted for it.

Contributions retain full semantic text, alignment, admission importance and
tone. The shared status owner measures the actual font, allocates disjoint slots
and projects one-glyph ellipses or withdraws optional hints. Hover and native
keyboard reading disclose full values; overflow has a keyboard-accessible
status-details action, and copying preserves the full observation rather than
the displayed truncation. Local status controls retain the source attachment's
lease while they have focus.

Connection and window discovery keep their own shell slots. Host failures and
guest input-release guidance remain independent of context replacement. A
pending key chord, active evaluation or transient feedback can temporarily
replace ordinary context text, in that order; feedback length does not resize
Main. Persistent project/primary-subject information is distinct from transient
interaction status. Floating canvas parts do not duplicate the status row.
A group's optional runtime timeline follows its actual runtime client and
content bounds, not Main's authored selection.

Snapping an existing window is separate from opening/copying a view, moving a
tab, splitting a group or docking a tool. The [snapped placement contract](workbench_windowing_design.md#snapped-placement-contract)
defines left/right work-area halves, top-edge maximize, drag preview and common
menu/keyboard placement transitions. No source, group or execution attachment
moves during a snap. Normal placement survives mode changes and live work-area
reflow. Ctrl/Cmd+K then Left/Right snaps the invoking window; Up toggles
maximize/restore and Down restores normal placement. Release Ctrl/Cmd before
the unmodified arrow stroke. These bindings appear in the ordinary command
palette and Window menu. Their pending hint occupies existing status space;
it does not move the work area. Focus/owner changes, Escape and the central
five-second deadline cancel the chord. OS Snap keys and guest gameplay input
are not reclaimed.

Owned modeless inspectors escape the pane's clip within the nearest real window
or modal context, rather than becoming unrelated root windows. Raising the part
therefore retains its inspectors' relative order. Main-local dialogs use the
main presentation family while blocking their named part; workspace dialogs
remain above all families. Lifetime, presentation and blocked scope remain
independent references.

New Editor Window creates another real group without replacing the main subject.
Open Editor in New Window requires the retained input's contribution-owned
fresh-view capability. It constructs a distinct input of the same tool and
authored subject, with independent selection, viewport and subscriptions over
the same canonical working copies. A factory may consume its contribution's
typed view snapshot; it does not round-trip session storage or guess an editor
from a filename. Live inspections, instance handles, playback and guest-input
authority are not copied. Contributions without that capability do not advertise
the command. This deliberately differs from VS Code's shareable input objects.

Move Editor To… retains the invoking part and exact input while the workspace
picker offers actual destination groups with their host provenance, plus
Open to Side and New Editor Window. Cancel changes no membership. Acceptance re-enters admission against
those same owners rather than moving whichever tab later has focus. A move
keeps the input and its working copies; it neither invokes the additional-view
factory nor round-trips storage. An emptied source window remains available.

## Execution and input

Physical input is produced once at the frontend/host boundary, not once per
editor part. Each actual target retains its own admitted input contributions
and execution/frame owner. The main view being visible behind
an asset editor does not give it keyboard/controller input or a second update
loop. Pointer routing still uses the shared surface order and whole-gesture
owner; native text input uses the actually focused control's arranged viewport.

Run/debug commands and timeline controls name an existing explicit transport.
An authored scene selection is not a runtime selection. Opening, painting,
raising or closing a document window issues no extra Run, Boot, Continue,
frame-step or reset operation.

The pause-while-authoring policy belongs to the workbench interaction owner and
the affected target, not a boolean written by each painted pane. The permanent
main tool must not pause all Play sessions forever, and a visible preview must
not override an author's or debugger's hold. Focus return may recompute the
ordinary workbench hold; it does not clear user pause, debugger or inspection
holds. Target-bound inspection operations retain their existing execution owner.

The interaction owner resolves the focused control's part/group and explicit
runtime binding; a transient retains the invoking context while it owns focus.
It retains an activated client context independently of hover/stacking and
publishes target-bound workbench holds to the existing execution owners:

| Activated interaction | Automatic workbench hold |
| --- | --- |
| Authoring: Home, Scene or a document control | Hold the attached primary authoring target, if present. Background Play/test targets retain their explicit run/debug policy. |
| Live guest client for the primary target | Release only that target's automatic UI hold; other holds still apply. |
| Live guest client for a Play target | Keep the primary authoring target held; release that Play target's automatic UI hold only. |
| Stopped inspection of target R | Hold R through the inspection interaction and keep the primary authoring target held; unrelated Play/test targets retain their policy. |
| Explicit live-follow/capture mode for R | Release R's automatic inspection/UI hold, not user/debugger/history/finite-operation holds. Keep the primary authoring target held when R is a different target. |
| Menu, popup, picker or prompt | Inherit the invoking interaction's policy. Modality restricts UI admission; opening a transient does not independently pause/resume a target. |

With no execution attachment, authoring publishes no physical execution request.
An explicit Pause/Stop is target-owned and survives focus changes; an automatic
UI hold is not a substitute for it. Focus return recomputes that ordinary policy
without an extra Continue command.
Chrome/transients retain an admitted activated client context rather than
searching visible panes when there is no focused leaf. Retiring that client
uses normal focus-return/activation to select a surviving context. The host
menu's own pause policy remains a separate host responsibility.

A runtime tool's retained input owns its logical live-follow intent. Moving it
retains that intent and any captured evidence while retiring the old control's
focus, popups, native input and pointer route. Its new pane publishes the same
logical interaction through its own scope. Ordinary deactivation still ends
live-follow according to the contribution's contract. Game's non-guest client
and guest viewport have separate interactions: focusing its chrome activates
its own intent, while guest keyboard/controller input requires fresh viewport
focus. Moving or restoring a view never restores guest-input capture.

Background panes do not publish competing hold values. Global run controls and
audio monitoring bind to the explicitly selected run target; window-local
runtime commands/timelines bind to their own transport/invocation target. Opening
Source does not silently select another audio/debug target. Retirement of a
target retires those bindings, rather than redirecting its commands to the main
machine. This replaces single-active-pane inference at composition, host-frame,
audio, transport and timeline boundaries together, not at one fallback callsite.

The selected run target belongs to shared workbench execution composition.
Browser and server-owned frame/audio consumers read that same explicit binding;
the absence of frontend focus does not select any ready Play session. Frontend
interaction admission separately retains the activated client, focused guest
binding and concrete local command binding. A menu may therefore retain live
execution policy while admitting no guest keyboard/controller input.
Automatic hold contributions change on interaction or target-lifetime
transitions. Frame advancement consumes that admitted policy once per target;
advancing a Play session does not independently decide its workbench hold.

Run-target selection has explicit admission rules:

- Workspace execution startup selects its designated primary target, or none
  for a source-only workspace. Adding an attachment does not select it.
- Interactive Play Start requests selection of its admitted target. Failure
  preserves the previous selection; delayed completion cannot override a newer
  explicit selection. Background test runs preserve the selection.
- Focus, inspection, Source navigation, stacking and transients do not change
  global run selection. Local controls retain their invocation target.
- Rebuild, reboot or image replacement preserves selection within the same
  target lifetime. Retiring the selected target clears selection, disables
  global runtime controls and selects no audio output. A later explicit Run or
  target-selection action can select primary; retirement itself never does.

## Close, layout and restoration

Closing an asset tab ends that view and releases its context retention. A
workspace-owned close operation identifies the affected authoring contexts and
**all** their working copies, including composite participation rather than only
a primary resource.
Each retained context is one consumer: a shared projection, its hierarchy and
Details controls, an input adapter and its group/window do not add duplicate
consumers. Existing source inputs expose `getWorkingCopies()`; an independent
primary context participates directly, not through a hidden editor input.
Closing an editor window applies that operation to its groups' retained
contexts; replacing/clearing the primary subject applies it to that context.
A prepared incoming context retains source correspondence for its request.
Its working copies participate in that replacement's release decision, so
switching between declarations of the same dirty document does not discard it.
Until admission, the candidate is not a surviving authoring consumer for an
unrelated document close. Cancelling the request therefore cannot strand dirty
source whose final admitted editor was allowed to close without a decision.
One dirty-close decision is required per working copy whose final retained
authoring consumer would retire. Save/Discard/Cancel is presented through the
existing prompt UI and executed through working-copy/recovery owners before
retiring the affected consumers. Cancel leaves the unclosed clients available;
already completed Saves are not rolled back. Closing one of several views does
not discard their shared document.

The operation re-enters admission after awaited work. A successful Save receipt
acknowledges the source version it captured, not necessarily the model's current
contents. A sibling document or primary client can edit the model or acquire it
while a local prompt/Save is pending. Before destructive Discard or final-consumer
retirement, the operation re-evaluates canonical dirty/version state and the
remaining authoring consumers. A stale decision cannot discard a newer edit or
another part's document; another required decision stays visible instead of
silently closing.

Close admission first resolves the focused control's actual pending edit,
then the affected canonical working copies. A part-close prompt blocks that
part; a workspace-close prompt blocks the workspace. Successful asynchronous
Save/close completion does not take focus from an unrelated active part. Focus
return belongs to the still-admitted invoking context, not to a stale global
active-pane pointer.

`EditorCloseController` owns document last-view decisions and primary-context
release, composite working copies and re-admission after awaited work. It derives
surviving authoring consumers from actual group membership and Main's admitted
context. Closing the last secondary tab cannot discard a model still edited in
Main; replacing Main cannot discard a model retained by a document. There is no
second close registry or dummy group/input. Part-local prompt/session admission
uses the existing prompt presentation and its focus policy.

Minimization or temporary covering retains views, working copies and reading
positions while revoking unavailable input. Pending field drafts follow their
actual control's commit/cancel contract; availability or authority loss can
cancel them, and return of space or rights does not resurrect them. Covering
is not a disguised Close or a promise to keep an inadmissible draft alive.

The main editor part closes only with its workspace/frontend, not through
Close All Editors. Closing its last tab leaves the main part/project navigation
and primary context alive. Close All Editors closes document views; clearing
the primary subject is a separate explicit operation. Tab/group-close commands
target their invocation group; closing a document window targets that part's
groups. Workspace-wide close requests are explicitly workspace-scoped. A
document window's owner is the workspace rather than the primary authored
subject. Replacing that subject therefore leaves the window open. Close and
focus return retire only the relevant owned popups and
gestures, preserving independent sibling interactions.

Close Other Editors keeps and pins the exact invoked tab. Close All Editors in
Group clears only the invoking group's closable document views; Close All
Editors uses the workspace scope, including minimized document windows. These
operations retain empty groups, their arrangement and window placement. Each
request captures its target memberships before pin or draft callbacks; views
opened later are not added to that request. Overlapping requests retain their
own newly admitted inputs while awaiting already-owned close decisions.

Layout consumes the frontend's published logical work area and current font,
not a game's scanout size or a copy of the Unreal screenshot. Project navigation
and inspector regions can become drawers on a narrow work area; the document
window can maximize within it. State survives that rearrangement. Main and
document chrome have distinct visible activation, compact semantic actions and
shared single-glyph truncation. Placement/reflow belongs to the layout/window
owner, never to an asset-specific workaround.

Workspace persistence records the primary context separately from Main's
document groups, floating-part groups and activity presentation. Its primary
record contains the admitted resource identity, domain kind, owner-defined
occurrence/selection restore data and source-snapshot correspondence; unbound
and Unavailable are distinct recorded states. The domain resolves that record
against recovered canonical source before attaching controls. A changed source
generation is not permission to reuse raw offsets, choose a namesake or select
the first declaration. Without exact correspondence the retained reference is
Unavailable, while independent document restoration can still succeed.

Region records retain requested presentation and reading intent, not derived
rectangles or copied domain data. Document topology, placement and activation
remain in the existing part/group format. Activity records are limited to each
owner's restorable data, not captured physical-session authority. The format
is unversioned: new composition replaces its owning shape directly, without
schema gates, migration machinery or a legacy tab-host workspace mode.
Working-copy recovery is recorded once, not one source copy per client.
Restoration resolves dirty models before attaching
views; restoring geometry or focus does not boot or resume a target. Runtime
handles and target-specific evidence do not become persistent asset identities.
Restored focus is presentation-only: live guest-input/capture authorization and
automatic-hold release are not persistent view state. A restored runtime view
cannot enter the table's Live/running-capture modes until explicit target
interaction admits that mode against the current target lifetime. Initial
workspace interaction is Authoring, even if a runtime view's chrome was active
in the saved layout. Separate explicit host startup/Boot policy remains with
the execution owner, not the layout restorer.
The session format records part/group topology, local active/preview inputs,
frontend activation and each contribution's view memento. Group records identify
views by their place in that serialized structure and their model/subject
reference, not a live control ID. Each record reconstructs its own input over
the shared canonical model. The owning format must represent source contexts
and all part/group relationships before this layout is published as restorable.
Persistent layout/view mementos contain plain contribution-owned restore data
and references between records. They contain no live AST nodes, tracked-range
objects, generation symbols, focus targets, command callbacks or guest handles.
Restoration constructs distinct live inputs and primary/contextual controls;
it does not revive an old live id as command authority. Navigation's live
tracked-range selections and control/popup handles remain session-local rather
than being serialized as layout mementos.

## Construction gates

The group arrangement, normal routing, shell/host separation and permanent
editor discovery are composition owners to preserve. Primary-context/region
composition builds on them rather than replacing them
with a universal docking framework. A layout that keeps a Scene document fixed
in Main while forcing Source into a separate window does not satisfy the target.

The primary context, its real first authored consumer, contextual selection,
region attachment and recovery/close participation form one delivery boundary.
Before UI construction, their command subjects, navigation, capture scopes and
teardown paths must agree with document/execution ownership. An honest unbound
startup is required, but an unbound decorative frame alone is not delivery of
the primary client. It must perform the source-backed work above; a pinned Home
tab or captured game image does not satisfy it.

Source controls have instance-owned layout/completion/Find/Rename/caret state.
Two independent Source views over one working copy are a construction proof,
not an optional future architecture exception. More document windows are not
simulated by swapping global source state. Native auxiliary windows remain the
separate host boundary already defined by the windowing design.

Construction depends on these owner boundaries remaining coherent together:

| Boundary | Required contract |
| --- | --- |
| `workbench/workbench.ts`, source/catalog, model and Save composition | Separate authoring authority from execution attachments; admit logical source contexts centrally. |
| Frontend main-workspace composition and primary-context owner | Allocate actual content, primary/contextual, document and activity clients; retain exact authored context independently of focus and document activation; no duplicate domain store or forwarding host. |
| Domain projections, retained work contexts and attached controls | Share producer-owned data/projections; retain exact subject, semantic selection and source/session correspondence per context; retire control authority independently. Scene membership/property authoring proves the primary authored contract without claiming a spatial viewport. |
| `services/editor/editor_part.ts`, arrangement, `editor_group.ts`, `ui/tab/`, `editor_panes.ts` | Multiple real groups per part, shared split/drop/transfer operations and group-scoped controls; no retained single-group alias or tool-specific container routing. |
| `editor/ui/code_editor_state.ts`, view/layout and editor contributions | Control-owned source interaction/viewport state, with shared model/semantic/font-generation producers. |
| `commands/controller.ts` and contribution controllers | Explicit invocation input/group/transport instead of global active-tab subject discovery. |
| `navigation/navigation_history.ts` | One workspace history of scoped destinations; no constructor/dispose reset from each group. |
| `cart_editor.ts`, `host_frame.ts` and runtime controls | One explicit interaction/run policy feeding target-bound execution, input, audio and timeline owners. |
| Working-copy close, workspace models/storage and contribution serializers | Count real primary and document consumers, recover source once, restore the primary context and independent view/region mementos without authority or guest handles. |

These are dependency boundaries to verify before UI construction, not permission
to move the same global code behind an `EditorPart` facade. Existing surface,
render-command, focus and capture machinery remains shared at its real owner.

Acceptance concerns the following observable contracts, not label snapshots
or fixed pixel positions:

| Scenario | Required result |
| --- | --- |
| Attach a project with no recorded primary subject; open/close Home | Project content and explicit primary-subject admission remain usable; Main stays unbound until a supported subject is chosen. Home neither selects a subject nor owns the project. |
| Select one Scene declaration for Main, then open Source/BT or a build result | Real membership/property work and its primary selection remain available; secondary editors and activity subjects do not replace it. |
| Select different members in Main and an independent Scene document | Each selection and Details binding stays local; canonical source/Undo remain shared. |
| Replace/clear Main while Details has a draft or a last-consumer decision is pending | The outgoing draft settles at its real control, then canonical occurrence and dirty-consumer state determine admission; Cancel retains the old context, with no rollback of accepted edits. |
| Delete or replace the selected declaration, then restore layout over changed source | Main retains its exact Unavailable reference; no namesake, first declaration, Home or runtime frame is substituted and no stale property action remains live. |
| Close the final secondary view while Main retains the same dirty working copy | The main context and shared edits survive; final-consumer admission occurs only when the actual remaining authoring consumer retires. |
| Open Call Hierarchy or reveal an output/tool activity | Its result does not replace project browsing or the primary authored subject; hiding/revealing presentations retains their owner-defined state. |
| Float the activity area, minimize/restore it, then return it to Main | The same selector, clients and native subtree keep their subjects, Find and reading state; physical window commands target that shell, not the active document, and no tabs are created or duplicated. |
| Open Source, Scene, FSM or BT normally | Same group-routing contract; no new floating host or tool-specific destination. Existing tabs keep their subjects and selections. |
| Compare Scene/Source, Source/BT or FSM/Animation in a split | Both real groups stay visible through focus changes; canonical edits propagate without sharing control state. |
| Drag a single tab into another group or a new split, float it and dock it back | Actual membership follows the advertised drop; source, Undo and view state survive with correct control retirement. |
| Reveal Main beneath a maximized Source float, then select Source from Open Editors | Each exact host becomes visible/focusable; Source retains inputs and maximized placement and is never lost from the permanent navigator. |
| Change the foreground editor/group | One matching status context; no duplicated floating/main status or shell restacking. |
| Reveal an input in a sibling hidden by Group Maximize | The destination part restores its arrangement before layout/focus; a passive background open leaves presentation alone. |
| Transfer a group within a part, then between parts | Same-part group lifetime survives; cross-part inputs/history move while old openings, controls and command authority retire. |
| Invoke Source/Save/Undo through a popup, then change focus | The invocation targets its original admitted input; retired origins cannot act on a replacement. |
| Rebind a reusable pane while its old popup/action is pending | The old attachment loses command authority, even if the old input survives in another tab. |
| Resize/cover/minimize one surface during a hold | That surface loses input and drains its gesture; a sibling's unrelated capture survives. |
| Complete an open after its part/workspace has closed | No late attachment or focus transfer into another part. |
| Open a menu from a live Play client while the main authoring view remains visible | The menu inherits that client's policy; neither visibility nor popup focus changes another target's holds. |
| Retire the target of an open runtime menu or timeline | Its commands become unavailable; none act on the primary target instead. |
| Close another view of a dirty model, then the last view/window | Shared history survives the first close; the final close resolves the ordinary dirty decision once. |
| Navigate across parts, dispose one, and restore a workspace | Destinations remain explicit; models recover once; no accidental execution or runtime-handle resurrection. |
| Restore an active runtime-view memento over an attached target | The view can regain presentation focus without granting live input/capture or releasing execution holds. |
| Open two Source views over one model in different groups/windows | Text/Undo/Save are shared; caret, wrapping, scroll, completion, Find and native input remain independent. |
| Use identical paths in distinct source contexts and repeated runtime ids in different targets | No model merging, project reclassification, wrong-target inspection or recovery collision. |
| Use both fonts in narrow and larger work areas | Actual leaf minima and scrollbar overflow retain topology/proportions; activation reveals the clipped leaf before native focus. Commands remain reachable without silently floating or merging groups. |

Home/menus expose actual entrypoints for FSMs, BTs, Action Effects, Scene,
Animation, Audio Events, Progression and Input Bindings. The project content
browser provides their persistent navigation; context-specific edit/run actions
stay with their actual subject. Discovery is not implemented by duplicating
feature controllers inside Home or by advertising unsupported creation actions.
