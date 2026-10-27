# Live Actor tools

Conversations share Actor Lab inspection and explicit instance execution.
`studio_list_actors`, `studio_read_actor_tree` and `studio_read_actor_node`
operate inside an explicit `studio_inspect_runtime` suspension. They neither
open an Actor Lab pane nor dispatch UI commands. The ordinary pane and tools
share `ActorRuntimeTree` and the existing runtime property inspectors.
`ActorExecutionService` separately owns the live actions and stored-method calls;
neither tool execution nor its lifetime belongs to the pane.

## Reference and ownership gate

The production references are [Godot's scene debugger](https://github.com/godotengine/godot/blob/master/scene/debugger/scene_debugger.cpp)
(request tree, inspect actual object IDs and mutation as separate messages) and
[VS Code's debug model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts)
(lazy suspended-state references, distinct from rendered variables).
Their transport validation/compatibility policies are not copied into BMSX
runtime reads.

The [cartlib inspection contract](cartlib_inspection_contract.md) governs these
read-only field accesses. World `_objects` is admitted membership, not a heap
census; WorldObject owns component ordering and the class-table index; FSM
instances retain their own states/definitions; BT retains
its own blackboard layout and compiler-owned execution memory; ActionEffects
retain their granted instance and definition. No separate authored scene graph,
same-name source match, source re-execution or source-derived runtime object is
introduced. Source tools and instance tools remain distinct.

| Data | TypeScript representation | C++ representation | Boundary |
| --- | --- | --- | --- |
| World/component membership | guest Tables and class-table keys | guest Tables and class-table keys, same cartlib | no producer/ABI change |
| Value identity and kind | `Table.hashId`, `ValueTag` through `SuspendedGuestSession` | guest table identity/tags | no machine change |
| Activity predicates | guest tags: only nil/false are false | same CPU guest truth predicate | central suspended-reader predicate; no CPU change |
| FSM/BT/effect/timeline state | actual retained cartlib instance fields | same cartlib and guest fields | shared readers; mutations call existing Lua APIs |
| Inspection identity | stop-scoped IDE handles | no IDE projection | IDE-only inspection, separate from native Terminal |
| Execution/rewind | existing host invalidation before execution/heap replacement | existing native runtime owners | no CPU hook; IDE observes explicit call entry and active operation status |

The ordinary Actor pane refreshes dirty readback after a CPU slice.
`runWorkbenchHostFrame`, guest calls and restore operations own invalidation;
Actor tooling adds no instruction, renderer, compiler or cartlib-scheduler hook.
An unchanged Actor pane still reuses rows/labels; closed panes do no tree work.
Tools walk no actor until requested, reconcile a requested actor once per
suspension, cache its flattened paging index and format a node's properties once.
World pages read the dense membership array directly rather than rebuilding an
all-world tree per page. No model polling is introduced.

## Debug navigation

Actor Lab separates the **inspection selection** (including action targets),
**activity decorations**, and **viewport follow**. These are not three ways of
setting one selected row. VS Code's [tree reveal](https://github.com/microsoft/vscode/blob/main/src/vs/base/browser/ui/tree/abstractTree.ts)
expands/reveals independently of selection; its [call stack view](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/callStackView.ts)
refreshes at model/visibility boundaries. [Unreal's StateTree debugger](https://dev.epicgames.com/documentation/en-us/unreal-engine/statetree-debugger-quick-start-guide)
likewise distinguishes the chosen instance, active states, and inspected time.
These interaction patterns inform the view; they do not require guest tracing.

- Components and machines retain their owner's explicit list order. State maps,
  timeline maps and effect maps use stable name order for presentation only.
  The guest's `state_ids`, initial state and concurrent traversal are untouched.
- Tree rows and Details captions share semantic naming. A unique numeric
  component uses its type name, not a count-looking type/number label;
  same-type siblings add `#` and their actual component ID. Named components
  retain their authored name. Descendants omit an exact owning-actor namespace
  only when the result cannot collide with an actual unqualified sibling.
  Different remaining owner paths stay distinct. Full runtime names and typed
  identities remain available independently of these compact display labels.
- Runtime storage traversal and display order are retained separately. Membership
  changes reconcile by identity and sort affected sibling lists; ordinary
  activity changes update decorations/revisions, not rows, labels or geometry.
  Row expansion and the scroll anchor survive sibling insertions and reordering.
- **Follow / Unfollow** tracks the selected machine (when started on a state),
  timeline/effect component (when started on an entry), or selected actor/component.
  **Reveal Active Behavior**, in More or the command palette, does this once.
  Neither changes the selection, keyboard focus, nor the target of an action.
  Parallel active branches share one reveal range, not a fabricated single current
  state. An oversized range keeps an already visible active endpoint; if the
  viewport only contains the gap between branches, it reveals the first endpoint
  in stable tree order. It never oscillates between endpoints or auto-zooms.
  Inactive siblings are not reordered behind active ones.
- Manual navigation/scroll/pan stops following. Merely interacting with the game
  preview does not. Details stays available with the preview and selected
  hierarchy while playback, frame stepping and history review update the
  inspected values. A compact icon toolbar contains actor selection/Back,
  Follow, and More, with full hover/keyboard hints and a checked Follow state;
  instance mutation commands remain in More, the context menu, and the palette.
  The toolbar belongs to the hierarchy area. The preview has no permanent
  **Game Frame** strip, and the pane does not repeat **Paused** above content.
- Switching tree/graph carries the explicit selected instance. The graph model,
  zoom and viewport survive returning to the tree and reopening that same machine.
  Long tree identifiers elide the middle with one ellipsis glyph, retaining
  distinguishing suffixes; the selected full identifier remains in the status
  bar. This uses the common text
  layout owner, following [VS Code's middle truncation](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/strings.ts).
- The hierarchy or graph is the primary client. Its current-font reading budget
  and a useful game image must both fit after reserving the visible timeline;
  otherwise the primary client receives the complete area. The withheld preview
  and sash leave pointer admission and keyboard navigation until they fit again.
  Reflow retains the requested split ratio, selected subject and playback mode;
  Details remains available independently of preview visibility.
- Follow observes only the completed history position. Missing historical
  instances are visibly unavailable and cannot receive actions; live-branch
  admission and heap replacement retire invalid bookmarks. Timeline **Scrub**
  remains an explicit guest operation, not machine-history rewind.

[Event-to-frame navigation](studio_event_viewer.md) shares the physical rewind
owner. A selected event payload is not a live Actor handle and does not select
an actor by emitter display text.

### Compact runtime transport

The shared runtime timeline is one font-aware strip: frame back, Play/Pause,
frame forward, the history range, review offset and explicit review decisions.
Controls use the shared icon geometry and complete hover/keyboard hints,
not font-dependent combinations of punctuation. Play/Pause reflects the actual
displayed transport. The live endpoint needs no **Now** label; a reviewed
position displays its offset from the retained present.

Review decision slots and the offset column retain their geometry while a seek
changes position, so entering review or changing the displayed digits cannot
cancel a captured scrub. **View: Show Runtime Timeline** reveals and enters the controls
without a pointer or a new gameplay shortcut. Tab moves through eligible
transport controls and back to the owning content; an unavailable range is
skipped. Escape returns to that content through the normal focus owner.

A selected Actor timeline has its own single-row program scrubber, with current
time and duration beside the range. It does not add a second full-path heading
or a redundant zero-time footer. Program scrubbing still calls the actual guest
operation; it is not machine-history navigation.

## Pick in the live preview

Hovering a standard sprite outlines its visible rectangle. With Studio focus,
the status area shows its actual instance identifier and prefab definition
when present; game focus instead keeps the focus-release hint visible. Hover
alone neither pauses nor changes selection, and the outline remains available
while the game has input focus. With Studio
input focus, right-click inspects that actor through the ordinary Actor Lab
selection path and pauses the view. Primary click still focuses the game and
reaches HID. With game input focus, pointer buttons within the unobscured
preview belong to the game. Shift+F1 releases that focus before an inspection
click.
The hover rectangle uses the ordinary neutral border; the accent frame still
means game input focus. There is no new permanent toolbar, selection mode, or
guest shortcut.

The [shared pointer route](workbench_windowing_design.md#guest-pointer-admission-is-a-host-input-boundary)
gives a new gesture to the frontmost admitted surface under the pointer. A
Details window above the preview receives its own new gestures. The first press owns the
whole gesture through the final button release, so a game drag continues across
Details and a Details drag never switches to the game. Capture is separate from
cursor locking and keyboard focus. Hover picking stops over an occluding
surface, including when that surface opens without pointer movement.

This follows [Godot's CanvasItem picking](https://github.com/godotengine/godot/blob/4.4/editor/plugins/canvas_item_editor_plugin.cpp):
map the pointer into actual view coordinates, use visible draw geometry and pick
front-to-back. BMSX walks World's retained render lane in reverse and matches
actual sprite draw-function identities. Crop dimensions, component/draw offsets,
negative scales and parent/component visibility follow the stored sprite
datapath. The presenter supplies native PCRTC dimensions; Studio's canvas
resolution is not the game's coordinate space.

The rectangle is geometric, not texture-alpha or pixel picking. Arbitrary custom
draw callbacks have no invented bounds and are not selected by this path. Reads
use the existing suspended guest boundary, not a captured image or collider
query. No GPU readback, Lua call, CPU observer or cartlib field is added. Seeks
suppress picking until the requested history state is reached; normal live
playback refreshes the hit after each existing invalidation. The hit stores only
scalar identity/geometry. Unchanged suspended pointer queries reuse it; labels
reformat only when their typed values change. Outside the preview (or under a
modal) no world lane is scanned.

### Selection-geometry extension boundary

The sprite query above is a geometric query over the current suspended guest,
not a pixel-exact hit proxy or a draw-time snapshot of the retained preview.
Extending it to persistent selection overlays and custom renderers requires
both explicit render ownership and a matching presented-frame observation.
Neither can be recovered from arbitrary GP0 words.

Renderer-specific interpretation belongs to Studio's read-only inspection
code, following the existing [cartlib inspection boundary](cartlib_inspection_contract.md).
It consumes the renderer's actual retained draw data. It must not execute a
guest selection callback, duplicate the scene/simulation, infer owners from
coordinates or labels, or introduce project-name branches in the generic picker.
An extension is admitted with a concrete producer and consumer, not an empty
plugin framework in anticipation of future renderers.

The distinction is the same one visible in Godot: a
[visual instance retains its object identity](https://github.com/godotengine/godot/blob/master/scene/3d/visual_instance_3d.cpp),
while an [editor gizmo interprets mesh geometry for picking](https://github.com/godotengine/godot/blob/master/editor/scene/3d/gizmos/mesh_instance_3d_gizmo_plugin.cpp).
Those responsibilities do not belong to the physics collider or the pixel
output alone.

The implementation boundary is:

- **Renderer:** owns the actor/visual association and the geometry actually
  submitted, including any batching permutation. A draw callback's owner is not
  automatically the owner of every object it draws. An arbitrary custom batch
  without that association has no actor-selection geometry; do not attribute
  it to the callback's parent or synthesize bounding boxes.
- **Studio observation:** copies only the required scalar guest identities and
  geometry at a proven draw/submission boundary. Borrowed guest references do
  not cross execution. Bounds/proxy selection and exact visible-pixel selection
  are different capabilities; a geometric rectangle must not claim alpha,
  clipping or occlusion accuracy it does not have.
- **Presentation:** publishes the observation with the accepted completed game
  image. Direct previews use the presenter's game-frame identity; offscreen
  previews use the displayed bitmap's published identity and dimensions. A
  sample of current actor positions at presentation time is not proof of the
  earlier draw-time geometry. Geometry has an explicit coordinate space; its
  mapping uses that frame's scanout, not the latest GPU registers or window size.
- **Selection and overlay:** hover, persistent actor selection and its outline
  consume the same published observation. They neither execute the cart nor
  change gameplay rendering or input routing. Selecting a child behavior refers
  to its actual owning actor, not an invented independent visual object.

Held, partial and paused UI repaints retain the matching observation instead of
recomputing it from the latest heap. A seek publishes nothing for an unfinished
target. A restored image needs its matching retained observation or one rebuilt
from the actual rendering provenance; missing evidence remains unavailable.
Target replacement, heap replacement, installed-media changes and history
branch changes retire the corresponding actor identities. Selection data is
tooling state, not part of machine savestates or cartridge-visible memory.

Do not add actor IDs to GP0, GTE, device registers, the video presenter or the
physical render backends. Do not add a second VRAM renderer, synchronous GPU
readbacks on pointer movement, guest instrumentation calls, or a cartlib 3D
engine solely to implement editor picking. Debug and release must continue to
execute the same guest program. Any renderer-domain change must stand on its
own as real rendering data ownership, not a Studio-only side channel.

## Find in Actor

**Find in Actor** searches the selected actor's actual runtime hierarchy,
including collapsed descendants. It uses the existing transient Quick Input
surface, available from More, the context menu and the command palette, rather
than adding a permanent filter bar. Ctrl/Cmd+F invokes it in Actor Lab controls;
the focused game preview continues to receive its own input. Names, member kinds
and ancestor context are searchable; the chosen item retains its actual
membership, not a lookup by display text. Matching does not execute Lua or
inspect all actors in the World.

This follows [VS Code's outline quick access](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/codeEditor/browser/quickaccess/gotoSymbolQuickAccess.ts):
an outline supplies entries and acceptance reveals the corresponding element.
[Unreal's Outliner](https://dev.epicgames.com/documentation/en-us/unreal-engine/outliner-in-unreal-engine)
also separates finding objects by name/type from framing selection. BMSX keeps
its existing selection, follow and runtime-inspection owners; it does not add
another outline, tree-filter engine or preview/rollback transaction.

Opening the picker pauses Actor Lab playback. Typing, browsing results and
cancelling do not change the selected member, expansion, scroll or follow
target. Acceptance stops activity-follow, expands the selected member's
ancestors and reveals it through `ActorProjection`. Details and the game
preview stay open. A result chosen from the graph returns to the outline with
keyboard focus on the visible hierarchy.

The catalog walks the retained runtime tree once, only on explicit invocation.
Quick Input owns text matching and rendering. The admitted catalog is retired
on guest invalidation, so it cannot select a same-named replacement after
execution, reset or history restoration. No source-model reconstruction,
per-frame search index, guest instrumentation, C++ or machine change is involved.
BT entries here represent the existing runtime tree component; this does not
invent authored-node identities for its internal execution slots.

## Persistent instance Details

The workbench-wide [window and transient-surface design](workbench_windowing_design.md)
owns the stacking/input/lifetime boundary for the modeless Details window.
[Floating Details UX](#floating-details-ux) below specifies its presentation and
independently subject-bound, lockable instance model.

Actor Lab composes its existing outline/graph, game preview and property inspector
without replacing the preview with a modal property document or subtracting
space from it. Details occupies a separate floating window; its generic
container owns placement, chrome and input attachment. There is one
layout path, with no embedded Details split or docking mode.

The implementation follows [VS Code's Variables view](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts)
(stable selection identity, retained view state, refresh at model/visibility
boundaries) and [Godot's remote inspector](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_inspector.cpp)
(retained object/property identity and value updates). UE's
[Rewind track interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/RewindDebuggerInterface/FRewindDebuggerTrack)
keeps track selection and Details in one investigation context; this does not
imply importing UE recording or adding guest instrumentation.

- Unlocked Details follows the explicit selected member; a locked instance keeps
  its own typed subject. Activity-follow still moves only the viewport. Neither
  selection nor locking executes Lua.
- `ActorDetails` formats through `BehaviorRuntimeProperties`, the same retained
  property owner used by Behavior Lens. Dirty invalidation coalesces until the
  visible pane updates. Unchanged paints reuse property rows and measured text.
- Execution ends guest borrows. History restoration invalidates value caches;
  Details reads the reconciled member in the restored heap, never an intermediate
  seek checkpoint. Missing selections show unavailability instead of another actor.
- The property reader is modeless client content with a local titlebar/client
  focus order. Game focus and the central transport remain usable. Scroll and
  selected property survive source navigation; explicit Close dismisses Details,
  whereas detaching an editor retains the window's open intent and model.
- Source and workbench Back/Forward retain the selected cart, World, actor and
  typed member, graph presentation/viewport and Details property. Navigation uses
  the existing pane-selection/history owner, following [VS Code's editor history](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/history/browser/historyService.ts),
  and never seeks machine history or executes guest code. Unavailable members
  stay unselected rather than selecting another instance. Navigation bookmarks
  retire on heap replacement or resuming recorded history; the currently open
  Actor Lab selection continues through its ordinary membership reconciliation.

### Floating Details UX

Actor Lab owns one modeless Details window per input, initially open
expanded and unlocked when explicitly requested. It follows the selected
instance without replacing the tree or shrinking the preview. A Details
instance owns its subject, lock and property-view state independently of the
pane's selection. Additional Details creation commands are a separate product
decision; this design introduces no docking or split compatibility mode.

#### Placement and size

Initially align Details near the lower-right of the root work area, inset by
the existing four-logical-pixel content margin. Initial placement is independent
of whether the game preview fits. Constrain the resulting frame to that work
area so its titlebar actions remain reachable; the window can extend over
adjacent workbench content rather than inheriting a pane or preview clip.

Thereafter the retained requested position/size takes precedence over initial
placement. The window may move across the root work area, including over another
editor group or panel, but not over permanently reserved workbench chrome.
Activating a different editor input detaches the Actor Lab window with its
owner; it does not leave an orphaned always-on-top inspector. Returning to that
Actor Lab restores its attachment and placement. An ordinary Close/reopen within
that input retains the subject, lock and property-view state.

Details uses font- and work-area-relative requested dimensions,
not desktop-pixel minima or a fixed `384 × 288` canvas assumption. Let `W × H`
be the root work area, `c` the current common character advance, `l` the current
font line height. The header height is `l + 8`:

| Dimension | Requested minimum | Initial request |
| --- | --- | --- |
| Width | `32c + 12`, for icon actions and a compact semantic subject caption. | The larger of the minimum and `W / 2`. |
| Height | `7l + 16`, with a font-relative client area. | The larger of the minimum and `H / 2`. |

Font changes recompute minimum size, header/actions and client rows without
discarding the retained requested placement. Arrangement fits the available
work area even when it is smaller than a requested minimum. Compact property
rows account for both text metrics and disclosure-icon height; overflow stays
inspectable through expansion and scrolling instead of scaling text or
reintroducing a preview split. Both supported fonts provide the common single
ellipsis glyph. Font choice and tiny-font capitalisation remain unchanged.

#### Titlebar, lock and availability

The titlebar uses the same compact semantic name as the tree, not a repeated
**Details — cart / actor / component / member** path. Before selection its
caption is **Details**. The full qualified identity is supplied to a wrapped
title hover hint and to the status bar while the Details family, including an
owned property menu, has focus. Middle truncation uses the common single
ellipsis glyph only when the caption itself exceeds its measured budget.

The right-hand titlebar actions are real, font-independent **pin/unpin**,
**maximize/restore** and **close X** icons, with measured hit targets and full
hover/keyboard hints. Pinning Details locks the subject; the checked treatment
distinguishes that state from following selection, and its reverse action is
**Follow Selection**. This is separate from pinning an individual property.
The subject-pin action is disabled until a subject exists; once locked it
remains available for unlocking an unavailable subject. Dragging the remaining
titlebar moves the window without selecting an actor. The property inspector
supplies client content, not a second titlebar or close control.

Unlocked Details immediately follows explicit tree/graph selection. Lock keeps
the typed subject identity while tree navigation continues independently.
Unlock immediately follows the current selection, including an empty
selection. The lock fixes identity, not values or time: playback and settled
history positions keep refreshing that instance. Tree commands use tree
selection; Details and its property menu use the Details subject.

An absent subject keeps its last subject path, adds **Unavailable** to the caption
and shows the existing unavailable-instance notice in the client with the
common warning treatment. Subject-dependent mutations/source actions are
disabled while the exact target is unavailable; subject pinning,
maximize/restore and Close remain usable. A temporary historical absence can
resolve when that same
identity is present again. Heap replacement or retired identity never binds
the window to a new same-named actor.

#### Window presentation, focus and commands

Details is an owned utility inspector, not a document editor or an OS window.
It supports move/resize, maximize/restore and Close. Double-clicking its
non-action title area toggles maximize/restore. There is no titlebar-only
collapse or minimize action. Close/reopen retains the input-owned subject,
lock, placement and property bookmark; identity retirement continues while
hidden. The shared container owns presentation/input transitions, while Actor
Lab owns subject selection and reopening through Inspect Instance.

The shared window theme supplies distinct active/inactive header and text
colours, content background, border and a common floating-surface shadow. Shadow
pixels do not enlarge the window's input bounds. Owned property menus belong to
the same active family. Z order alone
does not indicate keyboard focus: programmatic raising never creates an active
focus treatment. The focused titlebar action or property keeps its ordinary
local focus indicator. Selection, value-change accents and unavailability keep
separate meanings in the property content; switching fonts does not change the
icon geometry or introduce a new capitalisation policy.

Escape first cancels a local interaction or dismisses a property popup, consuming
that key once. Otherwise Escape in Details returns focus to the current Actor
Lab primary control: the tree or its open state graph.
Details remains open, with subject, lock, property selection and scroll
unchanged. It is not a Close shortcut and does not reserve Escape while
the game has focus. Tab traverses Details' eligible client and titlebar controls;
**Actor Lab: Inspect Instance** activates or reopens the retained Details
instance even when a locked subject is unavailable and the tree has no current
target. A new empty inspection still requires an actual subject.

**Select Running Actor** and **Find in Actor** remain available from Details as
explicit Actor Lab navigation commands. They change tree selection while a lock
keeps the Details subject fixed. Instance mutation, behavior-follow and graph
commands stay in their tree/graph contexts; they do not acquire a misleading
tree target from Details focus. Property and pin commands keep the Details
subject as their origin.

Close clears the Details open intent through the admitted close path and returns
focus to that primary control only when the Details family owned focus. It
preserves the instance model for reopening. Source navigation, game input and runtime
transport continue through their existing owners; none depends on the window
remaining visible.

#### Compact values and explicit inspection

Default Details rows present semantic fields with names and values on one
font-measured line, rather than alternating label/value blocks. Scalars stay
compact. Tables and domain references use typed identity summaries with
disclosures; expanding a row requests its actual stored children. Collapsed
references do not eagerly stringify an object graph. Aliases preserve the same
underlying identity, and a cycle is labelled rather than expanded recursively.

Component Details starts with meaningful instance fields and an Owner reference.
The **Stored fields** disclosure makes raw storage, including internal fields,
explicitly inspectable without making it the default property document. This
is presentation, not removal or repair of representable guest values. Stored
keys keep their guest kind, including numeric/string distinctions and holes.

Enter activates a disclosure or the row's source action. Right/Left expand or
collapse references and scalar text, with normal parent/child navigation. Long
scalar/source text can be expanded and wrapped instead of being lost behind
truncation. A clipped hovered or keyboard-selected row also exposes its full
name and value through the shared passive, wrapped hint. This includes stored
keys on table-valued rows, whose disclosure opens children rather than text.
The hint consumes already-projected text, performs no guest reads and retires
with its actual client surface. Scrolling, property identity, value-change
markers, source locations and pin targets remain independent of the row's
displayed width or position.

## Observed value changes

Actor Details and pins mark a changed displayed value with a theme accent and
a small stroke beside the value. Selection, active-behavior indicators and
unavailable-instance warnings remain separate. This follows the separation in
VS Code's [debug model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts)
and [expression renderer](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugExpressionRenderer.ts):
the observation owner compares values; the renderer only consumes presentation.
Unlike a DOM animation, BMSX's immediate-mode repaint does not clear the marker.

- Comparison is against the same binding's preceding completed observation.
  Forward execution and history navigation both qualify. It is not a log of
  every guest write, nor a comparison of unshown descendants of a table preview.
- First observation, switching to another actor/member, and reacquiring a
  previously unavailable binding establish a neutral baseline. A same-named
  property on another actor is not a continuation of the previous property.
- Details retains values and formatting by semantic field or typed guest key,
  independently of display position. Inserting, removing or reordering siblings
  therefore does not erase a surviving property's comparison baseline. The
  selected property and visible scroll anchor also survive sibling changes. A
  property actually absent from a completed observation is released; admitting
  it again starts neutral, rather than reviving stale cached state.
- Pins own their comparison independently of the current selection. Switching
  between the selected-member projection and a separate pinned projection does
  not reset or fabricate a value change.
- A marker survives paused repaint, scrolling, layout and tab navigation. The
  next completed unchanged observation clears it; timers, paint calls and
  pin-list edits do not. Detaching the pane is not guest execution; its
  controller continues to observe actual guest invalidations while hidden.
- Existing suspension invalidation and completed-history-position admission own
  observations. There is no new recording mode, polling, guest instrumentation,
  guest execution or CPU/C++ change. Existing value presentation supplies the
  compared text; rendering performs no additional inspection.

The distinction between a property's identity and its displayed position also
appears in [Godot's remote inspector](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_inspector.cpp):
the property list and keyed property values are separate. BMSX uses its existing
typed `RuntimePropertyIndex`, not display labels or serialized Lua paths. This
preserves guest key kinds and object identity without changing guest iteration
order.

## Pinned runtime properties

A property's context menu offers **Pin Property**, **Unpin Property**, and (for
an available pin) **Reveal Instance**. The same context menu works with the
keyboard. Pins appear first in the existing Details document; their owner
context stays visible while selecting another hierarchy member or another actor.
No additional toolbar, expression evaluator or guest instrumentation is added.
Source still opens only a closure mapped in the loaded image.

The references are [VS Code's watch view](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/watchExpressionsView.ts)
(model-owned entries with independent identity, refresh on invalidation/visibility),
[Godot's remote inspector](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_inspector.cpp)
(remote instance identity and separate value/topology updates), and UE's
[Blueprint watches](https://dev.epicgames.com/documentation/en-us/unreal-engine/blueprint-debugger-in-unreal-engine#watches)
(contextual Watch/Stop Watching and explicit unavailable values). BMSX watches
stored properties only: unlike expression watches they never evaluate guest code.
Godot's serialization **Pin Value** feature is not the debugger model used here.

- Property producers own semantic sections/fields and typed dynamic keys. A
  numeric key and a string with the same displayed text are different properties.
  Status messages are not properties and cannot be pinned.
- BT blackboard properties identify the component's actual storage slot, as FSM
  input properties do. Duplicate declared names remain separately inspectable
  and pinnable. A pin watches that slot across program rebind, not a semantic
  name: the displayed name and loaded default follow the current layout. A
  label-only change does not mark the stored value as changed.
- Pins retain scalar membership and presentation, not guest tables, actor nodes,
  source-inferred instances or the mutable original property row. Editor history
  restores the selected property but never resurrects a removed pin.
- Dirty invalidations coalesce until Details is visible. The selected actor's
  runtime tree and selected member's property document are reused. Other pins
  share one retained tree per actor and one filtered projection per member.
  This still enumerates runtime membership; it is not a claim of constant-time
  inspection or zero overhead. Multiple pins do not each traverse a whole tree.
- Rewind can temporarily make a pinned member unavailable and then restore it.
  Reset/external heap replacement retires the binding. Resuming live history
  validates node and dynamic-property membership before discarded-future IDs can
  alias new objects. This lifecycle check also runs while Details is hidden;
  it is distinct from visible value refresh. Retired pins stay visible until
  explicitly removed.

## Lifetimes and representation

* `ActorRuntimeTree` owns borrowed nodes, without widget rows, layout or source
  models. `ActorProjection` owns ordinary Actor Lab collapse/selection/labels.
  A key/classification change refreshes the domain branch rather than leaving a
  stale label/path on a reused hash ID. UI collapse survives label-only changes.
* History restore is distinct from reset/external state loading. Actor Lab keeps
  its typed membership selection and existing row/collapse state through history seeks,
  then reacquires actual World membership and child tables at the requested
  position. Aliases of one guest table remain distinct action/selection paths.
  It does not inspect intermediate seek checkpoints. An absent actor
  or child has no actionable selection at that historical position. Scalar
  bookmarks can reacquire the same membership when seeking back; admission of a
  new live branch retires unavailable bookmarks before allocation identities can
  be reused. Neither another row nor a later allocation replaces the selection.
  A hidden pane resolves this pending selection before live execution can branch
  from the reviewed state and reuse identities from the discarded future.
  Reset/external load still clears the entire selection. Pending timeline actions
  end on either kind of restore. While readback is pending, selection-dependent
  properties/actions cannot consume the released guest objects.
* The generic `RuntimeInspection` lifetime owns both generic `InspectionValues`
  and attached domain inspections. Actual execution, guest calls, reset/restore,
  inspection replacement and prompt retirement release **all** those borrows.
  Old node/actor/value handles cannot reacquire a new object by name or hash ID.
* Tables reached from actors, globals or locals use the same value-reference
  registry. Aliases and cycles share references. IDs and keys retain their guest
  kinds; a numeric ID and a string ID with the same display are not equivalent.
* The physical CPU/inspection's active cartridge domain selects the installed
  World module binding, **not** cached source activity (which can lag rewind
  restore). Ordinary Actor Lab passes the CPU domain to the same reader. Other mounted
  ROMs are not separate ordinary-global Worlds. Missing exports and an exported
  nil are reported separately from a genuinely empty membership array.
* Component classification uses actual imported class Tables as keys in the
  owner's index, never an object's name or shape. Unknown classes stay generic.
* Activity reports the **basis** of Actor Lab's indicator. An FSM `current_id`
  under an inactive ancestor remains inspectable; selected does not mean its
  owner is running, a lifecycle callback completed, or a future guard will pass.
  Predicates use guest truthiness (zero and empty string are true), not JS
  truthiness or Boolean-only normalization. BT execution slots are not invented
  authored-node identities.
* Node properties reuse ordinary Actor Lab's human-readable summaries. Those
  summaries are **not** the complete value protocol: the node, component and
  receiver expose actual table references for typed, paged nested reads through
  `studio_read_runtime_values`. Callback locations name installed source, not a
  dirty working copy; no whole source text is embedded in each property result.

## Shared execution owner

- The pane does not own tool execution. `ActorExecutionService` owns admission,
  rendezvous, completion/stop observation, cancellation and machine replacement.
  The controller supplies view-origin cancellation and presents outcomes only.
- An admitted target records the current World, actor, and typed membership path
  using guest hash IDs/tags/scalars. It retains no Table, closure, Thread or UI
  node. The existing World rendezvous is followed by fresh membership resolution;
  source labels and same-named replacements cannot substitute for that instance.
- Domain actions and stored methods use the same call preparation for UI/tools.
  Calls go through the ordinary scheduler, never host table writes or a second
  guest interpreter. Returned values describe call completion, not inferred
  success of event gates, deferred disposal or later rendering.
- Cancel before invocation revokes that invocation. Cancel during the actor call
  pauses the physical call and retains performed writes; it never unwinds it.
  No request is parked in World for later mutation.

| Data | TypeScript | C++ | Boundary |
| --- | --- | --- | --- |
| Guest keys/objects | ValueTag and raw scalar / hashId | same guest tags/identity | no machine change |
| Retained selection | IDE heap-generation-qualified scalar membership path | no IDE selection | tooling only, identity conversion in SuspendedGuestSession |
| Rendezvous | World receipt and scheduled CPU calls | same Lua World and native CPU | no firmware/cartlib change |
| Operation/control | IDE explicit operation and completion plan | native Terminal remains firmware-owned | no additional instruction or renderer hook |

The workbench after-frame hook observes one active operation without a per-frame
actor scan. The generic guest scheduler reports final call entry once per
explicit invocation, not per instruction. Target
capture/resolution and argument materialization happen only for an explicit
operation. Execution uses the World API and ordinary CPU scheduler.

### Conversation API and outcomes

* `studio_list_actor_operations(node)` discovers the shared domain action catalog
  and stored Lua methods. Method locations refer to installed source, not dirty
  working copies. Discovery neither executes Lua nor allocates guest values.
* `studio_actor_action(node, method, arguments)` supplies the receiver, typed
  entry key or FSM path itself. `studio_call_actor_method` supplies the selected
  object as `self`. Arguments are parsed by the existing Lua literal owner;
  these are not expression evaluators. The Terminal remains the code evaluator.
* `studio_actor_execution_status(target)` reads active/last operation receipts;
  `studio_control_actor(target, operation, action)` pauses/continues that exact
  operation. Execution/control requests wait for completion or a real pause;
  they do not poll the provider. A later conversation can continue a stopped call.

Receipts distinguish `queued`, `running`, `paused`, `completed`, `interrupted`,
`rejected` and `host-error`. `invoked` is set only after the requested closure
enters the CPU, not while preparing literals or executing admission calls.
`values` are bounded previews; `tags` are the corresponding raw `ValueTag` codes
(nil 0, false 1, true 2, number 3, string 4, table 5, closure 6, builtin 7, thread 8).
Returned tables are not durable handles: acquire a new inspection to read them.

World publishes the receipt after a complete **update or render**, including the
RAM runner produced by `system_schedule_syntax.lua` and its committed early
schedule-exit branch. An intermediate tick group or nested unload is not an
admission boundary. Thus admission may advance gameplay, but does **not** promise
that the changed actor has already been rendered. Ordinary requested pause is
retained after the call. A cart which stops calling World cannot admit an edit.

Call return is not domain success. `transition_to` requests a state path; entry
and exit guards still apply even though no event handler is being dispatched.
Effects can reject triggers, and lifecycle work can be deferred. Reinspect the
actual instance rather than treating `completed` as an accepted transition,
completed disposal, or refreshed image. No return-value normalization is added.

Object membership, method identity and a slider's program identity are resolved
again after admission. Removal, replacement or a changed World binding produces
`rejected` before entry, not a task-queue failure or a same-named substitute.
Scalar selectors are retained only by the admitted, heap-generation-qualified
operation; reset/restore retires the operation before the new heap is inspected.
The reusable execution tree releases its borrows immediately after preparation.

Before entry, Stop revokes the pending invocation. During entry it suspends the
real call without undoing writes or discarding frames. A paused pre-entry
observation still owns cancellation until a newer control intent takes over;
ending that prompt cannot park a mutation for later accidental execution.
Continuing a revoked admission only lets its retained physical call drain.
Faulted physical roots remain available to ordinary debugger recovery.

Manual spawn, event emission, action/method pickers and latest-only timeline
scrubbing use this same service. No Codex execution button or hidden pane is
introduced. Spawn reacquires both the typed prefab key and its selected
registered definition; a same-key replacement is not silently substituted.
The domain method reader returns semantic method/source information; picker
labels/layout are produced by the controller, not the runtime reader.

These tools admit the authoring target, not isolated Scenario Lab targets.
Conversational prefab discovery/spawn and actor-event conveniences are outside
this interface. Apply/save/build/install receipts belong to the source/build
owners, separately from actor execution.

## Testing owners

The fixtures below own regressions at their respective boundaries; compilation,
owner-level tests, rendered browser interaction and physical guest readback
provide different kinds of evidence.

| Owner | Contract exercised |
| --- | --- |
| [`actor_details.test.ts`](../tests/lua/actor_details.test.ts) | Compiled-guest property identity, value comparison, pins, independent Details subjects and history retirement. |
| [`actor_runtime_tools.test.ts`](../tests/lua/actor_runtime_tools.test.ts) | Typed runtime handles, ordinary Actor Lab composition/navigation, scoped commands and hidden-window lifetime work. |
| [`actor_state_graph_navigation.test.ts`](../tests/lua/actor_state_graph_navigation.test.ts) | Graph membership, selection, focus/reveal and history identity. |
| [`actor_execution.test.ts`](../tests/lua/actor_execution.test.ts) | Instance admission, cancellation, physical call control and replacement races. |
| [`studio_game_input.ts`](../tests/conformance/runtime_replay/studio_game_input.ts) | Ordinary gameplay input beside floating Details and scoped Studio focus. |
| [`studio_actor_find.ts`](../tests/conformance/runtime_replay/studio_actor_find.ts), [`studio_actor_pins.ts`](../tests/conformance/runtime_replay/studio_actor_pins.ts), [`studio_actor_changes.ts`](../tests/conformance/runtime_replay/studio_actor_changes.ts) | Browser interaction for finding members, pin/source navigation and completed-observation value changes. |
| [`studio_actor_tools.test.ts`](../tests/platform/studio_actor_tools.test.ts), [`studio_actor_execution_tools.test.ts`](../tests/platform/studio_actor_execution_tools.test.ts) | Conversation inspection/execution through real browser machines, the HTTP bridge and a deterministic provider fixture. |
