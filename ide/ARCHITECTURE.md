# IDE and Studio ownership

This is a map of the Studio implementation, not a feature specification or an
implementation journal. Repository-wide composition and dependency boundaries
are described in [the software architecture](../docs/architecture.md#studio-ownership).

## Owners

| Area | Responsibility |
| --- | --- |
| `editor/` | Text models, editing, code-view layout/rendering and editor contributions. |
| `workbench/` | Studio shell, editor groups, panels, windows, shared controls and tool contributions. |
| `language/` | Language-specific source adapters, highlighting, formatting and queries shared by tools. |
| `input/`, `commands/` | UI focus, gesture routing, keyboard dispatch and workbench commands. |
| `runtime/` | Execution/inspection integration, installed source generations and connection to physical targets. |
| `testing/` | Captured fixture programs, isolated test targets and their debugger/inspection lifetimes. |
| `workspace/` | Admitted source contexts, authored records, workspace files and storage contracts. |
| `browser/`, `node/` | Platform-specific Studio integrations. |
| `common/`, `theme/` | Shared primitives and presentation tokens, without feature-owned state. |

Reusable text-editor machinery belongs in `editor/`; its workbench presentation
belongs in the corresponding `workbench/contrib/` contribution. Shared shell
controls belong in `workbench/ui/`, while workbench services own cross-control
lifetimes. A feature keeps its subject, commands and domain-specific projection.
Sharing a control does not transfer the feature's ownership to that control.

Language tools consume the compiler/frontend owners in `toolchain/`. Studio
uses host and machine services for physical execution; editor views do not own
a compiler, filesystem transport or a second machine loop.

Lua semantic projects index file facts by opaque resource address. A snapshot
binds each referrer's written import specifiers to those files; export facts
belong to a file, not a global module name. Compiler and Studio project producers
apply their own import policy. The Studio project retains the address-to-resource
mapping used by navigation and visual source editors; captions remain resource
labels rather than encoded semantic addresses. Module completion consumes the
project's preferred import catalog, independently of aliases accepted in written
imports.

## Composition

`workbench/workbench.ts` composes the shared `StudioWorkbench`. Browser Studio
adds `RuntimeIdeState` and `RuntimeCartEditor` for frontend input and presentation.
The server-owned Node Studio composes the same workbench in an isolated worker.
Session, transport, source authority and physical-target boundaries are defined
by the [repository architecture](../docs/architecture.md#studio-ownership), not
by the kind of editor currently visible.

## Workspace and execution

`workbench/workspace/` owns the attached workspace root, editor-session storage
and recovery namespace. `contrib/home/` presents that workspace through an
ordinary editor input and pane. `workbench/mode.ts` chooses the startup editor
after session restoration; changing the active editor does not choose a project
or install a cartridge. Project selection belongs at workspace attachment, not
inside Home or a tool pane. Physical execution remains with the workbench's
execution services and their explicit targets.

`services/editor/editor_parts.ts` owns the frontend's permanent main part,
part/group membership, activation/MRU and normal opening destinations. It owns
the shared close/transfer admission and the frontend drop-target projection.
Internal membership projections settle before external topology/model events;
retiring group authority is separate from history handoff and final disposal. An
`EditorPart` owns real groups, local active/MRU state, retained client bounds,
Quick Input and decision dialogs. `group_arrangement.ts` owns the retained split
tree, hard and reading minimum extents, overflow viewport, constrained drop
previews and temporary group maximization. Both constraint tiers use the same
tree; an optional companion must fit the presented arrangement's reading
budget, not only its active group. `common/main_area_layout.ts` owns the nested
allocation between Main's document arrangement and optional Game companion,
including their shared sash.
It does not resize the physical viewport or encode allocation as a chrome inset.
Each `EditorGroupView` owns its tabs, panes, content/timeline geometry and input
scope. Pane contributions measure retained inputs with the supplied font without
constructing or attaching controls. Groups add their actual attached chrome;
drop projections measure the incoming attachment and the source's model-selected
successor. Parent allocation precedes the frame's content update, and routing
publication follows allocation of both primary and companion clients.
Editor and whole-group gestures use the shared drop target for local and foreign
positions; actual surface presentation ancestry decides eligibility. Host
admission and a group-local close decision are independent gates.
The shared close owner settles drafts, working copies and Saves before the part
normalizes and retires an empty group; the final routing leaf remains present.
Ordinary opening uses actual matching views and the invoking group,
independently of editor kind; creating a floating part is explicit. Floating
parts use the shared window container, not another Studio session or workspace.
Visual panes expose an optional source-location capability: the contribution
selects the canonical text model, source generation and authored caret. Shared
editor commands and resource navigation own opening admission, history and
placement. Ordinary Source follows text-view affinity; explicit Source to Side
uses a neighbor in the invoking part. Producer/provenance navigation remains a
separate contribution action when it names a different subject. A source
location never reconstructs text from a visual or runtime projection. Opening
admission retains the requesting attachment; the text-selection consumer
applies generation-bound coordinates only to their exact canonical model
generation, independently of the already admitted view.
Workspace storage records
part topology and requested placement independently of shared source recovery.
Workspace persistence is unversioned. Frontend layout, editor-view mementos
and source-recovery manifests use the current shape without schema version
fields, version gates, migrations or compatibility layers.
The permanent shell owns navigation, menu and one status presentation outside
the editor-host area. Main's editor-client family and floating parts share the
surface owner's ordered host band; activating an editor raises only that family,
not the shell. Main's available client excludes temporary panels and shared
sash lanes. Outer window/popup placement retains the reserved shell extent;
Main clipping does not retire independently promoted surfaces. Logical surface
lifetime and physical input admission are distinct. Workspace Open Editors
projects every actual input/group/part from membership, while tab overflow remains group-local. Owned inspectors stay
in their window/modal presentation family. Status consumes the actual primary
client or document control context rather than a background Main pane. Shared window models retain
normal requested intent separately from normal/snapped/maximized arrangement
and independently minimized visibility. Window gesture drafts are presentation,
not persisted placement; only a completed drop publishes new intent.
Document minimization retains frontend sessions; part membership owns restore
and activation. Owned utility inspectors expose their own chrome capabilities.

Shared execution composition owns the primary `RuntimeTransport` and
`RunTargetSelection`. Global run/debug controls and audio monitoring consume
that explicit selection; editor focus and Source navigation do not select a
target. Play admission retains its selection request until the physical session
is ready. Closing the selected target clears selection rather than choosing
another machine. Window-local runtime controls retain their own transport
binding independently of global selection.

`WorkbenchInteraction` owns automatic UI execution holds from the activated
control attachment. Keyboard focus, guest-input admission, popup invocation and
run-target selection remain distinct. Runtime clients publish their physical
transport and live-follow intent through `InputInteraction`; authoring controls
hold the primary target. Runtime commands and Timeline retain the logical client
attachment, independently of a temporarily hidden guest-input viewport.
Physical controls publish interaction activation. Executing a retained command
subject does not replay its earlier interaction or replace newer focus routing.
Transients borrow the invoking interaction without
borrowing guest input. Attachment and transport retirement revoke that authority.
Runtime inputs retain logical live-follow intent and captured observations;
moving their view replaces control scopes, not those sessions. Independent
inspection views remain distinct even when they observe the same history.
Finite workbench operations declare their execution intent at host admission;
they do not erase the UI or explicit pause reasons.

Platform composition supplies an admitted source context before workspace
attachment. Node workspace metadata and browser-owned metadata retain those
opaque identities. A source-folder open has its own selection; matching paths
do not select an arbitrary named project. Build receipts retain their exact
project admission independently of immutable artifact generations. Browser
published-build navigation preserves that receipt, not merely an artifact ID.
Frontend and native source recovery consume explicit context/session namespaces;
canonical file Save addresses remain separate from
[recovery storage](../docs/studio_source_recovery_design.md).

`contrib/resources/panel/content_index.ts` projects authored declarations from
existing semantic/source owners into the retained file tree. Its cache follows
source and semantic-project lifetimes; canonical working copies map occurrence
ranges. The file tree owns disclosure and presentation, while contribution
controllers own exact-subject editor lookup and opening. Browsing neither
executes Lua nor creates a second source or asset database.
Files gestures retain prospective resource/declaration openings independently of
retained editor transfers. The shared drop target projects placement; Files owns
source admission and contribution resolution, and editor parts own new receiver
construction and publication. Hover does not create inputs or routing groups.

`workspace/source_catalog.ts` owns admitted source contexts, resource identities
and their explicit module/asset bindings independently of installed media.
Documents and semantic projects use context/path keys; canonical filesystem
addresses and display captions are separate producer metadata. An execution can
install no image, one image or several generations from the same context.
`runtime/sources.ts` retains each installation's physical domain and captured
source generation. Debugging and runtime navigation consume those captures,
not the current authoring registry or an inferred context-to-socket mapping.
Play and Scenario preparation capture an explicit authored source namespace;
the fixture compiler consumes it independently of the ROM's packaged assets.
Unit fixtures have their own entry rather than rebuilding the gameplay program.

## Documents, inputs and panes

`editor/model/` owns canonical text models. Workbench working-copy services own
text-model resolution, persistence and source-edit publication. Source-backed
visual tools consume those models rather than keeping another authored copy.
The source catalog supplies canonical file addresses. Text-file loading, Save
and canonical recovery comparison consume that admitted file authority.
Diagnostics are indexed once by canonical model/version; Source presentation
projects ready row markers through its own layout rather than an active-editor bucket.
`CodeDocumentProjections` owns model-bound highlighting and semantic scheduling.
Font-generation measurements are shared by attached views; each `CodeLayout`
owns wrapping, visual rows and its control's inline-text projection.
`CodeEditorViewState` retains each Source input's wrapping choice; reusable
controls consume that choice directly. Full view snapshots carry it through
copies, group mementos and recovery. Navigation locations and text-history
selections do not restore presentation preferences.

Contributions own concrete retained editor inputs. `EditorGroupView` owns its
group model, pane cache, tab/content surfaces, focus/capture scopes and tab-strip
control. Its container supplies focus ancestry and the retained work area before
descendant controls are constructed. Pane factories consume that group's actual
surface and extent. Layout publishes each group's retained title/content bounds;
paint and input use those same surfaces. Tab layout, hover and gestures live in
the strip, not in frontend-wide chrome state.
The strip's keyboard control retains focus independently of editor selection;
its reusable command context ends with its concrete focused-input binding.
`workbench/common/editor_inputs.ts` owns the retained view union. Commands can
address an exact input alongside their concrete control origin; popup projection
does not change group selection to manufacture that subject.
An input identifies an editor and retains its view state and model references;
it is not the document itself. Different inputs can present the same document.
`workbench/main_workspace.ts` owns Main's permanent presentation family and the
allocation between a retained primary authored client and the document region.
`EditorParts.main` is its document child; the Game companion is nested with that
child, not painted or routed through shell chrome. Parent reveal precedes child
focus admission when the composition overflows. Main is unbound until an explicit
contribution action supplies a primary subject. Ordinary document navigation does
not replace it. Hiding Studio detaches its controls, not its retained work context.
Scene source documents are generation-cached at `contrib/scene_editor/source_documents.ts`
and shared with project-content discovery. `SceneAuthoringContext` retains source
correspondence, semantic selection and member editing independently of outline
rows and document placement. A primary context scopes one exact declaration;
independent Scene inputs retain their own contexts over shared source models.
`SceneEditorViewState` retains presentation and `SceneEditorControl` owns concrete
focus, fields, gestures and transients. A document pane adapts that control to a
group; `ScenePrimaryClient` attaches it directly to Main without an editor input.
Source inputs own their model-to-view subscriptions. Closing one releases its
view without disposing the canonical model or another input's view.
An input's optional fresh-view capability belongs to its contribution. It creates
independent retained state over shared working copies, not another document or a
copy of runtime inspection/input authority. Complex authoring tools retain their
concrete contribution factory; frontend commands do not reconstruct subjects
through filenames or persistence serializers.
An input's move capability separately admits a group-ownership handoff. Parts
coordinate container admission, groups detach the old pane and publish final
membership, and inputs retain their view state and working copies. A matching
destination input survives coalescence; contribution-owned selections transfer
reading state before the redundant input retires. Close and transfer share
input-operation admission rather than competing lifecycle registries.
Retained-input reveal resolves actual group membership and restores that part;
it does not reattach an already active pane or recreate a singleton in Main.
Actor runtime projection and execution stay with their domain controller;
pane-owned actions retain their actual group, picker and invocation scope.
Play inputs own exact physical handles and admitted transport bindings. A
handle replacement retires old control authority before publishing its new
subject; moving the view does not close that target. Scenario result/run owners
likewise remain independent of their pane and opening destination.
`EditorCloseController` shares Save/Discard/Cancel admission between document
close and retained-context release. Surviving working-copy consumers derive from
actual group inputs and Main's admitted context, not a reference-count registry.
A prepared replacement participates only in its own release decision; it does
not suppress an unrelated document's final-consumer decision before admission.
The close owner rechecks canonical state and consumers after awaited decisions or
writes; final view/context retirement belongs to the admitted composition owner.
`TextFileSaveService` owns accepted writes and their captured source snapshots;
it does not build or install assets. Explicit execution operations own those
changes and retain their selected target/image through asynchronous work.
Groups own final view retirement. Forced owner teardown is separate from user
close admission. Opening and activation settle the attached focused control's
draft before changing group membership or pane attachment.
The group's Source pane keeps plain reading mementos for ordinary reopening,
separate from serialized view state and explicit navigation selections.
Text history retains source selections and inert editing origins, not viewport
coordinates or control references. Source history commands name their invoking
view; sibling views track the canonical text changes independently.
Each Source pane owns a concrete `CodeEditorControl`: native text input, focus,
selection gestures, viewport, caret and render caches belong to that instance.
Find, Rename, Suggest and hover are pane-bound contributions. Source actions
retain that pane and its group; they do not resolve through a primary editor.
`workbench/services/editor/` owns editor-kind resolution and pane attachment:
a pane is a reusable control
bound to one input, not the lifetime owner of that input or its source.

Part-local prompts block their own part and retain its invocation and focus
return lifetime. Workspace-wide commands use explicitly workspace-owned
prompts. Closing a document part runs shared last-view close admission against
that part's actual dialog owner; cancellation reopens new input admission, not
outstanding asynchronous openings. Forced teardown retires the part's controls
and command authority without closing shared documents or sibling views.

The frontend owns shared navigation history. Captured selections belong to their
group/input lifetime and name their destination group. `EditorOpeningRequest`
admits synchronous producers and asynchronous resolver factories under one
opening, focus, navigation and candidate-cleanup lifetime. An inadmissible group
starts neither production nor resolution. Opening generations
arbitrate group-local admission across draft publication, clear, model and
pane-show callbacks; they are not control-attachment lifetimes. A superseded
opening cannot reattach its input or reactivate its group. Commands retain the
actual control subject separately from their invoking editor context: local
capabilities and clipboard belong to the control, placement to that editor
context. Constructing or disposing a group cannot reset another group's history.
Explicit moves retarget stacked and pending navigation entries to the actual
destination group and surviving input before retiring the old view.

Shared window/control code owns presentation and input mechanics. Contributions
own their subjects and register their commands on the appropriate focus target.
Feature-owned menu definitions bind placement predicates to the retained subject;
the shared menu projection publishes membership before toolbar geometry. Command
enablement remains separate from placement, and popup invocation/lifetime stays
with the context-menu owner. The static menu registry has no domain-state lookup
or mutable contribution-registration lifecycle.
`input/` owns keyboard focus and pointer-gesture routing independently of which
view or physical target happens to be active. Each frontend owns its central
keybinding controller and pending chord lifetime. Binding metadata supplies
resolution and shortcut presentation; pane handlers do not own chord state.
Keyboard commands use the admitted application runner; isolated controls without
one execute only their own capabilities. Native field commands and semantic
source commands remain distinct. A source command can use its explicit client
context without borrowing the active document group. Contribution-owned command
capture retains invocation subject and control lifetime before draft publication;
UI enablement does not construct those invocations.

## Workbench Quick Input

`workbench/services/quick_input/` owns picker/input sessions, presentation and
focus lifetime. Providers own their actual catalog, matching and ordering;
`QuickPickModel` consumes the provider's projection. Features contribute those
providers and actions rather than adding feature-specific matching to the shell.
Acceptance carries foreground-preservation intent across focus return; an
opening consumes that intent instead of recapturing it after the handoff.
