# Studio main workspace and document editors

## Product boundary

Studio has a persistent project work area, with document editors that can be
used without replacing that work area. Home is welcome/navigation content,
not the main window's identity or its lifetime owner. This document defines the
workspace interaction and ownership contract, not an Unreal feature checklist.

The target supports multiple independently living editor parts and Source
controls. It is not restricted to the number of windows in the first delivery.
Project selection, target-free startup, docking and native host windows have
their own admission/presentation requirements; they are not implemented merely
by arranging canvas windows.

```text
Studio frontend — one attached workspace
├─ Main editor part — permanent project work area
│  ├─ Project content browser
│  ├─ Main editor group(s), authored subjects and selections
│  └─ Contextual hierarchy/details and explicit run controls
├─ Document-editor parts — modeless editor windows
│  └─ Group(s) of Source / FSM / BT / effects / animation / audio / other tabs
└─ Owned inspectors, popups and dialogs
```

The main area remains a working editor while document windows are open. Opening
or closing a BT must leave the main tool, its subject and its selection intact.
At small sizes the foreground editor may cover the main area; covering a view
does not destroy it. Home can be closed without closing the project work area.

The existing Scene tool is a source-backed outline/property editor. Its Lua
resource may contain several scene declarations. Neither the running game frame
nor a runtime World is an authored level viewport. A visual level editor needs
its own source-backed scene, asset-resolution and rendering contract before
it can be advertised as such.

At attachment, restore the saved main subject and view through their source
owners. Without a selected main subject, show Home and working project-content
navigation. Choosing a Scene opens its document in the main part; ordinary
asset navigation opens a document part. No first-file/first-declaration guess or
running-frame substitution supplies a main scene. Opening Home later is an
ordinary navigation action; the main part itself remains the permanent owner.
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
- VS Code's [window actions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorActions.ts#L2390-L2569)
  expose new windows and explicit move/copy separately from ordinary opening.
  Window membership alone does not make those operations discoverable. Studio's
  additional-view action uses each contribution's fresh-input capability rather
  than sharing a retained input or turning another tool into Source.
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
| Main workspace and document editors | `services/editor/editor_parts.ts` and `editor_part.ts` compose main/document lifetime, controls and local sessions over shared documents. | Canvas placement does not supply docking or native host windows. Those require separate presentation and lifecycle contracts, rather than another editor instance. |
| Window navigation and additional views | The Window menu exposes main-workspace activation, an MRU window picker, new editor windows and contribution-owned additional views. Shared window chrome exposes maximize/restore and owner-admitted document minimization; document close requests go through `EditorCloseController`. | Snapping needs the shared placement/drag/keyboard contract below; it is not supplied by floating placement alone. Docking and native host-window integration remain separate capabilities. A contribution must supply a real fresh-view factory before its current subject can be opened in another window; an execution attachment cannot be copied as if it were an authored document. |
| Authored Scene work area | `cartlib/world/scene_library.lua` registers and instantiates compositions; `scene.lua` owns member spawning/disposal. Studio's `contrib/scene_editor/` projects declarations and edits written positions/options, membership order and removal. | A spatial authored viewport, object placement and transform gizmos need source-to-visual correspondence, asset resolution and an authoring renderer. A running frame or Actor Lab inspection is not that viewport. This is mainly Studio work over explicit domain data, not a missing Scene runtime. |
| Prefabs, objects and components | `cartlib/world/prefab.lua`, `world.lua` and `world_object.lua` provide classes, defaults, spawning and component factories. | A generic component palette and prefab editor need a contract for editable fields, component construction and visual proxies. Defaults and arbitrary Lua factories alone do not describe that editor contract. Studio adapters for known factories and cart-owned authoring metadata are possible producers; a mandatory new cartlib schema is not assumed. The read-only [runtime inspection contract](cartlib_inspection_contract.md) does not supply that authoring metadata. |
| Hierarchy and Details | Scene's outline/options project authored membership; Actor Lab independently inspects runtime actors/components. | Scene membership is not an object-transform hierarchy. Component ownership and Space membership must not be relabelled as transform parenting. Reparenting and inherited transforms need their own authored/domain operations before Studio can offer that kind of hierarchy. |
| Project content browser | `contrib/resources/panel/files_model.ts` owns project/shared/generated trees; resource creation/import and viewers provide real source operations and image/metadata views. | Declaration-level browsing and opening in the appropriate tool need a common project-content entry; a Lua file currently opens Source rather than enumerating its Scene/BT/FSM declarations. Thumbnail browsing, richer asset-type filters, collections and cross-project migration are separate Studio capabilities. Epic's [Content Browser](https://dev.epicgames.com/documentation/en-us/unreal-engine/content-browser-in-unreal-engine) distinguishes these operations from the level viewport. |
| Constructive authoring | Source templates create animation, sprite-animation, ActionEffect, progression, input and AEM resources. Scene and Behavior Lens edit admitted existing declarations and list members, including duplicating written BT children. | Guided creation of Scene, prefab, BT and FSM declarations, adding Scene members/FSM states and inserting BT node kinds from templates or a palette, including into empty branches, are missing Studio operations over existing cartlib domains. These require source-preserving edits and occurrence identity, but need not wait for a spatial viewport or introduce another asset format. |
| Content lifecycle and dependencies | Resource navigation, new-source creation, file import, source-symbol references and canonical model editing exist. | Rename/move/duplicate/delete and folder operations need workspace file authority plus document, recovery and reference lifetimes. Asset dependencies/used-by and reference repair need domain-aware source relationships, not string replacement or an assumption that Lua symbol references cover asset IDs. These are more basic Studio gaps than collections or cross-project migration. VS Code's [file actions](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts) and Epic's [Reference Viewer](https://dev.epicgames.com/documentation/en-us/unreal-engine/reference-viewer-in-unreal-engine) expose these as distinct operations. |
| Project/session entry | Project creation, Build Jobs, admitted source contexts and workspace recovery already have owners. | Selecting/opening/replacing a project in the frontend and starting without an execution target remain distinct lifecycle capabilities. Creating a cartridge or building it must not silently substitute for attaching its source workspace. The existing source-admission boundary, not an installed socket, owns that identity. |
| BT, FSM and action effects | `cartlib/behaviour_tree/`, `cartlib/fsm/` and `cartlib/actioneffects.lua` provide domains; Behavior Lens has source-derived graphs, editing and runtime inspection. | These are existing tools that must be discoverable and correctly routed in the workspace. Their absence from a Home section is not evidence that the domain is missing, nor a reason to introduce a competing behavior format. |
| Input and progression | `cartlib/input/` provides action/state programs and ActionEffect bindings; `cartlib/progression.lua` owns progression rules. `contrib/lua_program/` edits written program tables and inspects explicitly selected live instances. | These existing authoring tools need project-content discovery alongside BT/FSM/effects, rather than remaining hidden behind tool commands. Input binding authoring is distinct from Studio keyboard preferences and player-facing rebinding; neither is supplied by the settings UI. |
| Cart maps | `contrib/cart_maps/` edits canonical YAML room objects and stage markers through explicit Pietious and Nemesis source adapters. | This is not a generic tilemap/level format or a spatial Scene editor. Supporting another cart requires its authored-data association and edit operations; sharing grid interaction alone does not establish a common cartlib map domain. |
| Animation | Timeline programs, seek/scrub and sprite animation have cartlib owners. `contrib/animation/` edits tracks, keys, curves, clips and frames; `frame_preview.ts` displays the selected sprite image. | An isolated authored playback/scrub preview still needs an explicit subject, property bindings, clock and side-effect policy. A selected image is not animation playback, and runtime seek alone does not supply that preview. Skeletal hierarchies and retargeting are separate optional domain extensions, not prerequisites for this nearer Studio gap. Epic's [animation editors](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-editors-in-unreal-engine) distinguish preview-subject selection from timeline editing. |
| Audio | `cartlib/aem.lua` and `apu.lua` support event-driven audio; `contrib/aem/` edits canonical maps, rules/actions and transitions, with explicit installed-target application and Actor Lab event audition. | Standalone waveform/asset audition needs a Studio preview owner. A graph projection of existing AEM actions would be Studio presentation; a signal-flow mixer/submix graph would require a separately agreed domain and execution contract. Neither follows from drawing nodes, and lack of a graph does not mean event-driven audio is missing. |
| Play/debug/edit correspondence | Isolated Play, Scenario Lab, Source breakpoints, Actor/GPU/GTE/Event tools, replay and explicit Hot Resume already exist. World/Scene retain definition, Scene and authored member identity for Scene-spawned objects. | “Play this authored Scene” needs an authored launch contract. Applying runtime transforms back to source still needs the exact source occurrence, property/override correspondence and normal source edits; procedural objects need not have an authored member. Retained runtime IDs alone do not supply writeback. Epic's [PIE/SIE workflow](https://dev.epicgames.com/documentation/unreal-engine/ineditor-testing-play-and-simulate-in-unreal-engine) is a comparison, not permission to reconstruct authored data from runtime state. |
| Source control and comparison | Working-copy dirty state, Undo/Redo, Save conflicts, recovery and proposed-edit review with before/after hunks have existing owners. | Repository status/history, staging/commit and general file/revision comparison and merge are separate Studio/host workflows. Proposal review is not version control, and rejecting a stale Save is not a conflict-resolution editor. VS Code's [SCM contribution](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scm.contribution.ts) separates that workspace activity from document editing; adopting it would not require a cartlib feature. |
| Editor/project settings | Theme/font commands, session placement and source-backed cart configuration exist at separate owners. | A searchable settings model and UI with explicit defaults, scopes and persistence are missing. Editor preferences are not gameplay configuration. Go to File needs a configurable project-only versus BIOS/shared-library inclusion policy based on admitted provenance; folder-name guesses and isolated tool toggles are not a settings system. |

This mapping records prerequisites and product choices, not approval to build
every missing Unreal subsystem. Complete the main/document workspace using
existing source and execution owners first. Spatial authoring, project entry,
content-browser expansion and other domain extensions are separately admitted
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
| Frontend editor-parts owner | Permanent main part, document-part membership, frontend activation/MRU and destination routing. Enumerates the actual parts' groups for shared operations. |
| Main editor part | Project navigation, main groups and their authored subjects/views. Its lifetime is the workspace attachment, not the active document tab. |
| Editor part | Window/container, group layout, active group, client bounds and local focus/capture scope. A part is a concrete composition, not a facade over global active state. |
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
The main part retains project navigation and its authored subject independently
of the document parts' tab selections.

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

1. An explicit destination group wins and reuses its matching view.
2. Otherwise the contribution's opener chooses its normal area: Scene/Home use
   the main part; other authored assets use document parts.
3. Prefer a matching view in the invoking group when it belongs to that area;
   otherwise raise the most recently activated matching view in that area.
4. With no match, open in the invoking eligible group, otherwise the most
   recently activated eligible group. With no document group, that concrete
   open creates a document part and its first group.
5. An explicit additional-view action supplies another group/window. It does
   not create duplicate matching tabs in one group. A move transfers ownership
   rather than creating another input over a copied document.

The main subject is not replaced when routing to document parts. An asynchronous
open belongs to its destination group: replacement, close or workspace retirement
revokes attachment admission before a late result can attach. Another group's
independent open does not invalidate it.

Attachment and activation are separate admissions. An open captures its departure,
destination and activation intent. If the user activates another group while it
resolves, it can still attach to the valid destination without raising that part
or stealing focus. Completion never infers its subject from the later-focused
control or treats a live destination as permission to activate it.

Because Studio inputs own view state and bindings, an additional view gets a
separate input over the same working copy. Source edits publish to every retained
projection, including the main tool behind the window. Parsing/indexing stays
cached by model/generation; view layout follows its own invalidations. Closing
a view releases its projections/subscriptions, not shared semantic, filesystem,
runtime or dirty-recovery owners.

Moving a view transfers group ownership after detaching its old pane; it is
different from closing/disposal or opening another view. Group removal cannot
dispose an input still owned by the destination group.
When the destination already has a matching view, the move coalesces into that
view and applies the moved view's contribution-owned view state, preserving the
shared document. The departing view is retired only after that explicit
destination is admitted. Models retained there need no dirty-close decision;
any composite working copy losing its last view still does. Navigation references
are retargeted by the move operation, not by input-disposal fallback. The old
control's popups, asynchronous input and command-origin capabilities retire;
they do not gain authority over the surviving control merely because history
can refer to it.

Keyboard focus, active part, hovered surface and command subject remain separate:

- A focused control supplies the keyboard/clipboard/native-text target.
- A command invocation carries its part, group and concrete control/input subject.
  Menus and popups retain that origin while focus temporarily moves into them.
- An asset's Source action opens the matching location in the document part;
  an unrelated main selection or later-focused tab cannot substitute its model.
- A workspace command has no document subject. A document command invoked from
  root chrome or the Command Palette captures the activated editor context when
  the interaction starts. It does not infer a different subject on submission.
- Source-consuming commands accept the originating control's draft through its
  existing edit boundary before reading canonical source. Its subject owner
  resolves the surviving occurrence after that publication, rather than acting
  on a removed subject or substituting another selection.
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

The Window menu makes frontend membership actionable. Show Open Windows lists
the actual main and document parts in activation order, including minimized
windows and windows awaiting a local close decision. Choosing one reveals that
part and focuses its retained local dialog or client. Cancel returns to the
invoking control; retiring a listed owner revokes the picker rather than
redirecting its stale choice. The tab overflow picker remains group-local. A document window retains its tab
group: the window frame and group tabs represent distinct scopes, even when
only one document is currently open. The main/document distinction must remain
legible through chrome and activation rather than suppressing group navigation.

Document minimization removes the full family without ending any document or
local session. The global status row's restore icon/count and the Window menu
make the retained owners discoverable. Owned utility inspectors have no roll-up
or minimize action. See [window presentation](workbench_windowing_design.md#minimized-document-windows)
for input, local-decision and restore lifetimes.

The permanent main presentation family and document windows are peers in the
same ordered window band. The main family includes project navigation, its
client and its opaque background. Focus Main Workspace raises that family;
focusing a document raises its own family again. Neither action minimizes
or disposes another part. An empty main container still owns keyboard focus:
Enter opens Home and Escape returns to project navigation. It cannot leave
typing routed to a document covered by the main work area.

Snapping an existing window is separate from opening/copying a view, moving a
tab, splitting a group or docking a tool. The [snapped placement contract](workbench_windowing_design.md#snapped-placement-contract)
defines left/right work-area halves, top-edge maximize, drag preview and common
menu/keyboard placement transitions. No source, group or execution attachment
moves during a snap. Normal placement survives mode changes and live work-area
reflow. Central keybinding/chord ownership is a prerequisite for discoverable
multi-key shortcuts; OS Snap keys and guest gameplay input are not reclaimed.

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

Collapse or temporary covering retains views, working copies and reading
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
| `services/editor/editor_group.ts`, `ui/tab/`, `services/editor/editor_panes.ts` | Part/group-owned inputs and controls; scope-specific retirement instead of singleton selection/reset. |
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
| Open/edit/close an FSM or BT above a main Scene view | Main subject, selection and viewport survive; both views observe canonical source changes. |
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
| Use both fonts in narrow and larger work areas | Reachable commands and retained state survive drawer/maximize changes without forced permanently visible panels. |

Home/menus expose actual entrypoints for FSMs, BTs, Action Effects, Scene,
Animation, Audio Events, Progression and Input Bindings. The project content
browser provides their persistent navigation; context-specific edit/run actions
stay with their actual subject. Discovery is not implemented by duplicating
feature controllers inside Home or by advertising unsupported creation actions.
