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
read-only field accesses. The live owners were checked before this change: World `_objects` is admitted
membership, not a heap census; WorldObject owns component ordering and the
class-table index; FSM instances retain their own states/definitions; BT retains
its own blackboard layout and compiler-owned execution memory; ActionEffects
retain their granted instance and definition. No separate authored scene graph,
same-name source match, source re-execution or source-derived runtime object is
introduced. Source tools and instance tools remain distinct.

| Data | TypeScript representation | C++ representation | This change |
| --- | --- | --- | --- |
| World/component membership | guest Tables and class-table keys | guest Tables and class-table keys, same cartlib | no producer/ABI change |
| Value identity and kind | `Table.hashId`, `ValueTag` through `SuspendedGuestSession` | guest table identity/tags | no machine change |
| Activity predicates | guest tags: only nil/false are false | same CPU guest truth predicate | central suspended-reader predicate; no CPU change |
| FSM/BT/effect/timeline state | actual retained cartlib instance fields | same cartlib and guest fields | shared readers; mutations call existing Lua APIs |
| Inspection identity | stop-scoped IDE handles | no IDE projection | new IDE feature, not a native Terminal change |
| Execution/rewind | existing host invalidation before execution/heap replacement | existing native runtime owners | no CPU hook; IDE observes explicit call entry and active operation status |

There are **no mirrored runtime edits**. Existing hot-path callsites are the
ordinary Actor pane's dirty refresh after a CPU slice, plus the existing
`runWorkbenchHostFrame`/guest-call/restore invalidation boundaries. No instruction,
renderer, compiler, cartlib scheduler or native Terminal callsite changes.
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
  preview does not. Details stays beside the preview and selected hierarchy while playback,
  frame stepping and history review update the inspected values. The compact title contains Actor/Back, Follow, and More; instance
  mutation commands remain in More, the context menu, and the palette.
- Switching tree/graph carries the explicit selected instance. The graph model,
  zoom and viewport survive returning to the tree and reopening that same machine.
  Long tree identifiers elide the middle, retaining distinguishing suffixes; the
  selected full identifier remains in the status bar. This uses the common text
  layout owner, following [VS Code's middle truncation](https://github.com/microsoft/vscode/blob/main/src/vs/base/common/strings.ts).
- Follow observes only the completed history position. Missing historical
  instances are visibly unavailable and cannot receive actions; live-branch
  admission and heap replacement retire invalid bookmarks. Timeline **Scrub**
  remains an explicit guest operation, not machine-history rewind.

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

### Find validation (2026-10-07)

`browser.mjs --studio-actor-find SYSTEM_ROM CART_ROM SCREENSHOT_PNG` exercises
ordinary menu, pointer and keyboard navigation on software, WebGL2 and WebGPU.
It covers collapsed members, duplicate machine instances, mixed-case multi-term
search, cancellation without selection/follow/Details movement, and graph-to-outline
focus. Actual guest ICU readback verifies that Ctrl+F in the focused game preview
is not intercepted by Find. Opening and accepting the catalog leave guest cycles,
heap use and callback counts unchanged.

The fixture is authored through the source model and Reboot, not by manually
typing the cart. A separate host-triggered physical frame step tests invalidation
while the picker owns keyboard focus; reopening selects the restored instance.
Captures under `.bmsx/authoring/actor-find/` show duplicate-result context,
the revealed member and retained Details/game preview. These are automated
browser interaction and rendered-UI evidence, not UI-only fixture authorship.
The focused Actor/behavior/workbench/Quick Input/input-routing bundle passes
389 tests, including compiled-guest table/function-key aliases. IDE/tests
typechecks, the Browser Studio debug build, strict architecture-boundary audit
(zero issues), core-parity and diff checks also pass.

## Persistent instance Details

Actor Lab composes its existing outline/graph, game preview and property inspector
instead of replacing the preview with a modal property document. Details occupies
the resizable lower part of the preview column; closing it restores the preview's
space. The shared split control supports both axes, including pointer capture and
focused keyboard resizing. This is local pane composition, not a second docking
or game-rendering framework.

The implementation follows [VS Code's Variables view](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts)
(stable selection identity, retained view state, refresh at model/visibility
boundaries) and [Godot's remote inspector](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_inspector.cpp)
(retained object/property identity and value updates). UE's
[Rewind track interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Editor/RewindDebuggerInterface/FRewindDebuggerTrack)
keeps track selection and Details in one investigation context; this does not
imply importing UE recording or adding guest instrumentation.

- Details follows the explicit selected member; activity-follow still moves only
  the viewport. It does not choose a different receiver or execute Lua.
- `ActorDetails` formats through `BehaviorRuntimeProperties`, the same retained
  property owner used by Behavior Lens. Dirty invalidation coalesces until the
  visible pane updates. Unchanged paints reuse property rows and measured text.
- Execution ends guest borrows. History restoration invalidates value caches;
  Details reads the reconciled member in the restored heap, never an intermediate
  seek checkpoint. Missing selections show unavailability instead of another actor.
- The property reader is embedded, not modal: its focus order joins the tree,
  graph, preview and sashes. Game focus and the central transport remain usable.
  Scroll and selected property survive source navigation; explicit Hide dismisses
  Details, whereas detaching an editor does not.
- Source and workbench Back/Forward retain the selected cart, World, actor and
  typed member, graph presentation/viewport and Details property. Navigation uses
  the existing pane-selection/history owner, following [VS Code's editor history](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/history/browser/historyService.ts),
  and never seeks machine history or executes guest code. Unavailable members
  stay unselected rather than selecting another instance. Navigation bookmarks
  retire on heap replacement or resuming recorded history; the currently open
  Actor Lab selection continues through its ordinary membership reconciliation.

### Details/navigation validation (2026-10-07)

The real browser workflows pass on software, WebGL2 and WebGPU: actor inspection
and execution (six gates), plus game input (three gates). They keep Details open
while delivering keyboard input to Nemesis, advancing and rewinding a physical
frame, and invoking the fixture actor's ordinary `set_pos` method. Captures show
the retained selected `x` row changing from `4` to `12`, with `y` changing from
`8` to `34`; Source opens the actual callback and Back/Forward retains the member,
property and scroll position. The fixture setup remains automated authoring and
the assistant provider is local/deterministic, not a live-model reasoning test.

The browser checks exposed two lifecycle defects and now cover their fixes:
restoring scroll against the departing source editor's bounds, and leaving a
hidden Details sash focused. Activation no longer performs layout with stale
geometry; the normal host layout precedes viewport restoration. The sash is
attached only while its pane is visible.

The Actor/Behavior/workbench unit bundle passes 343 tests. Clean Details refreshes
perform no guest reads; dirty unchanged values retain rows without reformatting.
This is not a zero-allocation or total-frame performance claim. IDE/tests
typechecks, the browser Studio build, architecture audit and diff checks pass.
This validation predates property pins. [Event-to-frame navigation](studio_event_viewer.md)
now shares the physical rewind owner; selected event payloads are not live Actor
Lab handles and do not automatically select actors by emitter display text.

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
  therefore does not erase a surviving property's comparison baseline. A
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

### Change indication validation (2026-10-07)

`browser.mjs --studio-actor-changes` passes on software, WebGL2 and WebGPU.
The fixture uses automated source setup through the real editor model, then
ordinary game-preview input changes an actor's `x` from **9 to 10**. Actual
Previous/Next Frame commands revisit **9 → 10 → 9 → 10**. Details and pins mark
the changed values, leave unchanged fields neutral and clear on the next
unchanged observation. Paused paints, source-tab navigation and the ordinary
theme shortcut preserve markers without advancing guest cycles, heap or
callbacks. Actor switching resets Details comparison but retains the pin's.

Captures in `.bmsx/authoring/actor-changes/` were visually reviewed in both
themes, including the selected property, the pin beside another selected actor,
rewind and the cleared indication. The live game preview stays visible. This
is automated browser/runtime evidence, not exclusively manual authoring, physical
GPU hardware or mobile validation. Existing row/cache tests cover clean-refresh
guest reads, row reuse and unchanged guest heap; this slice does not claim zero
host cost.

The existing Find in Actor and pinned-property browser workflows also pass on
software after the detach-lifecycle correction. The Actor/Behavior/workbench/
input/theme bundle passes **393 tests**; IDE/tests typechecks, the Studio debug
build and strict architecture audit (zero issues) pass. The structural core-parity
audit and diff check are clean. No native runtime behavior was changed or claimed
as newly verified by those structural checks.

### Property membership reconciliation validation (2026-10-07)

The same browser workflow now changes a real Inventory component through ordinary
game-preview input: its first numeric entry disappears/reappears while `health`
changes **90 → 89 → 88**. Previous/Next Frame revisits both transitions. The
surviving property keeps its value-comparison baseline, selection and visible
scroll anchor. Unchanged siblings stay neutral; the genuinely removed/re-admitted
entry starts neutral. Software, WebGL2 and WebGPU pass, and the rendered light/dark
captures in `.bmsx/authoring/property-identity/` were reviewed. Six paused paints
perform zero member reads/entry traversals and advance neither guest cycles nor
guest heap. Source setup remains automated, not a claim of manual-only authoring.

The unchanged browser workflow fails with the previous property-document owner
in an isolated bundle override, at retained semantic-property identity after
rewind. Three focused identity/cache tests also failed against that owner before
the implementation. Additional owner-level checks cover typed keys, actual
removal/re-admission, shifted closure source caches and independently pinnable
blackboard slots with duplicate or rebound labels. The broader Actor/Behavior/
workbench/input/theme bundle passes **401 tests**. IDE/tests typechecks, the Studio
debug build, strict architecture audit and structural core-parity audit pass.

An isolated Node/V8 projector probe compares the previous and current owners
using real suspended guest values, after warmup (seven paired runs, five samples
of 3,000 observations each; median of run medians, microseconds per observation):

| Properties / emission order | Previous | Retained identity |
| --- | ---: | ---: |
| 12 / unchanged | 0.53 | 0.55 |
| 12 / rotating | 4.06 | 0.81 |
| 128 / unchanged | 5.50 | 6.31 |
| 128 / rotating | 41.18 | 9.16 |

Rotating 128 entries previously rebuilt 1,920,000 value presentations and captured
as many identities per run; the retained owner does neither after warmup. The
unchanged-order route keeps its positional fast path, but this measurement still
shows a small absolute slowdown, not zero overhead. The typed index and one row
position are retained host memory proportional to the live document; removals
release their entries. These numbers measure projection only, not total Studio
frame time or host GC. Guest cycles/heap remain unchanged. No C++ or guest-runtime
behavior changed in this slice.

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

### Pin validation (2026-10-07)

The browser pin workflow passes on software, WebGL2 and WebGPU. It uses the
ordinary keyboard/right-click property context menu, chooses another real World
actor, advances a physical frame, rewinds, navigates to source and back, reveals
the original instance and unpins without closing Details. Captures were visually
reviewed: the first actor's pinned `x` changes **9 → 10 → 9** while the second
actor stays selected, with the pin owner visible beside its value. Source setup
is automated through the real editor model; this is a browser/runtime workflow,
not a claim of exclusively manual authoring. The fixture intentionally has no
game graphics; the separate Nemesis game-input workflow verifies the actual live
game preview and input beside Details.

Together with the three Nemesis input gates and six existing assistant Actor
inspection/execution gates, **12 browser gates** pass across all three backends.
The assistant gates use a deterministic local provider, not paid inference.
**362 Actor/Behavior/workbench/property tests** pass. Focused counters establish
no guest reads or identity captures across 1,000 clean action-enablement checks;
filtered warmed property emissions do not reformat values or keys. Read-only pins
preserve guest heap/cycles, including typed key collisions, history absence,
discarded-future ID reuse and mutable table contents. These measurements do not
claim zero total host cost: watched nodes are still enumerated, and FSM event
descriptions/ActionEffect metadata lookups still do work on dirty readback.
IDE/tests typechecks, the Studio product build, boundary audit and diff checks
pass. No machine, cartlib or mirrored C++ runtime representation changed.

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

Ownership (2026-09-24):

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

| Data | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Guest keys/objects | ValueTag and raw scalar / hashId | same guest tags/identity | no machine change |
| Retained selection | IDE heap-generation-qualified scalar membership path | no IDE selection | tooling only, identity conversion in SuspendedGuestSession |
| Rendezvous | World receipt and scheduled CPU calls | same Lua World and native CPU | no firmware/cartlib change |
| Operation/control | IDE explicit operation and completion plan | native Terminal remains firmware-owned | no additional instruction or renderer hook |

Hot-path audit: the workbench after-frame hook adds an O(1) observation of one
active operation; no per-frame actor scan. The generic guest scheduler reports
final call entry once per explicit invocation, not per instruction. Target
capture/resolution and argument materialization happen only for an explicit
operation. The World API and CPU remain unchanged. Godot's separate object
inspection/mutation messages and VS Code's independent debug-operation lifetime
were re-read before implementation.

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
Dedicated conversational prefab discovery/spawn and actor-event conveniences
are not added here. This does not supply apply/save/build/install receipts or
complete the reproduce/fix/rerun acceptance gate.

### History-selection follow-through (2026-09-30)

The implementation follows the separation in [VS Code's Variables view](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts):
tree identity/view state outlives suspended debugger references, but is retired
at session replacement. BMSX uses the guest hash identities actually restored
by its CPU snapshot, not variable-name matching, host object identity or a new
actor-ID scheme. All public inspection handles still expire on every restore.

Only IDE invalidation/composition and Actor Lab readback changed. TS/C++ CPU
snapshot, World membership, history, guest calls and allocation remain unchanged.
The existing visible-pane dirty refresh still owns tree traversal. A hidden
pane additionally resolves once after restore, before its first live execution;
there is no added per-instruction or ordinary hidden-pane traversal.

The compiled-guest suite verifies fresh restored objects, preserved selection,
absent actor/child clearing, actual discarded-ID reuse on a new branch, and
tool-handle expiry. The real browser/World workflow
passes on software, WebGL2 and WebGPU, including reopening selected properties
after rewind. A separate ordinary Studio + public MCP acceptance retained the
selected BT and collapsed FSM across tick 671 → 641 → 671, also while Actor Lab
was hidden. All 17 observed actor scalars matched after replay. A physical
Reboot cleared selection as intended. Another public-tool/UI run hid Actor Lab,
sought from tick 200 to the pre-construction checkpoint at tick 0, then resumed
live execution. The recreated actor reused hash 3897, but reopening Actor Lab
required a fresh selection; cancelling that picker left the pane unselected.
This is not whole-heap equivalence or a new native runtime feature.

## Evidence

`actor_runtime_tools.test.ts` covers compiled guest representations, typed IDs,
aliases/cycles shared with globals, real class keys versus misleading component
names, paging/traversal retention, unavailable/empty distinction, source-free
reads, expiry, ordinary-row reuse and label/restore invalidation.

`studio_actor_tools.test.ts` runs real browser machines, the ordinary HTTP bridge
and native Codex app-server against a deterministic local Responses provider.
Its fixture is authored via the real compiler and Save/Reboot: World/prefab and
cartlib create two actors with the same behavior definitions and different live
FSM data/selection, BT blackboards and effect activations. It compares tool
results to the ordinary Actor Lab tree, expands typed values, shows ordinary
state properties, preserves ordinary World-bound method execution, and checks
actual frame execution/rewind expiry and historical Actor picker readback.
This is automated integration evidence, not UI-only fixture authoring, personal
account authentication or live-model reasoning.

Inspection-slice baseline validation (2026-09-24):

* Actor unit tests: 9 pass. Focused runtime/Actor/IntelliSense bundle: 74 pass.
* Full Lua suite: 2504 pass, one skip. Rompacker: 182 pass. Assistant integration
  suite: 45 pass. The Actor workflow passes on software, WebGL2 and WebGPU with
  eight bounded model requests and one connection per workflow, not polling.
* Ordinary Studio WebGL2 workflow: pass (8944 host frames). Existing live
  FSM/BT/ActionEffect, partial rebind, dirty-source and rewind UI workflow:
  pass (4353 host frames).
* Browser Studio and Node tooling builds; product typechecks; strict architecture
  audit (zero issues), core-parity, indentation and diff checks pass. The tests
  project still has 95 pre-existing diagnostics: the normalized diagnostic
  multiset matches the pre-slice baseline, with none added or removed.
* The older Pietious scene suite still fails before reaching Actor Lab: it looks
  for `scenes/rooms/room_002.lua`, removed by the canonical-YAML restoration.
  A browser bundle using the unchanged HEAD versions of every modified TS file
  reproduces the same `openScene` failure. No replacement Lua room or source
  fallback was introduced. The new actual-World fixture separately exercises
  the refactored ordinary Actor method/receiver lifecycle on all three backends.

A same-process, compiled-guest microprobe compared the pre-slice projection with
the new one: warm refresh was approximately 4.8 versus 4.9 microseconds for six
nodes, and 170 versus 169 microseconds for 260 nodes. First tool traversal was
0.28–0.76 ms; a retained four-node page approximately 0.62–0.67 microseconds.
These local samples exclude guest execution, invalidation, rendering, network
and total GC latency; they are not a general performance improvement claim.
Unit checks additionally prove unchanged-row reuse and no repeated semantic
walk/property formatting for repeated tool pages/details in one suspension.

### Execution-slice validation (2026-09-24)

`studio_actor_execution_tools.test.ts` exercises the real browser machine,
ordinary HTTP bridge and native Codex app-server with a deterministic local
Responses provider. The compiled World fixture supplies its own methods,
transition guards and replacement races. Software, WebGL2 and WebGPU pass:

* Discovered actions move only the requested actor; stored methods receive the
  actual receiver. Return tuples distinguish nil, false and the string `false`.
* A stored method hits an actual source breakpoint and continues through the
  conversation tool. A denied FSM transition returns normally but reinspection
  still reports the previous state. A subsequent allowed transition and keyed
  timeline scrub change their actual instances.
* Visible Stop pauses an entered bounded call without undoing writes. A later
  prompt reads its operation ID and continues that same call to completion.
  The workflow makes 38 finite provider requests and one connection, not polls.
* An independently selected Actor Lab keeps its selection. Ordinary prefab
  spawn, action picker and event emission use the same service, including an event-handler
  breakpoint resumed with Run > Continue Lua Call. This also reproduces and
  fixes the ordinary menu's failure to release the source stop.
* Queued cancellation and retirement after a paused pre-entry reply never enter
  the requested method. Guest-owned membership, method, timeline-program and
  World-binding replacement reject stale requests without poisoning the task
  queue. Dirty source remains uninstalled; completed calls retain user pause.

The fixture setup is automated source authoring, not UI-only authorship. Captures
in `/tmp/bmsx-studio-chat/actor-execution-*-{conversation,manual-selection,stopped-call,manual-spawn-event}.png`
show the ordinary views. The fixture has no visual sprites, so these images are
not evidence of newly rendered actor pixels. The existing image-transport tests
separately verify actual frame delivery. None of this claims personal-account
authentication or a live model's reasoning ability.

Validation bundle:

* Operation lifecycle: 9 pass; Actor inspection/identity: 11 pass. Focused
  Actor/IntelliSense/scheduler bundle: 123 pass. Full Lua suite: 2789 pass, one skip.
* Full assistant integration suite: 51 pass. The final shared-execution workflow
  also passes separately on all three backends after the presentation split.
* Ordinary Studio workflows report PASS on software (8832 host frames), WebGL2
  (8882) and WebGPU (9570), including source repair, separate scenario targets,
  pointer interactions and canonical source persistence.
* BIOS Terminal TS/C++ parity passes; selected-frame evaluation parity passes
  all 42 O0/O3 cases, including physical slots, scope lifetime and full snapshots.
  This slice changes neither native Terminal nor CPU/cartlib behavior.
* Browser Studio and Node tooling debug/release builds and IDE/common/browser/
  Node typechecks pass. Strict architecture audit: zero issues; core-parity and
  diff checks pass. The tests-project diagnostic comparison has no additions:
  94 existing diagnostics remain, with one obsolete slider-test diagnostic removed.
