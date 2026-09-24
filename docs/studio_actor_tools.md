# Suspended Actor tools

This slice exposes **inspection**, not Actor Lab execution, to conversations.
`studio_list_actors`, `studio_read_actor_tree` and `studio_read_actor_node`
operate inside an explicit `studio_inspect_runtime` suspension. They neither
open an Actor Lab pane nor dispatch UI commands. The ordinary pane and tools
share `ActorRuntimeTree` and the existing runtime property inspectors.

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
| FSM/BT/effect/timeline state | actual retained cartlib instance fields | same cartlib and guest fields | read only |
| Inspection identity | stop-scoped IDE handles | no IDE projection | new IDE feature, not a native Terminal change |
| Execution/rewind | existing host invalidation before execution/heap replacement | existing native runtime owners | no new execution hook |

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

## Mutation remains a separate gate

Ordinary Actor Lab already schedules real Lua calls through
`World:request_mutation_boundary()`. Its execution lifetime is currently tied to
the selected pane/actor. Tools must acquire their own explicit operation lifetime
and reacquire target identity **after** that owner rendezvous, not retain these
expired borrows, fake a pane, write tables directly or turn cancellation into a
later queued mutation. This slice does not claim conversational spawn, method
calls, transitions, event emission or timeline scrubbing.

Likewise, this is authoring/historical-target inspection; isolated test targets
have their own attachment owners. It does not add test-target Actor admission,
implicit cart/frame Terminal evaluation, or apply/save/build/install receipts.

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

Validation on 2026-09-24:

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
