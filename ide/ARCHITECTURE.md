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

## Workbench context menus

`workbench/services/context_menu` owns one transient popup per workbench, with
retained layout, scroll range, command selection, pointer capture and focus
return. `ui/menu/registry.ts` contributes existing commands; each editor
contribution owns its target and the popup's source-invalidation subscription.
The popup contains neither a code token nor a behavior node. Its command
context is the invoking control, so admission matches toolbar and palette.
Code-token positioning occurs only in the code contribution when an action is
accepted. Graph right-click selects the hit occurrence without starting a drag;
empty canvas is a separate context. Source change, focus loss and pane detach
close the popup. Accept hides before execution. Both pointer and keyboard
activation wait for physical release so Source cannot turn into a held gesture
in its destination. Menu colors are shared with the workbench menubar, not
borrowed from completion. The same controller handles keyboard opening,
scrolling and all viewport bounds on software, WebGL2 and WebGPU.

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

Before/after selection travels with that document's edit history as typed,
input-independent state. The retained code-input manager consumes code-owned
state from the content event, even when a visual editor invoked Undo/Redo and
the code widget is hidden. Its `CodeEditorViewBinding` also maps cursor/anchor
positions for edits without code-owned result state: one model pre-edit event
captures offsets in the old buffer, the content event maps those offsets into
the new buffer. A hidden view cannot retain positions on removed lines. Visual
scroll rows are never treated as buffer rows. Widget activation/history reveal handles geometry;
the text model does not know cursor or graph representations. See
[edit-associated source selection](../docs/editor_edit_bookmarks_design.md).

Workbench Back/Forward is a separate bounded navigation history, not document
Undo or a visual-editor-local stack. `navigation/navigation_history.ts` captures
the active pane's input identity and optional contribution-owned selection.
Resource-editor identities reopen through the existing registration; concrete
non-reopenable input entries end on input disposal. Each entry owns its mapped
bookmarks and subscriptions. The pane consumes its selection option once during
activation, before controls bind; an asynchronous FSM layout consumes the saved
viewport after publication rather than running initial reveal over it. Shared
`Go: Back`/`Go: Forward` commands and workbench Alt+Left/Right use this same owner
from every editor kind. Source edits remap locations without restoring old text,
adopting a same-named deleted occurrence or changing the paused machine.
See [navigation design and proof](../docs/workbench_navigation_history_design.md).

Workspace recovery persists dirty model contents separately from code-editor
view metadata. A working copy can acquire its first code view after its content
backup. Metadata requests retain the emitting model/view pair; the next
generation inserts or updates that resource's view without rewriting source
records or consulting the active tab. Clean navigation is not a dirty edit.
See [source recovery](../docs/studio_source_recovery_design.md) for lifecycle
and regression evidence. Rename, behavior-source indexing, Hot Resume, and autosave read
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

The active code pane subscribes to that same model's content events. Its
`CodeLayout` invalidates affected source lines even when a visual command, not
keyboard editing, produced the change. The applied-order change extent comes
from `editor/text/text_change.ts`; offset-to-line conversion stays with
`PieceTreeBuffer.positionAt`. Drawing does not repair stale row references or
poll document versions. The pane detaches this subscription when its input
changes; activation rebuilds the new input's layout.

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

The graphical Behavior Lens contracts are specified in
[`../docs/behavior_graph_design.md`](../docs/behavior_graph_design.md).
The implemented BT prerequisite exposes typed root, branch and attachment
information on the same source objects as the outline, not a renderer
interpreting labels. Weights and fields remain syntax nodes. BT order belongs
to Lua. A BT list retains its actual source-table section and local table issues;
aggregate descendant `resolution` is a content warning, not membership evidence.
An opaque member does not hide its ordered siblings or the known wrapper weight.
Only unresolved/numeric-keyed/computed-keyed/known-mutated membership uses a
source-only list card.
Links to opaque values identify authored slots, not evaluated builder results or
guaranteed runtime children; attachment counts likewise count source slots.
No new parse, scan or topology work runs in draw/hit/pan. The independent source,
compiled-cartlib and three-backend gates are in the graph design.
BT Earlier/Later commands edit an actual `children`/`choices` source-list member,
not its canvas position. The cold projection retains the constructor, original
entries and selected entry index; command enablement is constant-time. Current
complete syntax, writable source and a proven sibling are required; an opaque
member value is not an unknown list. Weighted edges and child cards move the
whole choice field, retaining weight/child association. Named metadata does not
become a child index. Shared const lists remain one authored source, not private
copies per graph occurrence. The language-owned move and ordinary text mapping
retain the selected subtree through Undo/Redo. Both concrete lens focus targets
explicitly bind document history; parent focus does not provide command fallback.
See [`../docs/behavior_tree_authoring_design.md`](../docs/behavior_tree_authoring_design.md).

BT removal consumes that same proven member and the existing Lua field-removal
owner. It removes the source field and its separator, not a referenced initializer;
weighted cards/edges remove the complete choice. Exterior trivia and unrelated
syntax remain unchanged. One document edit/Undo clears the deleted source
selection without choosing a successor or restoring selection by name on Undo.
The normal command palette/action-bar expose Remove; unmodified Delete belongs
only to concrete graph focus and does not repeat or intercept code/gameplay input.
An empty authored table remains a table, not an editor-generated replacement
task or a promise that every composite can execute it. No new guest state or
runtime validator is introduced.

BT duplication uses that same member admission and the existing Lua table-field
insertion owner. It inserts the complete field before the retained selected
syntax; ordinary text correspondence therefore selects the second occurrence
through Undo/Redo, including while the Lens is hidden. BT graphs always show
their recognized children; source-outline folds belong to the outline control.
Aliases stay aliases, weighted wrappers keep their child and weight, and shared
constructors are edited once. Exterior documentation is not copied. No new
selection identity, graph history, runtime clone or Lua evaluator is introduced.
Duplicate is a normal palette/action-bar command; Ctrl/Cmd+D belongs only to
concrete graph focus and does not repeat. Warm enablement is retained O(1);
only the explicit edit copies source and invokes the language insertion owner.

FSM Set Initial uses the same Lua document and concrete graph-focus route.
`state_machine_initial.ts` indexes exact child membership and eligible atomic
values once per source generation; it does not infer ownership from layout
ancestry. `toolchain/ts/lua/syntax/string_literal.ts` owns Lua quoting, and the
shared source-edit/insertion owners preserve exterior syntax in one Undo step.
The command changes the actual declaring parent, including shared constructors,
without changing concurrency or interpreting the key as a transition path.
Normal Save/Hot Resume installs newly published definitions without resetting
the living FSM. A retained module-local blueprint is not implicitly reconstructed
or patched: the normal initializer must publish the new definition. No runtime
or machine changes are introduced. See
[`../docs/state_machine_authoring_design.md`](../docs/state_machine_authoring_design.md)
for source admission, real-backend live installation proof and unfinished
state construction/removal gates.

`state_machine_retarget.ts` owns source-operation admission for target-end
gestures. Relation binding retains its existing occurrence scopes and
the resolved source value for every known direct/return proof, even when target
membership is incomplete. Transitions refer directly to their origin scope;
geometry consumes its row key. The cartlib path owner produces parsed segments
and their original/generated text. Binding consumes them directly instead of
manufacturing AST literals or reparsing a proposal for every shared consumer.
Retarget analysis preserves the chosen absolute/relative anchor, widens it only
when necessary, binds all recognized uses of the same literal and retains only
the current candidate's evidence. It does not edit shared aliases, normalize
unaddressable keys, invent state entry for a zero-step plan or cache a quadratic
set of candidate-by-consumer plans. `state_machine_edit.ts` applies admitted
current-source evidence as one literal edit with before/after proof bookmarks
in the existing document history. The selection owner exposes input-independent
slot/entry and binding/function/return-start coordinates; history retains no AST
or graph references. A direct literal replacement explicitly selects its new
token; ordinary replacement still clears correspondence. Hidden views map a
deep copy and resolve the exact registration/slot/proof on their next projection.
Proof matching consumes the current index's per-consumer references directly;
ordinary correspondence and history restoration do not re-scan all transitions.
The cold source index also provides actual scopes and eligible literal proofs.
Physical target-end dragging consumes this capability, creates one analysis at
the gesture threshold and retains its current candidate. Initial/concurrent
edges and aliases do not become writable transition ports.

Shared source uses enter `WorkbenchSourceEditReview`, an editor-local control
built from the existing property tree, action bar and focus routing. The
contribution supplies impact text and exact source navigation. Source changes
synchronously dispose its proposal; readonly revokes Apply; input detachment
clears it. Palette focus can return to the still-current review. Apply detaches
listeners before one normal source edit; Source/Discard never apply. The pane
registers document Undo/Redo on the review focus like its other source controls;
an external edit invalidates the review instead of rebasing it. Review rows
cannot opt out individual uses of the same literal. There is no new modal router,
autosave input, working copy, guest patch or history stack. The complete physical
and live-install contract is in
[`../docs/state_machine_connection_edit_design.md`](../docs/state_machine_connection_edit_design.md).

FSM source bodies now retain child occurrences, guard fields and
consumer slots. A cold second pass binds initial/concurrent entries and possible
returned paths to those occurrence keys within one registration. Inline and
file-local const callbacks retain binding/function/return syntax; member and
cross-file callbacks remain unresolved. Callback return facts are not a proof
that the callback executes or has no other imperative effects. The cartlib path
grammar lives in `toolchain/ts/cartlib/fsm`, not in the renderer or generic Lua
binder. See the documented subset and compiled-runtime oracle before extending
these facts. ActionEffect bodies retain the twelve authored value/requirement
fields as original AST fields, with the same source nodes consumed by the
outline. Requirement sections retain their constructor/issues and syntactic
entries through the shared source-array owner, not a BT-owned representation.
Computed effect keys stay visible and unresolved; missing fields acquire no
defaults, callbacks are not executed, and an unresolved list is not a proven
empty requirement set. This is property source evidence, not an execution
graph: cartlib's periodic lane bypasses trigger gates/cooldown, and event is
an output rather than an input trigger. The compiled cartlib oracle and pinned
property-editor references are documented in the graph design. Retained canvas geometry belongs
to a shared workbench control, independently of document identity and runtime
execution slots. Input-owned registration/selection correspondence
maps source-use spans through the existing text-change owner, including hidden
inputs, and matches each use under its corresponding parent. Shared initializer
ranges or generation-local row keys alone do not identify an occurrence.
Only source outlines and property trees own/map folds; graph inputs have no
collapsed-child state or hidden outline.
Deleting/replacing a use clears affected correspondence; later Undo does not
guess it back. An explicit command may instead attach before/after selection
bookmarks to the existing document history. These record the exact occurrence
path, not persistent graph identity. Hidden views map one pending bookmark;
fresh projections resolve it through their existing source-range index. The
text model retains typed edit state without knowing code-view or Lens payloads.
See [`../docs/editor_edit_bookmarks_design.md`](../docs/editor_edit_bookmarks_design.md).
Click gestures belong to the pane and one source generation;
cross-file facts also require the existing semantic-generation invalidation.
A chosen BT or FSM has a concrete graph; a chosen ActionEffect has a grouped
source-property inspector, not a flowchart.
Source selection lives outside the discriminated presentation, not
in an invisible row list. It is now a discriminated source selection: node,
BT connection, FSM outcome or explicit entry. FSM proof selection additionally
tracks the binding use, bound callback and return syntax start; its declaring
slot must first correspond under the same source occurrence chain. Equal
targets and identical return text never identify an edge. Entry owner and
transition origin are separate: a concurrent declaration belongs to its own
state while entry originates at the parent. Only selected proof anchors are
mapped on content changes, including while the pane is hidden. Geometry does
not supply source coordinates. The shared Details command now exposes these
FSM references through Quick Input without executing Lua or authoring a second
graph. A picker session owns its provider subscriptions; content invalidation
closes a source snapshot, and accept/cancel/blur/replacement dispose those
subscriptions before returning focus or navigating. See the pinned VS Code and
CodeMirror references and edit-affinity decision in the graph design.
`workbench/ui/graph` and
`workbench/render/graph.ts` now own a shared retained canvas: one measured
geometry generation for draw and hit testing, input-owned pan/selection and a
pane-owned control for focus and gestures. Clip commands go through the shared
overlay renderer, not feature-local glyph/line clipping. The graph control has
no Lua, BT/FSM semantics or document-undo owner. Its input policy can be bound
by the concrete pane without replacing physical focus or capture.

Graph geometry includes the combined node/container/route/label bounds, computed
once at publication. `graph/viewport.ts` owns the padded finite range and a single
position shared by pan, reveal, wheel, edge scrolling and both scrollbars. The
content clip excludes their gutters. Middle-button drag, Space + primary drag
and primary drag on blank canvas pan at readable tiny-font scale. Explicit pan
over an item preserves selection and never starts its source-edit gesture.
Shift + wheel selects the horizontal axis; Space is not a gameplay binding.
`workbench/ui/scrollbar.ts` owns retained track/thumb geometry independent of
editor kinds. Only attached code/resource panes hit their own scrollbar kinds;
chrome hits the visible resource panel's bars, not inactive pane geometry.
The editor scrollbar controller retains their application callback; graph bars
use the same shared pointer capture as other graph gestures. See
[`graph_navigation_design.md`](../docs/graph_navigation_design.md).

`workbench/ui/graph/compound_layout.ts` is the domain-free ELK Layered adapter
for binary directed links and nested measured nodes. It retains typed node/link
identity locally; only layout geometry crosses the explicitly supplied engine
boundary. A layout generation is unpublished while the engine runs. Parent-
relative nodes and container-relative edge routes/labels become canvas geometry
once, after routing. The shared renderer paints container bodies behind edges
and opaque cards/headers above them; hit testing and reveal use the same header,
label and arrow geometry. This does not flatten a statechart into a tree.
The real-Worker conformance runs all three browser renderers. The concrete FSM
uses this compound graph; ActionEffect uses the property-tree control. Canvas geometry
is snapped once to the bitmap pixel grid at the ELK result boundary. See
`docs/behavior_graph_design.md`.

`workbench/ui/property_tree.ts` and `workbench/render/property_tree.ts` own the
shared retained property columns, measured text and bounded description footer.
They use the existing tree/list and overlay clipping owners, with whole hittable
rows above the footer. `property_tree_pointer.ts` owns generic click/fold/activate
gestures; a gesture belongs to a retained node, never to a recycled row index.
Tree navigation distinguishes selection from collapse rather than requiring a
contribution to scan or snapshot folds. The pane uses the normal focus, keyboard,
controller, wheel, action-menu and Source-navigation routes. Enter/A folds a
selected group; activating a property opens its source. Pointer sequences end on
detach/focus loss and cannot cross source generations; keyboard/controller
navigation and wheel input also end the previous click sequence.

`behavior_lens/action_effect_properties.ts` binds one chosen typed effect body to
this control on source changes, not in draw/hit/idle updates. Groups are display
metadata (Grant, Trigger requirements, Cooldown, Periodic, Execution, Unresolved
source), with no invented Lua nodes or execution order. Properties and requirement
entries retain their original source objects. Group folds are input preferences,
separate from source-node correspondence, and another chosen definition clears
them. Selecting a group clears field selection; Source then opens the chosen
registration. Source edits invalidate hidden hit rows immediately; the ordinary
input refresh maps source selection/folds and publishes new property rows. An
unresolved body, an empty body and a removed definition remain distinct states;
none selects a namesake or falls back to an outline. No graph engine is started.
Values are source excerpts, not calculated values or runtime defaults. The shared
Lua source reader preserves text and explicitly truncates multiline previews;
it does not collapse whitespace inside literals or reprint Lua. Inline functions
have a compact display marker and keep their original source link. This slice is
read-only, with no property-write stubs, reflected live objects, new working copy
or runtime metadata. The explicit raw-source outline remains a source-contract
test presentation, not a hidden navigation owner or automatic product fallback.
See [`actioneffect_properties_design.md`](../docs/actioneffect_properties_design.md)
for the pinned production examples, semantics, evidence and measured costs.

Editor inputs now own disposable resources. Group removal/reset disposes inputs;
pane deactivation only detaches the reusable control. The last active input is
detached before disposal, and shutdown preserves inputs through autosave capture.
Resource-owned text models and retained code-view contexts have separate lifetimes.
`workbench/services/graph_layout/async_layout.ts` owns a lazy engine and one active
layout plus the newest pending factory, coalescing before projection/measurement.
Its explicit idle/pending/ready/failed/disposed state belongs to the input, not a
callback that activates a pane. Invalidating revokes publication and waiting work;
disposal also terminates the worker. Async failures are state, never empty success.
`services/graph_layout/worker_requests.ts` owns the pinned upstream ELK request
protocol. `browser/graph_layout.ts` and `node/graph_layout.ts` own their native
worker transports, faults and termination. The Node worker entry bridges the
upstream in-process endpoint to `parentPort`, without an environment shim.
Product packaging copies the browser worker unmodified and separately bundles
the Node worker endpoint/bridge, with the upstream license/source notice. The bundle boundary
rejects ELK code in browser/Node Studio main-thread bundles and players; there is no UI-thread fallback,
second RPC protocol, GWT-error decoder or global environment shim.
`BehaviorLensInput` owns that session. Source changes revoke pending publication
and old hit geometry immediately, including while hidden. Definition/font changes
request a fresh measured generation; the active pane's normal update alone
publishes it, never an async callback that activates/focuses a pane. A retained
empty model represents pending/failed/removed geometry, not a successful layout.
`state_machine_index.ts` indexes typed bodies and proof references per document.
`state_graph_projection.ts` preserves state containment and emits a distinct edge
per proven entry/return/direct outcome; maps key edges by the current proof object,
not by a callback row or endpoint pair. Unknown/no-path outcomes stay explicit
source evidence on the owning state and in Details, with no fictional endpoint.
The common source correspondence remains authoritative through edits and Undo;
a surviving proof that becomes `return nil` keeps source selection but has no
geometric selection. Details enumerates owned source fields without descending
into child states. Accepting a source choice selects/reveals the corresponding
edge immediately, or clears geometric selection for a source-only field; it
does not wait for an edit or relayout to remove the previous highlight.
Graph Up/Down traverses nodes and edges; Shift+Up/Down and Left/Right pan.
Tab/Shift+Tab moves between the graph control and its title toolbar.
Gamepad up/down traverses, left/right pans, A opens Source and X opens Details.
All these routes are focus-local, never gameplay shortcuts. FSM collapse/graph
authoring and cross-file transition inference are not part of this slice.

`behavior_lens/graph_projection.ts` projects typed source relationships into
measured cards and source-backed links. `graph_geometry.ts` places the ordered
tree using the shared D3-derived tidy-tree layout and routes through level
gaps; `graph_layout.ts` owns invalidation and selected-item screen anchoring.
The common source correspondence remaps either a node use or a connection use.
In particular a weighted connection owns its choice occurrence, not the
shared choice initializer's child field. Details use the existing Quick Pick
and exact source ranges; they are not editable properties or an inspector DTO.
All statically recognized children are visible from the first generation;
there is no Children command, card expander or fold shortcut. Large graphs use
the shared scrollbars/panning, not hidden branches or smaller text. Text fields
above the graph retain Space as text input; palette execution uses the invoking
control's focus context.
Keyboard/controller navigation follows parent, first child and siblings. Source
and Details commands use the same action bars and Command Palette as other
contributions. Pan, hover and selection never reparse or relayout the tree.
There is no zoom-to-fit, permanent side panel, guest hook or visual serializer.
FSM relationship proof and cyclic layout remain separate slices.

`input/pointer/capture.ts` owns delivery of a captured physical gesture before
ordinary pane/chrome hit testing. Release, invalid/outside-display input,
exclusive popup/menu input, pane detachment and IDE deactivation end capture;
they never postpone it until a popup closes. The owner is detached before its
release/cancel callback. The snapshot producer publishes separate held/press/
release masks for all three buttons; capture latches the initiating button.
Only that unconsumed physical release edge authorizes a drop; lost or consumed
pressed state cancels instead. Browser input consumes chorded button edges on
`pointermove` as well as down/up. Pointer cancellation resets its logical device,
not keyboard input, and never fabricates a release. Focus and capture are distinct: menus may retain command
focus while ending a drag. The graph control uses this route without inventing
button edges; other existing controls have not all been migrated to it.

For BT sibling reorder, the graph control owns press/threshold, captured source
selection, retained preview, host-time edge scrolling and interruption. The
contribution supplies a source-version-owned drag session, decides sibling
insertion sectors and commits one ordinary Lua text edit on an accepted release.
It does not move nodes during preview or infer reparenting from diagram position.
The generic control/renderer knows no BT syntax; `behavior_tree_drag.ts` knows
no new input edges or document history. See
[`../docs/behavior_tree_authoring_design.md`](../docs/behavior_tree_authoring_design.md).

The same graph gesture lifecycle supports explicit selected-edge source/target
handles. The contribution publishes current endpoint capability and receives
the exact press edge/end after the threshold; capability revocation cancels
even a pending press. Connection feedback has a retained provisional line and
arrow buffer, with a contribution-admitted target or a free pointer. Generic
geometry fixes the opposite endpoint and clips an admitted target to its measured
header; it neither predicts a layout nor knows domain connection rules. Published
edge directedness survives degenerate geometry. Arrow visibility is separate from
retained storage, which never shrinks/regrows during directionless motion.
The renderer replaces only the dragged route, draws the provisional wire below
headers, and paints/hits explicit handles above them. BT insertion remains its
own feedback variant, not a disguised connection. See
[`../docs/graph_connection_interaction_design.md`](../docs/graph_connection_interaction_design.md).
The FSM contribution now connects target-only capability, exact proof history,
shared-consumer review and ordinary Save/Hot Resume to this shared control.

Scene authoring uses the same document contract, but its runtime object and
viewport owners are deliberately not inferred from the behavior projection.
The accepted cross-owner design and prerequisites are documented in
[`../docs/studio_scene_authoring_design.md`](../docs/studio_scene_authoring_design.md).
The first writable primitive is deliberately narrower: a complete table-field
value that is a numeric literal or its unary negation. Scene positions retain
the syntax fields, not detached literal subtrees. The generic Lua-language
owner returns an ordered `EditorTextEdit[]` changing only the number token and,
when needed, the unary-minus token. Intervening parentheses, comments and
whitespace are never included in a replacement range. Computed field values
remain code; changing a literal subtree inside a larger expression would need
its parent's precedence context. This layer does not apply edits, know cartlib
types, or become a second working-copy owner. One batch is one undo element;
an unchanged token produces no document mutation. This is enough for the first
transform edit without pretending that the current syntax tree is already
full-fidelity.

The parser now owns complete table-field ranges, including expression-key
brackets and grouping, while child expressions keep their semantic ranges.
`ParsedLuaChunk.tokens` already owns separators. A language-owned removal
primitive deletes a complete field and its following comma/semicolon as
separate spans in one edit batch, keeping every exterior comment and whitespace
byte. It consumes a complete parse of the current buffer version; it does not
guess syntax from text. Identical immutable ranges/endpoints remain shared.
There are no new AST properties or per-field trivia arrays.

Field movement now uses syntax-owned trivia attachment over that
same lexer's opt-in scan. Following trivia through the first newline belongs
to the preceding token; the remainder leads the next. Complete field/separator
pairs retain exact spans during a move. The braces keep their own trivia, and an originally
separator-less last field gains a comma before its trailing comments when moved
before a sibling. No default trivia tree, formatting pass or source normalization.
Insertion places producer-owned complete field syntax. Cross-constructor
transfer instead consumes the existing punctuated span, deletes/inserts only
that payload and returns its exact final source range. It does not copy the
intervening document to preserve a deleted marker. Explicit before/after
bookmarks now provide parent-changing selection through document history;
a reconnect command must consume the source-role, dependency and lexical
evidence described below rather than infer admission from visible edges;
structural edits on recovered source still need an error-tree contract. See
[`../docs/lua_table_transfer_design.md`](../docs/lua_table_transfer_design.md).
The [BT transfer query](../docs/behavior_tree_transfer_admission_design.md)
now retains actual branch ownership in list membership and local constructor
issues separately from inherited display resolution. An explicit analysis
indexes recognized child/choice/attachment consumers across the source document,
checks reachable constructor dependencies and uses the existing lexical
relocation owner. Compatible sharing remains sharing; mismatched roles do not
invent or discard weights. Cached candidate checks do no source/graph work.
This is source evidence, not whole-program effects or live closure migration;
reconnect UI still requires the command/fold and actual Hot Resume gates.
The semantic binder owns lexical membership separately from global writes and
table properties. Its scope kinds distinguish method-owned receivers from
ordinary functions. `LuaRelocationAnalysis` retains one semantic snapshot,
collects free value-name/vararg bindings and reports exact destination changes;
it does not infer identity from receiver classes or rewrite captures. See
[`../docs/lua_relocation_bindings_design.md`](../docs/lua_relocation_bindings_design.md).
The shared lexer also
has an opt-in trivia scan, used by Format Document instead of a second comment
regex; default compiler/analysis scans still allocate only significant tokens.
Formatting preserves string/comment content on opening and closing lines as
well as their interiors. The remaining syntax gates and measured costs are in
[`../docs/lua_source_syntax_design.md`](../docs/lua_source_syntax_design.md).
Scene, BT and FSM contributions must not grow their own comma/comment scanners.

The Scene Editor's Remove action consumes that language-owned field removal.
It shares the current parse with semantic analysis and is unavailable for
readonly documents, recovered syntax, no selection or a selected dynamic
composition. The workbench's source-command admission accepts the focused
property before the controller reads the new source ranges. An invalid draft
keeps its focus and error; an accepted property and the structural edit are
separate ordinary document-Undo elements. Removing a member focuses document
history and clears the inspector selection, without deleting a living actor.

The Up/Down actions retain the actual parent objects-table and scene-local
index in the source projection. They admit only a sibling in the same complete
direct definition, never a visually adjacent row across scene boundaries or
partial composition. The same source-command preflight accepts pending values
before current syntax is read. One language-owned edit batch is one document
history element. The language operation moves intervening text around the
selected field without replacing it. Existing source markers therefore follow
that same member during edits and Undo/Redo, without a destination-index
selection override or second selection history. The command focuses document
history and reveals the retained selection. Stable frames do not relex/reparse;
the lossless token scan exists only during an explicit move command.

Its original Nemesis trial exposed a separate compiler/linker closure-layout
limitation. That owner now retains original live capture slots before lowering;
see [`../docs/lua_capture_identity_design.md`](../docs/lua_capture_identity_design.md).
Ordinary Save & Hot Resume and `<init>` therefore apply the title-member removal
and its Undo/reapplication in the same heap. The compiler's incompatibility
checks remain active. The UI does not bypass them, restart execution, pad a
descriptor or add a dummy cartlib dependency.

The first scene source adapter edits the registered structured Lua definition
and uses the ordinary save plus Hot Resume path. Registration changes the
definition used by future instantiations; it does not infer mutation of an
already living objectgraph. A later live-instance command requires its own
concrete cartlib operation and correspondence owner first. Until that owner
exists, the IDE adds no hidden module-root lookup, runtime `require`, heap scan,
generic call-by-string route, undo callback or guessed guest mutation.

`View > Scene Editor` opens that adapter on a source with recognized scene
registrations. `contrib/source_views/quick_access.ts` admits the active
resource-owned working copy, or explicitly offers matching workspace documents
in Quick Input. Recognition remains contribution-owned and uses the current
unsaved text; an entry file with no registrations is not a scene.

`View > Behavior Lens` always offers individual FSM, BT and ActionEffect
registrations in Quick Input, including from an existing code or lens pane.
The behavior contribution's shallow registration producer owns authored ids,
resolved ids when available, kind, exact source locations and occurrence keys.
Its retained index serves both this picker and Scenario Lab's id-to-source
lookup; unknown ids remain source expressions rather than guessed runtime ids.
Labels name behaviors; path and domain/line are secondary disambiguation.
Acceptance opens the exact registration occurrence in its own retained input;
the source resource still owns the one shared text model. Reopening a surviving
occurrence preserves its input, selection and viewport. Source topology, FSM
indices and mapped occurrence indices are shared document generations, not
duplicated for each view. Other documents' topology is not built by this opener.
See [Behavior Quick Access](../docs/behavior_quick_access.md) and
[definition input lifetime](../docs/workbench_definition_inputs_design.md).

`SceneEditorInput` attaches the resource-owned `EditorTextModel` directly,
without creating or requiring a code tab.
The controller projects direct `scene_library.register` definitions at a new
source version using the shared text snapshot. The retained source outline has
one root per direct definition, including empty or keyed-only definitions, and
ordered member children. `workbench/ui/tree_view.ts` owns parent/children/depth,
collapse, the visible node list and tree navigation, reusing the existing list
geometry/scroll/reveal owner. It knows no Lua or scene semantics. As in
[VS Code's source outline](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/workbench/contrib/outline/browser/outlinePane.ts#L255-L288),
label clicks select and twistie clicks expand; childless roots have no twistie.
Left collapses/ascends, Right expands/descends. Collapsing a selected descendant
selects its visible ancestor rather than retaining an invisible edit target.
Only member selection binds member commands and position controls; an empty
definition is not a synthetic member or an absent scene.

Scene details are a measured vertical content view, not fixed screen rows.
`workbench/ui/scroll_viewport.ts` owns its clip, reserved track and content-to-screen
projection; the existing `Scrollbar` owns position, range, thumb geometry and
interval reveal (also used by graph viewports). `scene_editor/layout.ts` measures
wrapped labels, field rectangles and explanatory notes on source/selection/layout
changes. Scroll only projects retained rectangles. Render and pointer input use
the same clipped viewport; the outline's partial last row is neither drawn nor hit.
`WorkbenchScrollControl` owns capture and keyboard scrolling, not documents.
Wheel/scrollbar interaction preserves a focused field's draft; field focus and
layout changes reveal that field. Manual scroll is not undone by stationary
updates. Tab traverses outline, scroll area, editable fields and title actions;
the scroll area uses the pane's explicit document command context. Its own
arrows/Page Up/Down/Home/End reach even read-only content. Geometry changes and
pane detach cancel physical capture. See the production references and evidence
contract in [Workbench scroll views](../docs/workbench_scroll_views_design.md).

Names are display labels, not selection anchors or runtime ids. Selection
tracks the full definition or field's
source span through the text model's actual changes, including Undo/Redo while
the scene view is hidden. A removed/replaced span collapses instead of selecting
a surviving namesake. Only the initial projection chooses the first root.
`scene_editor/outline.ts` also retains root collapse state by the mapped
definition span across source generations, including hidden-source edits.
Complete replacement/deletion clears correspondence; no name/id fallback or
separate undo history resurrects it. A member move selects its known
parent/child destination, never an assumed adjacent visible list index.
The pane owns document commands, and its three `IntegerInput` controls own
unsubmitted position text. Layout, rows,
source labels, field geometry and focus order are retained. Visible tree rows
are rebuilt only on source/topology or collapse changes. Rendering uses the
existing IDE tiny font and shared list/action-bar/text primitives at 384x288;
there is no guest viewport, graph evaluation or per-frame source parse.
Unsupported position expressions remain visible as source, partial composition
is labelled partial, and generated documents have no edit controls. Source
navigation uses the ordinary resource/navigation owner.

`EditorTextModelContentChangeEvent.changes` describes replacements in application
order, with offsets into each preceding change's output. History produces the
correct inverse order and lengths; coalesced typing publishes only the newly
committed replacements. These immutable length records never expose undo
subtrees or duplicate source text. `editor/text/text_change.ts` implements
non-growing, collapse-on-replace source ranges following [VS Code's marker
mapping](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/common/model/intervalTree.ts#L398-L490).
The existing model-service event updates retained scene inputs, without a new
per-input subscription/lifetime or a render-time diff. The pane separately
remembers its bound source generation, so command-admission refresh cannot
consume the view's pending control/layout update.

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
kind, title/description metadata and close policy. Explicit read-only and working-copy subclasses
own the dirty capability instead of an optional model field. The code,
resource-viewer, Behavior Lens and Scenario Lab contributions own their
specific model or view references. The static `EditorInput` union remains the
product's exhaustive built-in composition boundary.

Code, Scene Editor and Behavior Lens inputs project dirty state directly from
their resource-owned `EditorTextModel`; read-only inputs inherit the read-only
`false` contract. The lens is a source-editing projection over that model,
not a separate document. Neither source projection depends on the
lifetime of a code-tab context. Behavior inputs name their definition; Scene
inputs name their tool. The group adds source descriptions for duplicate titles;
a contributed Source action opens the selected syntax location through resource
navigation. Tab
layout and rendering invoke `input.isDirty()` polymorphically and never infer a
working copy from the input kind or from the active code widget. Input objects
are allocated only when retained and are reused across pane activation.

`EditorTabGroupModel` owns one explicit clean preview slot. Normal Open keeps an
input; Preview may replace the previous preview only after its pane detaches.
Keep Open, tab double-click, tab drag and working-copy dirty changes promote it;
Undo to clean does not unpin it. An input is never repurposed to another
registration. Deleting its registration leaves that input without a target,
not pointing at the next ordinal or a same-named insertion.

Chrome uses one clipped horizontal tab row, with the shared scrollbar and
captured thumb control. It publishes a bounded pixel height to layout, not an
unbounded row count. Group/geometry changes request active reveal; ordinary
scrolling does not. Tab drop feedback and captured host-time edge scrolling
precede the accepted group move. Label measurement and geometry are retained,
offscreen tabs are not painted, and disposal releases their hit rectangles.
The design and production references are in
[`workbench_definition_inputs_design.md`](../docs/workbench_definition_inputs_design.md).

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

## Workbench pointer input

The host `PointerInput` owns physical button levels and event-latched press/
release edges. Workbench dispatch projects those edges directly, respecting
current-frame input consumption; views do not reconstruct a second button
history. A held pointer cannot become a new press after source navigation,
editor activation or dismissal of an exclusive input surface.

The IDE owns gestures separately: code selection, click counting, field
selection, scrollbars and tab/panel dragging. Source selection and input
changes cancel their affected gestures without resetting physical input.
Production references, the held-navigation regression and validation are in
[`studio_pointer_navigation.md`](../docs/studio_pointer_navigation.md).

## Workbench Quick Input

`workbench/services/quick_input/` owns a single transient picker above the
workbench, not an inline widget in the active code editor. The existing
`TextField` owns typing and local Undo/Redo; the existing focus service owns
its concrete root target. Cancellation restores the actual invoking control.
Blur closes without restoring focus over the destination. IDE deactivation
therefore dismisses the picker through the normal focus lifecycle, without
feature-specific close calls in tabs, navigation or scene properties.

The workbench dispatches popup pointer/wheel input before underlying chrome,
pane input and scrollbar dragging. An outside primary press cancels without
click-through; a held press does not activate an underlying control afterward.
The pointer-frame owner keeps sampling snapshots/releases but ends lower
scrollbar, tab and panel-resize gestures while an exclusive input surface is
active. A gesture is cancelled, not suspended for the popup's later dismissal.
The popup owns Escape before a lower code widget. Shared command routing still
targets the input field's history. Property drafts continue to use their own
ordinary blur policy; the chooser neither commits nor validates scene data.

`QuickPickModel` retains rows, search keys and filtered row storage. Filtering
runs on field changes, not frames. Labels are measured only when items,
viewport width or font change. `editor/ui/inline/single_line_viewport.ts`
retains glyph advances and reveals a bounded whole-glyph span of the complete
single-line query, without a query-length cap or substring drawing. The picker
uses the active IDE font and does not modify code-area geometry.
Its normal surface follows the workbench theme. The theme owner supplies a
paired selected foreground/background for all row text, including descriptions;
normal black text is never reused over the blue selection fill.

`contrib/resources/quick_access.ts` produces display items referencing the
source owner's exact `RuntimeResource` objects. The path is displayed once,
alongside resource kind and domain, not repeated as an asset id. Acceptance hides before
ordinary resource navigation. Matching does not guess paths or merge
same-named resources from different domains. There is no second resource
catalog owner, code-tab activation prerequisite, or generic prefab/scene schema.
The removed `@`/`#`/`:` redirection to code-only widgets is not emulated;
explicit symbol and line commands retain their own contexts.

`pick` admits a typed item provider once, after focus has left the invoking
control. Replacing a picker first restores the original control; its ordinary
blur policy runs before enumeration. The provider receives that control
explicitly, not the new query field's command context. No provider work runs
on filtering or presentation frames.

`contrib/commands/quick_access.ts` projects the existing command catalog,
categories and keybinding labels into this picker. `IdeCommandController`
evaluates focus-dependent availability against the explicit invoking control;
menu/key queries keep their default current-focus semantics. Query Undo stays
local. Accept returns focus, checks current command availability, then uses
ordinary command execution, pending-edit acceptance and confirmation dialogs.
An action that became unavailable during an asynchronous operation is reported
as unavailable, not executed against a missing run. There is no second command
registry or palette-specific Save/Hot Resume/Reboot path. Short toolbar titles
and full command titles are presentation metadata of the same action. Compact
dropdowns and title action bars request the same short title from the catalog;
the palette keeps the category-qualified full title. Categories describe the
task owner, independently of menu placement: opening Scene Editor, Behavior
Lens and Scenario Lab groups with their own actions, not with View commands.
The behavior contribution offers kind-specific ActionEffect/FSM/BT choices
over its one retained registration index. The requested producer kind is
independent of query text; no second view or source schema is introduced.
See [typed behavior entry points and production references](../docs/behavior_quick_access.md#typed-entry-points-and-command-categories).

Command Palette is available through View and Ctrl/Cmd+Shift+P while the IDE
owns input. Gameplay retains those keys. Shared symbol Quick Access remains
separate work: the provider must retain semantic-query, source-range preview
and cancellation ownership before replacing its existing widget.

This takes the current production VS Code Quick Input ownership, not its DOM,
service registry, animations or compatibility paths:

- [command enumeration in the invoking editor context](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts#L224-L268);
- [focus acquisition and blur](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/platform/quickinput/browser/quickInputController.ts#L337-L356);
- [focus return only while the popup still owns it](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/platform/quickinput/browser/quickInputController.ts#L824-L860);
- [separate popup and focused-item color roles](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/platform/theme/common/colors/quickpickColors.ts#L17-L59);
- [Godot LineEdit caret reveal](https://github.com/godotengine/godot/blob/6a0f6f32cfb2ce4cc5bad6641d0afda413b62a9d/scene/gui/line_edit.cpp#L2380-L2396).
- [Godot viewport input blocking drops the previous mouse focus](https://github.com/godotengine/godot/blob/6a0f6f32cfb2ce4cc5bad6641d0afda413b62a9d/scene/main/viewport.cpp#L3729-L3758).

Prefab selection and instance construction remain a separate scene-authoring
contract. A general picker does not justify guessing constructor options.

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

`scenario_lab/media_build.ts` prepares dirty canonical ROM layers and the first
derived test cartridge without machine writes. The run service publishes them
only after both builds succeed and the request remains uncancelled, then opens
the media session. Failed initial preparation cannot reboot the existing game
or acknowledge uninstalled source. Later-item failure restores canonical media
because that session really has installed a derived cartridge. The existing
IDE `installBlua32Media` coordinates physical ROM-byte publication and source
bookkeeping; it is not an execution-image or source-revision API on the CPU.

Scenario protocol calls execute outside outstanding exception frames. The
shared execution service uses the CPU-owned outer return depth and existing
suspended executor before admitting a new callback. Other `Runtime.callClosure`
callers keep their explicit current-context semantics. No cartlib hook, IRQ-mode
rewrite or host DMA loop is introduced.

`ScenarioLabController` only resolves the current view selection, captures the
source batch and invokes that service. It does not loop over tests, retain an
execution queue, write cartridge media, aggregate result state or implement a
second cancellation path. One request and one retained run represent either a
leaf or the complete selected suite. A failed item does not stop later items;
cancellation marks unfinished items skipped. Rerun preserves the previous
resolved request. The service publishes `started` only after the first item
actually starts; the controller then releases user-requested pause through
`HostExecutionControl`. Failed preparation and subsequent batch items preserve
pause, and other host pause reasons retain their independent ownership.

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

### Canvas focus and text commands

`input/focus.ts` owns one retained `InputFocusTarget`. Code text, inline fields,
resource/problems panels and non-code editor views bind their own keyboard
handler; the input dispatcher calls that target after workbench keybindings.
There is no second per-widget `active`/`focused` boolean or keyboard switch that
guesses focus from the active tab. Visibility remains separate: a Find result
can remain visible while code text has focus. Caret presentation consumes the
same focus owner.

A focus transition first detaches the departing target, emits its blur event,
then installs and notifies the new target. The editor group releases the old
control **before** replacing the active resource or clearing its pane input.
`EditorPane` owns only view/input lifecycle (`focus`, `clearInput`, `dispose`),
not history inferred from its input class. Concrete owners bind at construction
or workbench composition and unbind at disposal; dispatch does not build a
handler list or allocate a new command context each frame.

Undo/Redo are registered by the actual control. The code contribution uses the
shared `EditorTextModel`; the retained input restores cursor/selection from its
content event, and `undo_controller` reveals the active widget's result.
Blurring code ends its typing undo group. `TextField` owns its own
small text/caret/selection history; typing, Cut/Paste and history traversal emit
the same content-change event. Query/result owners subscribe once. Programmatic
field resets start a new history, and a field locked during resource creation
does not admit edits. Empty or disabled field history still owns the keybinding:
it never falls through into the underlying document. A target's parent is only
its focus-return destination, not command inheritance.

The Edit menu and repeatable Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y bindings
use these contributions. Keybinding applicability is distinct from command
enablement so an empty field consumes Undo without enabling the menu item.
Menus retain the invoking editor control's command context. The existing
blocking-modal scope intercepts **all** pointer, wheel and keyboard input before
background menus, panels or controls; individual controls need no modal guards.
The clipboard provider, not the active code widget, owns the shared text cache
and the optional OS write. Input controls publish clipboard feedback through
`input/clipboard.ts`.

Save and Hot Resume remain document/source operations, not an implicit acceptance
of every open input. Find text is a query, not source. Rename is an explicit
refactor: Enter accepts, Escape or loss of editor-control focus dismisses its
unsubmitted draft. The concrete `IntegerInput` instead contributes an `InputEdit`
to its focus target. Decimal signed-integer text is human input, not a runtime
DTO: Enter or valid focus loss accepts one value change; Escape cancels it.
Invalid Enter or a source command leaves the draft focused with an error.
Invalid focus loss rejects and resets the draft with a visible warning, not a
silent source mutation. A successful acceptance resets only the field history;
the document batch remains undoable from either source view.

The command controller accepts a contributed edit once before a source-consuming
command chooses dirty models, opens a prompt or captures asynchronous build
inputs. Save is enabled for a pending property even when its document was clean.
Find and Rename contribute no implicit source acceptance, and generic panes
have no `commitPendingEdits` success stub. View switches and IDE hiding use the
normal blur lifecycle while the old input is still attached. Pointer targets
are chosen by the concrete view before focus changes, so clicking within a
field does not first blur it through its parent pane.

The containing view programs next/previous targets for its content controls and toolbar.
Unmodified Tab/Shift+Tab traverses only that declared order. Controls without
an order, including code text, retain their ordinary Tab semantics. These links
are focus navigation, not document-command inheritance.

`InputFocusTarget.commandContext` explicitly identifies the action owner (the
control itself by default). A toolbar carries its content control's context;
command enablement, palette-origin queries, keybindings, pending-value admission
and execution resolve that same owner. The focus-return `parent` still provides
no command fallback, including for a field with empty Undo history.

`WorkbenchActionBarControl` attaches to retained input-owned items/geometry.
Primary down arms an enabled action, using the shared pointer capture without
blurring a field; only release on the original button invokes the command.
Focus/capture loss, Escape, input replacement or disablement cancels the press.
Its single Tab stop uses Left/Right and Home/End to visit enabled actions;
unmodified Enter/NumpadEnter/Space pairs down with release without repeats.
The render owner distinguishes hover, pressed and disabled states and draws a
focus underline in the button padding, independent of theme color equality.
Scene, Lens, Scenario Lab and Source Edit Review use this one control, not local
press-time dispatch. Scenario tests/results have separate physical focus targets;
their selection state no longer doubles as a feature-local Tab router.
See [A01 ownership and production references](../docs/workbench_action_controls_design.md).

Production references for these specific boundaries:

- [Godot Viewport focus owner and notifications](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/scene/main/viewport.cpp#L2732-L2757)
  and [detach-before-blur](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/scene/main/viewport.cpp#L3795-L3807).
- [VS Code concrete text-command targets](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/browser/coreCommands.ts#L305-L350).
  BMSX adopts control-owned handling, not the final VS Code active-editor
  fallback when another view has focus.
- [Godot LineEdit history](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/scene/gui/line_edit.cpp#L1790-L1854)
  and [VS Code Rename input lifecycle](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/contrib/rename/browser/renameWidget.ts#L467-L525).
- [VS Code modal input containment](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/base/browser/ui/dialog/dialog.ts)
  and [clipboard-service storage](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/platform/clipboard/browser/clipboardService.ts#L117-L155).
- [Godot value submission, focus loss and focus order](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/editor/gui/editor_spin_slider.cpp#L630-L738)
  and [editor changes before scene save](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/editor/editor_node.cpp#L2512-L2535).
  BMSX does not copy Godot's expression evaluator or silent invalid-input path.
- [VS Code numeric settings control](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/contrib/preferences/browser/settingsTree.ts#L1991-L2050)
  separates text input, human-input validation and the accepted property change.

The production references are VS Code's single action registration path, which
publishes one command descriptor into command, menu, and keybinding registries,
and its weighted/contextual keybinding resolver:

- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/actions/common/actions.ts#L679-L779>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/keybinding/common/keybindingsRegistry.ts#L62-L68>
- <https://github.com/microsoft/vscode/blob/f6f7c31e6cd2541fdd901f045a3418a06f2c3aca/src/vs/platform/keybinding/common/keybindingResolver.ts#L320-L395>
