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

The live owners were checked before this change: World `_objects` is admitted
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

## Lifetimes and representation

* `ActorRuntimeTree` owns borrowed nodes, without widget rows, layout or source
  models. `ActorProjection` owns ordinary Actor Lab collapse/selection/labels.
  A key/classification change refreshes the domain branch rather than leaving a
  stale label/path on a reused hash ID. UI collapse survives label-only changes.
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
