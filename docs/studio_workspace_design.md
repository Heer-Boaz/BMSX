# Studio main workspace and document editors

## Product boundary

The ownership and interaction contract below is the target architecture. The
capability table distinguishes existing owners from missing implementation.

Studio has a persistent project work area, with document editors that can be
used without replacing that work area. Home is welcome/navigation content,
not the main window's identity or its lifetime owner. This document defines the
workspace interaction and ownership contract, not an Unreal feature checklist.

The target supports multiple independently living editor parts and Source
controls. It is not restricted to the number of windows in the first delivery.
Editor-group docking belongs to this workspace design; snapping a floating
window does not implement it. Project selection, target-free startup and native
host windows have their own admission/presentation requirements.

```text
Studio frontend — one attached workspace
├─ Permanent shell — project navigation, Open Editors, menu and workspace status
├─ Main editor part — permanent editor host, without a floating titlebar
│  └─ Arrangement of groups: Source / Scene / FSM / BT / other editor tabs
├─ Explicit floating editor parts — the same group arrangement and input owners
│  └─ Normal/snapped/maximized placement, independently minimized visibility
└─ Owned inspectors, popups and dialogs
```

The main part's lifetime belongs to the workspace, not to Scene, Source or Home.
All editor kinds use the same groups, tab lifetime and placement operations.
Ordinary opening uses an existing group; floating is an explicit user choice.
A split keeps two editors simultaneously visible without overlapping windows.
Switching tabs retains their subjects and selections; opening a BT does not
retire a Scene input. Home can be closed without closing the project work area.

The existing Scene tool is a source-backed outline/property editor. Its Lua
resource may contain several scene declarations. Neither the running game frame
nor a runtime World is an authored level viewport. A visual level editor needs
its own source-backed scene, asset-resolution and rendering contract before
it can be advertised as such.

At attachment, restore the main arrangement, its groups and their recorded
subjects/views through their source owners. Without a recorded editor subject,
show Home in the initial group and working project-content navigation. Choosing a Scene, Source file or another authored declaration uses
the common group-routing contract, not a tool-specific Main/floating rule.
No first-file/first-declaration guess or running-frame substitution supplies a
scene. Opening Home later is ordinary editor navigation; the main part itself
remains the permanent owner.
An authored subject that becomes unavailable is still that subject, not an
invitation to substitute Home or another declaration.

## Production references

- Epic distinguishes the permanent Level Editor, project Content Browser and
  specialized editors in its [editor interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-editor-interface).
  The transferable decision is the main/project versus document-tool boundary,
  not the assumption that BMSX already has Unreal's level model or viewport.
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
- Godot's [main-screen container](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/editor_main_screen.h#L49-L64)
  keeps the main area present, while its
  [dock manager](https://github.com/godotengine/godot/blob/5d1cd20f9117e4721fce626454e2323eb9462d0a/editor/docks/editor_dock_manager.h)
  owns floating placement. Studio likewise keeps main-area lifetime separate
  from the selected tool and shared window presentation; it does not copy
  Godot's docking implementation.

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
| Main workspace and document editors | `services/editor/editor_parts.ts`, `editor_part.ts` and `group_arrangement.ts` compose real split groups, group-aware opening, retained-input moves and local sessions over shared documents; `editor_drop_target.ts` shares editor and whole-group insertion, split drops and explicit canvas floating through retained-input admission. Same-part group relocation retains the actual controls; cross-part transfer retains their input models. | Native host windows remain a separate host boundary. |
| Window navigation and additional views | The Window menu exposes main-workspace activation, an MRU window picker, new editor windows and contribution-owned additional views. Shared window chrome exposes maximize/restore and owner-admitted document minimization; document close requests go through `EditorCloseController`. | Snapping uses the shared placement/drag/keyboard contract below without moving editors or their inputs. Editor docking uses the group-transfer contract below; native host-window integration is separate. A contribution must supply a real fresh-view factory before its current subject can be opened in another window; an execution attachment cannot be copied as if it were an authored document. |
| Authored Scene work area | `cartlib/world/scene_library.lua` registers and instantiates compositions; `scene.lua` owns member spawning/disposal. Studio's `contrib/scene_editor/` projects declarations and edits written positions/options, membership order and removal. | A spatial authored viewport, object placement and transform gizmos need source-to-visual correspondence, asset resolution and an authoring renderer. A running frame or Actor Lab inspection is not that viewport. This is mainly Studio work over explicit domain data, not a missing Scene runtime. |
| Prefabs, objects and components | `cartlib/world/prefab.lua`, `world.lua` and `world_object.lua` provide classes, defaults, spawning and component factories. | A generic component palette and prefab editor need a contract for editable fields, component construction and visual proxies. Defaults and arbitrary Lua factories alone do not describe that editor contract. Studio adapters for known factories and cart-owned authoring metadata are possible producers; a mandatory new cartlib schema is not assumed. The read-only [runtime inspection contract](cartlib_inspection_contract.md) does not supply that authoring metadata. |
| Hierarchy and Details | Scene's outline/options project authored membership; Actor Lab independently inspects runtime actors/components. | Scene membership is not an object-transform hierarchy. Component ownership and Space membership must not be relabelled as transform parenting. Reparenting and inherited transforms need their own authored/domain operations before Studio can offer that kind of hierarchy. |
| Project content browser | `contrib/resources/panel/files_model.ts` retains project/shared/generated file trees. `content_index.ts` projects recognized Scene, BT, FSM, ActionEffect, progression, input-binding and animation occurrences as file children, using existing source/semantic owners. File activation keeps the registered default editor; declaration activation opens its exact subject in the appropriate tool. | Thumbnail browsing, richer asset-type filters, collections and cross-project migration are separate Studio capabilities. Epic's [Content Browser](https://dev.epicgames.com/documentation/en-us/unreal-engine/content-browser-in-unreal-engine) distinguishes these operations from the level viewport. |
| Constructive authoring | Source templates create animation, sprite-animation, ActionEffect, progression, input and AEM resources. Scene and Behavior Lens edit admitted existing declarations and list members, including duplicating written BT children. | Guided creation of Scene, prefab, BT and FSM declarations, adding Scene members/FSM states and inserting BT node kinds from templates or a palette, including into empty branches, are missing Studio operations over existing cartlib domains. These require source-preserving edits and occurrence identity, but need not wait for a spatial viewport or introduce another asset format. |
| Content lifecycle and dependencies | Resource navigation, new-source creation, file import, source-symbol references and canonical model editing exist. | Rename/move/duplicate/delete and folder operations need workspace file authority plus document, recovery and reference lifetimes. Asset dependencies/used-by and reference repair need domain-aware source relationships, not string replacement or an assumption that Lua symbol references cover asset IDs. These are more basic Studio gaps than collections or cross-project migration. VS Code's [file actions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts) and Epic's [Reference Viewer](https://dev.epicgames.com/documentation/en-us/unreal-engine/reference-viewer-in-unreal-engine) expose these as distinct operations. |
| Project/session entry | Project creation, Build Jobs, admitted source contexts and workspace recovery already have owners. | Selecting/opening/replacing a project in the frontend and starting without an execution target remain distinct lifecycle capabilities. Creating a cartridge or building it must not silently substitute for attaching its source workspace. The existing source-admission boundary, not an installed socket, owns that identity. |
| BT, FSM and action effects | `cartlib/behaviour_tree/`, `cartlib/fsm/` and `cartlib/actioneffects.lua` provide domains; Behavior Lens has source-derived graphs, editing and runtime inspection. Project file children open their exact authored occurrences. | Constructive authoring remains separate from discovery. A missing operation is not a reason to introduce a competing behavior format. |
| Input and progression | `cartlib/input/` provides action/state programs and ActionEffect bindings; `cartlib/progression.lua` owns progression rules. `contrib/lua_program/` edits written program tables and inspects explicitly selected live instances. | Project file children expose these authored programs alongside BT/FSM/effects. Input binding authoring is distinct from Studio keyboard preferences and player-facing rebinding; neither is supplied by the settings UI. |
| Cart maps | `contrib/cart_maps/` edits canonical YAML room objects and stage markers through explicit Pietious and Nemesis source adapters. | This is not a generic tilemap/level format or a spatial Scene editor. Supporting another cart requires its authored-data association and edit operations; sharing grid interaction alone does not establish a common cartlib map domain. |
| Animation | Timeline programs, seek/scrub and sprite animation have cartlib owners. `contrib/animation/` edits tracks, keys, curves, clips and frames; `frame_preview.ts` displays the selected sprite image. | An isolated authored playback/scrub preview still needs an explicit subject, property bindings, clock and side-effect policy. A selected image is not animation playback, and runtime seek alone does not supply that preview. Skeletal hierarchies and retargeting are separate optional domain extensions, not prerequisites for this nearer Studio gap. Epic's [animation editors](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-editors-in-unreal-engine) distinguish preview-subject selection from timeline editing. |
| Audio | `cartlib/aem.lua` and `apu.lua` support event-driven audio; `contrib/aem/` edits canonical maps, rules/actions and transitions, with explicit installed-target application and Actor Lab event audition. | Standalone waveform/asset audition needs a Studio preview owner. A graph projection of existing AEM actions would be Studio presentation; a signal-flow mixer/submix graph would require a separately agreed domain and execution contract. Neither follows from drawing nodes, and lack of a graph does not mean event-driven audio is missing. |
| Play/debug/edit correspondence | Isolated Play, Scenario Lab, Source breakpoints, Actor/GPU/GTE/Event tools, replay and explicit Hot Resume already exist. World/Scene retain definition, Scene and authored member identity for Scene-spawned objects. | “Play this authored Scene” needs an authored launch contract. Applying runtime transforms back to source still needs the exact source occurrence, property/override correspondence and normal source edits; procedural objects need not have an authored member. Retained runtime IDs alone do not supply writeback. Epic's [PIE/SIE workflow](https://dev.epicgames.com/documentation/unreal-engine/ineditor-testing-play-and-simulate-in-unreal-engine) is a comparison, not permission to reconstruct authored data from runtime state. |
| Source control and comparison | Working-copy dirty state, Undo/Redo, Save conflicts, recovery and proposed-edit review with before/after hunks have existing owners. | Repository status/history, staging/commit and general file/revision comparison and merge are separate Studio/host workflows. Proposal review is not version control, and rejecting a stale Save is not a conflict-resolution editor. VS Code's [SCM contribution](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scm.contribution.ts) separates that workspace activity from document editing; adopting it would not require a cartlib feature. |
| Contextual UI commands | Shared context menus, command registration and captured invocation contexts serve window chrome, exact editor tabs, group backgrounds and Files rows. The tab list has individual keyboard focus, independently of its group-action toolbar. | Coverage of other tool surfaces remains a separate UX task. Right-click and keyboard Context Menu expose owner-admitted actions without duplicating command state or borrowing the later active editor. |
| Editor/project settings | Theme/font commands, session placement and source-backed cart configuration exist at separate owners. | A searchable settings model and UI with explicit defaults, scopes and persistence are missing. Editor preferences are not gameplay configuration. Go to File needs a configurable project-only versus BIOS/shared-library inclusion policy based on admitted provenance; folder-name guesses and isolated tool toggles are not a settings system. |

This mapping records prerequisites and product choices, not approval to build
every missing Unreal subsystem. Complete the main/document workspace using
existing source and execution owners first. Spatial authoring, project entry,
thumbnail/collection browsing and other domain extensions are separately admitted
work. Unified settings follow that workspace work; [VS Code's user/workspace
settings](https://code.visualstudio.com/docs/configure/settings) provide a scope
and discovery reference without requiring a new mandatory cartridge manifest.

These distinctions also constrain workspace placement. Project content is the
entry to authored resources and declarations; the main area's hierarchy and
Details describe its selected authored subject. Document windows retain their
own subjects and contextual controls. Runtime inspection, preview execution and
build/output tools are explicit activities, not permanent panels added merely
to resemble Unreal's default layout. A missing preview or domain operation stays
visible as a capability gap rather than being disguised with the running game
frame, a generic table dump or an empty editor window.

## Owners and representations

| Owner | Retained state and responsibility |
| --- | --- |
| Attached workspace | Source/file authority, admitted resource catalog, working copies, semantic caches, Save, recovery and navigation. Execution attachments consume these owners; they do not supply authoring identity. |
| Frontend editor-parts owner | Permanent main part, floating-part membership, frontend activation/MRU and destination routing. Derives workspace-wide group/input enumeration from actual membership. |
| Permanent shell | Project navigation, workspace-wide Open Editors, menu and status outside the overlapping editor-host area. It is not the surface raised when an editor gains focus. |
| Main editor part | A layout-owned editor host with an arrangement of ordinary groups. Its lifetime is the workspace attachment, not the active document tab or editor kind. |
| Editor part | Group membership/arrangement, local active group, client bounds and local focus/capture scope. Main and floating parts use the same group composition; only host presentation differs. |
| Editor-group arrangement | Retained group leaves and horizontal/vertical split branches, requested proportions, minimum extents and published leaf bounds. It owns topology, not editor subjects or source data. |
| Editor group | Ordered inputs, active/preview input, pane instances, tab chrome, group focus/capture scope and outstanding editor-opening lifetime. Each concurrently visible group has its own panes and controls. |
| Editor input/view | One presentation identity, selection, scroll and source-correspondence bookmarks. Another part gets another view/input when an additional view is explicitly requested. |
| Working copy | Authored text, dirty state, versions and Undo/Redo for one admitted resource identity. Views of that same identity share this owner. |
| Source control | Its text layout, native caret, selection gestures, completion and Find/Rename interaction. Font/theme and project semantic results remain shared at their existing owners. |
| Surface/window owner | Paint order, placement, clipping, chrome and input admission. It does not own the document or choose a physical execution target. |
| Workbench navigation | One Back/Forward history of concrete destinations and contribution-owned selections, including the destination part. Creating or disposing a part does not reset unrelated history. |

All parts in a frontend share its workspace services. A group is not a window:
several groups can be arranged within a part, and the layout owner supplies their
bounds. Reusing a pane within one group does not make that pane reusable by two
simultaneously visible groups.

An auxiliary editor is not another `RuntimeIdeState`, `StudioWorkbench`, native
Studio session or source authority. Closing it retires its controls and views,
not those shared owners.
Source-access and review capabilities belong to the attachment/session. Creating
or focusing another editor window cannot grant permission to edit or Save.

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
| Split / Open to Side | Add a real neighboring group in the same part and admit the intended input there. An independent view requires the contribution's existing fresh-view capability. |
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

The frontend composes real parts over the shared workspace, rather than placing
a window around the primary group's existing controls. The editor-parts owner
owns part membership and activation; each part owns its group arrangement,
retained client bounds, surfaces and focus/capture ancestry. Its local active
group is distinct from the frontend's most recently activated part/group.
The flattened group enumeration used by close and document operations is
derived from that membership, not a separately mutable second registry.

A group supplies its actual group, focus scope and content surface to its pane
factories. The pane cache remains group-local and lazy by editor kind. Source,
Scene, Behavior Lens and the other contributions receive that group's real
controls and opening destination; no factory closes over a primary-group alias.
Workspace caches and document projections stay at their existing shared owners.
The shell retains project navigation independently of every editor selection.
Each part retains its group's inputs independently of another part's active tab.
Part activation selects its actual active group, not a primary-group alias.

Composition follows a concrete ownership order:

1. Attach the workspace's admitted sources, canonical models and shared services.
2. Construct the main part, then any restored document parts, with their own
   surface roots and group factories. Recover dirty models once before resolving
   inputs; contribution serializers construct independent views over them.
3. Attach each group's inputs and controls without acquiring guest input or
   issuing execution commands. Publish the part arrangement and presentation
   activation only after its destinations exist.
4. On a document-part close request, pass that part's actual group/input set to
   the shared close owner. Keep the part until close admission completes; Cancel
   leaves it available. Successful close retires its openings, controls,
   popups, navigation destinations, surfaces and part membership in owner order.
5. Workspace replacement settles workspace-wide operations and retires all parts
   before clearing canonical models, source authority or recovery bindings.

Each part arranges its groups within layout-owned bounds. Paint/input traversal
uses the shared surface owner; controls consume their group's retained client
rectangle. Drawing another part never swaps global editor bounds, focus or
source state. Layout and activation invalidate their owning projections; a
stationary frame does not rebuild pane factories, enumerate source registries
or reconstruct window state.

Source layout is separated by responsibility, rather than copying the entire
current `CodeLayout` into every window. Canonical source/semantic/highlight data
and font-generation measurements can be shared by their producer keys. Wrapping,
visual-row/viewport projection, hit testing and interaction belong to the actual
control. An unchanged second view reuses source/index generations; stationary
frames do not parse, rebuild highlights or remeasure unchanged source per view.
Injected completion/ghost text and other view-specific projections stay with
their control; they are neither canonical source nor another view's shared
highlight/measurement result.

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
  The main Scene view likewise retains its actual source document and selected
  scene/member occurrence. Deletion retires that subject instead of selecting
  a namesake or the next row.
- A runtime subject belongs to its explicit target/session and current
  heap/media/history lifetime. Domain numbers and object hashes can repeat in
  the authoring machine, Play and test targets. They cannot identify an authored
  asset or be restored as if they did.

Project navigation retains real files and folders rather than replacing them
with a separate asset database. A file's disclosure opens its recognized authored
children; activating the file body or pressing Enter on the file still uses its
registered default editor. A declaration has a kind icon and its own source
occurrence, independent of the active editor. Declaration activation uses the
same exact-view lookup and group-routing contract as file activation. The domain
controller resolves the subject, not a hardcoded Main/floating destination.
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

Opening resolves the canonical working copy and exact contribution/subject.
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

The same routing applies to Source, Scene, BT, FSM and every other editor kind.
Domain openers produce the exact subject/input; the parts/group owner chooses
and admits its destination. A retired explicit destination revokes the request
rather than rerouting it. Switching a group's tab changes its active editor,
not the retained subject or selection of another tab. An asynchronous
open belongs to its destination group: replacement, close or workspace retirement
revokes attachment admission before a late result can attach. Another group's
independent open does not invalidate it.

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
projection, including the main tool behind the window. Parsing/indexing stays
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
any composite working copy losing its last view still does. Navigation references
are retargeted by the move operation, not by input-disposal fallback. The old
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

Keyboard focus, active part, hovered surface and command subject remain separate:

- A focused control supplies the keyboard/clipboard/native-text target.
- A command invocation carries its part, group and concrete control/input subject.
  Menus and popups retain that origin while focus temporarily moves into them.
- An asset's Source action carries its exact resource/location through ordinary
  group routing, or an explicitly requested Open to Side operation. An unrelated
  main selection or later-focused tab cannot substitute its model or destination.
- A workspace command has no document subject. A document command invoked from
  root chrome or the Command Palette captures the activated editor context when
  the interaction starts. It does not infer a different subject on submission.
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

Contribution composition separates three actual responsibilities:

| Responsibility | Owner and admitted context |
| --- | --- |
| Discover/resolve a resource or declaration | Workspace contribution using the shared source catalog, working copies and cached semantic projections. Produces the exact resource/occurrence, not an active-tab lookup. |
| Choose/open a view | Frontend destination routing and the selected group's opening lifetime. A picker retains its invoking context and chosen destination through acceptance and asynchronous resolution. |
| Edit, reveal Source or inspect a selection | The attached pane/control's command binding, carrying its concrete input and contribution-owned selection. The domain operation consumes those arguments directly. |

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

The Window menu also makes frontend membership actionable. Show Open Windows lists
the actual main and document parts in activation order, including minimized
windows and windows awaiting a local close decision. Choosing one reveals that
part and focuses its retained local dialog or client. Cancel returns to the
invoking control; retiring a listed owner revokes the picker rather than
redirecting its stale choice. The tab overflow picker remains group-local.
A document window retains its tab
group: the window frame and group tabs represent distinct scopes, even when
only one document is currently open. The main/document distinction must remain
legible through chrome and activation rather than suppressing group navigation.

Document minimization removes the full family without ending any document or
local session. The global status row's restore icon/count and the Window menu
make the retained owners discoverable. Owned utility inspectors have no roll-up
or minimize action. See [window presentation](workbench_windowing_design.md#minimized-document-windows)
for input, local-decision and restore lifetimes.

The shell and editor-host presentation have separate bounds and lifetimes.
Menu, project navigation, Open Editors and workspace status remain outside the
overlapping editor area. Main's **editorclient family**, including its group
tabs and owned overlays, and floating editor families use ordinary host stacking
inside that area. Floating geometry and maximization are constrained to it.
There is no global Main tabstrip painted above a different foreground host.

Reveal first admits the exact input/group. If that group is hidden by another
leaf's temporary Group Maximize state, explicit activation restores this part's
retained arrangement before publishing bounds and focus. Passive/background
opening does not change Group Maximize or raise its host. Reveal then raises
only the destination editor-host family and focuses the admitted control. Main is not an always-background
surface: revealing its Scene can cover an explicitly floating Source, while
Source keeps the same inputs, placement, dirty state and reading position.
The permanent navigator remains reachable and selecting Source raises its
existing host again. Neither activation automatically minimizes, resizes,
closes or docks another host. Raising Main never raises the full opaque shell.

Comparing Scene and Source uses two groups in one arrangement, not overlapping
hosts or tool-specific keep-on-top behavior. Switching their focus leaves both
visible. An empty main group still owns keyboard focus: Enter opens Home and
Escape returns to project navigation. It cannot route typing to a covered host.

There is one workspace status presentation. Editor context comes once from the
actually active group, including a floating part's active group; a background
Main pane is not a second status source. Floating canvas parts do not duplicate
that status row. A group's optional runtime timeline follows its actual runtime
client and content bounds, not the part's former single-group assumption.

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

Closing an asset tab ends that view. A workspace-owned close operation identifies
the explicit affected views and **all** their working copies, including composite
inputs' `getWorkingCopies()` rather than only their primary resource. Closing an
editor window applies that operation to its groups, including one dirty-close
decision per working copy whose last view would close. Save/Discard/Cancel is presented through the
existing prompt UI and executed through working-copy/recovery owners before
retiring the affected inputs. Cancel leaves the unclosed views available;
already completed Saves are not rolled back. Closing one of several views does
not discard their shared document.

The operation re-enters admission after awaited work. A successful Save receipt
acknowledges the source version it captured, not necessarily the model's current
contents. A sibling view can edit the model or open another view while a local
prompt/Save is pending. Before destructive Discard or final last-view retirement,
the operation re-evaluates current canonical dirty/version state and which views
will remain. A stale decision cannot discard a newer edit or another part's
document; another required decision stays visible instead of silently closing.

Close admission first resolves the focused control's actual pending edit,
then the affected canonical working copies. A part-close prompt blocks that
part; a workspace-close prompt blocks the workspace. Successful asynchronous
Save/close completion does not take focus from an unrelated active part. Focus
return belongs to the still-admitted invoking context, not to a stale global
active-pane pointer.

`EditorCloseController` already owns last-view decisions, composite working
copies and re-admission after awaited work. Part close composes that owner over
the affected groups; part-local prompt/session admission extends the existing
root-prompt presentation rather than replacing the close policy.

Minimization or temporary covering retains views, working copies and reading
positions while revoking unavailable input. Pending field drafts follow their
actual control's commit/cancel contract; availability or authority loss can
cancel them, and return of space or rights does not resurrect them. Covering
is not a disguised Close or a promise to keep an inadmissible draft alive.

The main editor part closes only with its workspace/frontend, not through
Close All Editors. Closing its last tab leaves the main part/project navigation
alive. Tab/group-close commands target their invocation group; closing a document
window targets that part's groups. Workspace-wide close requests are explicitly
workspace-scoped. A document window's owner is the workspace rather than the
currently selected main tool. Changing the main tool therefore leaves that
window open. Close and focus return retire only the relevant owned popups and
gestures, preserving independent sibling interactions.

Layout consumes the frontend's published logical work area and current font,
not a game's scanout size or a copy of the Unreal screenshot. Project navigation
and inspector regions can become drawers on a narrow work area; the document
window can maximize within it. State survives that rearrangement. Main and
document chrome have distinct visible activation, compact semantic actions and
shared single-glyph truncation. Placement/reflow belongs to the layout/window
owner, never to an asset-specific workaround.

Workspace persistence records the main groups/subjects/views, document-part
groups, window placement and active part. It records working-copy recovery once,
not one source copy per window. Restoration resolves dirty models before attaching
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
and references between records. Restoration constructs distinct live inputs and
control identities; it does not revive an old live id as command authority.
Navigation's tracked-range selections and control/popup handles remain
session-local rather than being serialized as layout mementos.

## Construction gates

The group arrangement, normal routing, shell/host separation and permanent
editor discovery form one composition boundary. A layout that keeps Scene fixed
in Main while forcing Source into a separate window does not satisfy it.
Replace that single-group topology and its persistence shape directly; do not
keep it as a legacy layout mode. Workspace storage remains unversioned, with
no schema version fields, migration gates or compatibility paths.

The target composition has a retained main authoring client and independent
document parts/groups. Before its UI is built, the group/pane, command-subject,
navigation, capture-scope and recovery owners above must have explicit
construction and teardown paths. The main client must perform real source-backed work; a pinned
Home tab, empty decorative frame or captured game image does not satisfy it.

Source controls have instance-owned layout/completion/Find/Rename/caret state.
Two independent Source views over one working copy are a construction proof,
not an optional future architecture exception. More document windows are not
simulated by swapping global source state. Native auxiliary windows remain the
separate host boundary already defined by the windowing design.

Construction depends on these owner boundaries remaining coherent together:

| Boundary | Required contract |
| --- | --- |
| `workbench/workbench.ts`, source/catalog, model and Save composition | Separate authoring authority from execution attachments; admit logical source contexts centrally. |
| `services/editor/editor_part.ts`, arrangement, `editor_group.ts`, `ui/tab/`, `editor_panes.ts` | Multiple real groups per part, shared split/drop/transfer operations and group-scoped controls; no retained single-group alias or tool-specific container routing. |
| `editor/ui/code_editor_state.ts`, view/layout and editor contributions | Control-owned source interaction/viewport state, with shared model/semantic/font-generation producers. |
| `commands/controller.ts` and contribution controllers | Explicit invocation input/group/transport instead of global active-tab subject discovery. |
| `navigation/navigation_history.ts` | One workspace history of scoped destinations; no constructor/dispose reset from each group. |
| `cart_editor.ts`, `host_frame.ts` and runtime controls | One explicit interaction/run policy feeding target-bound execution, input, audio and timeline owners. |
| Workspace models/storage and contribution serializers | Context-aware recovery plus independent part/group/view mementos and ordinary close admission. |

These are dependency boundaries to verify before UI construction, not permission
to move the same global code behind an `EditorPart` facade. Existing surface,
render-command, focus and capture machinery remains shared at its real owner.

Acceptance concerns the following observable contracts, not label snapshots
or fixed pixel positions:

| Scenario | Required result |
| --- | --- |
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
