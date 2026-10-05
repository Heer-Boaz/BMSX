# Studio Event Viewer

## Use

Open **View > Event Viewer**. In Studio, debug carts automatically retain recent
event emissions from startup, including while the IDE or viewer is closed. There is
no Record/Stop step. Collection never resumes a paused game. Run, frame-step
and rewind with the existing central transport; the optional Game panel can
show the live image alongside it.

Select an event and press Enter / **Details** for its wrapped, scrollable
payload. Ctrl+C copies that historical snapshot. **Filter** searches event and
emitter text. **Clear** deletes retained evidence without disabling collection.
The viewer works without a server or assistant.

The circular buffer retains the latest **2048 emissions**. It expires the oldest
rather than stopping at capacity; the footer reports the expired count. Each
emission shares a depth-3, 64-entry, 4096-string-code-unit snapshot budget.
At most 1024 physical table positions are visited across that emission,
including vacant/dead storage; a sparse table cannot cause an unbounded search.
Unvisited contents are marked in the inspector, copied text and tool output;
`omitted` means completeness was not established, not that more entries are
known to exist.
Table identities/references describe that snapshot, not reusable live handles.
Closing a pane or ending a conversation does not stop collection. A host restart
loses this in-memory history.

A rewind seek keeps existing event evidence without emitting duplicates during
replay. A new labelled timeline starts on a physical reset, external save-state
load, admitted Hot Resume installation, or continuing live from an earlier point.
Seeking, playback and returning to the recorded end do not create timelines.
Subsequent live emissions remain distinguishable from the old evidence. Clear
is the only in-session action which deletes all retained events. Rewind does
not reconstruct events which have already expired from this bounded buffer.

## Tool access

Codex and external Studio/MCP clients read the **same workspace-owned buffer**:

- `studio_event_history`: `status` returns status, generation, firstSequence,
  endSequence, total, capacity and expired count. `clear` clears the evidence and
  advances generation, without changing playback or collection.
- `studio_read_events`: pass that generation, an absolute sequence in the
  advertised retained window, and count. A cleared generation or expired
  sequence is rejected explicitly; it is never silently changed to another
  position. A sequence equal to endSequence yields an empty page.

Read on demand around ordinary Terminal operations, Actor operations or frame
steps. No polling, additional capture session or live guest handle is required.
These tools target the authoring runtime, not a separate Scenario Lab machine.

Snapshots carry typed data, not preformatted UI text: `kind` identifies nil,
boolean, number, string, table, reference, function, builtin or thread. Primitive
`value` fields retain their values; strings also report `omitted`. Tables carry
`id`, `entries` (typed keys and values) and `omitted`; references carry the
snapshot-local table identity. The number kind uses numeric JSON values except
for the explicit `'-0'`, `'nan'`, `'inf'` and `'-inf'` representations which JSON
numbers cannot preserve. Finite numbers are not rounded to display precision.
Identities are evidence inside the emission, never live inspection handles.

## Ownership and source instrumentation

The previous instruction-hook/function-symbol probe is **removed**, not hidden
behind automatic recording. It made the entire interpreter use instruction
instrumentation while capturing a small number of event calls.

Cartlib now marks its actual semantic emission boundary, before dispatch and
including events with no subscribers:

```lua
blua32.trace(self, 'event.emit', event_type, emitter_id, payload)
```

This reuses the statement intrinsic already used for FSM/BT/ActionEffect
tracing. Existing guest scenario sinks remain independently selectable.
Ordinary live FSM/BT inspectors largely read existing state; they are not
justification for unlimited additional tracing cost.

- The compiler's `hostTraceChannels` selects native observation. Debug cart
  builds select `event.emit`; release cart builds erase the entire unselected
  statement, including argument evaluation and constants. Host selection takes
  precedence over a guest sink for the **same** channel; there is one destination
  and one argument evaluation, not two notifications.
- Selected statements lower to a normal native CALL with a borrowed
  `(subject, channel, ...values)` register span. `BuiltinFunctionId.Trace` is a
  runtime primitive retained in the system namespace after BIOS bootstrap.
  Other bootstrap primitives keep their existing removal lifetime.
- Only that native call invokes the optional read-only observer. Neither CPU
  instruction loop gains trace polling; attaching the observer does not switch
  to the instrumented interpreter. No emulated event device, event opcode,
  cartlib-aware CPU code, injected listener or guest snapshot allocation exists.
- `RuntimeIdeState` owns one `RuntimeEventHistory`, independent of source
  debugger creation/reset, and injects it into the viewer and runtime tools.
  Physical restore, rewind resume and Hot Resume notify it at their actual
  lifecycle boundaries; debugger invalidation is not a substitute for those
  notifications. Workbench shutdown detaches the CPU observer.
- The IDE-owned `RuntimeEventHistory` makes bounded immutable host copies at
  emission. It never invokes Lua or metatables and retains no guest objects or
  borrowed register views. It consumes tagged slots directly and copies typed
  values without invoking number formatting or JSON string quoting. Table
  traversal uses the owner's constant-work stored-slot reader, not Lua `next`
  (which can search arbitrarily many vacant slots). UI
  filtering and payload inspection format those copies on demand, not the
  machine. The filtered index updates incrementally; rendering
  visits only visible rows and retains measured labels. Expiration preserves
  the scrolled position unless following the live end.
- Linker/tooling metadata preserves host channels through source rebuild and
  Hot Resume. Rebuild BIOS and debug carts together after this primitive change;
  stale images are not patched by guessing register slots or source positions.

Unobserved **debug** code still executes its selected trace CALL and pays its
actual guest cycles. Removing an observer does not magically erase installed
instructions. Release builds erase the source instrumentation; both builds
retain the native runtime service's fixed bootstrap presence.

## Production references studied

- [Unreal Trace](https://dev.epicgames.com/documentation/en-us/unreal-engine/developer-guide-to-tracing-in-unreal-engine):
  explicit source channels and payloads, capture separate from analysis.
- [BehaviorTree.CPP semantic state notifications](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/master/src/tree_node.cpp)
  and [logger lifetime](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/master/include/behaviortree_cpp/loggers/abstract_logger.h):
  observe a semantic transition, not every interpreter instruction.
- [VS Code REPL model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/replModel.ts):
  stored values and their requested text/children are separate responsibilities.
  BMSX detaches mutable guest values at emission rather than retaining live
  JavaScript objects, because replay replaces heaps and evidence must not change.
- [Godot EngineDebugger](https://github.com/godotengine/godot/blob/master/core/debugger/engine_debugger.cpp):
  producer/debugger ownership independent of editor presentation.

These are architectural references, not evidence that a particular BMSX cost is
acceptable. The local measurements below determine that.

## Representation gate (recorded before mirrored edits)

| Value | TypeScript | C++ | Owner |
| --- | --- | --- | --- |
| Native primitive | `BuiltinFunctionId.Trace` | same ID | VM primitive specification |
| Bootstrap lifetime | descriptor `retainAfterBoot` | same flag | primitive specification/compiler |
| Trace arguments | borrowed `BuiltinArgsView` / tagged `ValueSlots` | borrowed `BuiltinArgsView` / tagged `Value` | CPU native dispatch |
| Execution domain | raw `ExecutionDomainId` | same enum | execution-domain specification |
| Host channels | `readonly string[]` | `vector<string>` | compiler/linker tooling metadata |
| Snapshot / sequence | immutable host history | no native Studio | IDE, not machine save-state |
| Resume notification (review follow-up) | `branched: boolean` | `bool branched` | `RuntimeHistory::resumeRecording`, before truncating future input |

The review follow-up changes only the existing resume notification payload in
the mirrored runtimes. `RuntimeHistory` already decides whether resumption
rejoins the recorded end; it publishes that decision rather than making the
Event Viewer reconstruct it. Callsites: TS/C++ `resumeRecording`, the Studio
composition root, and scheduler/navigation conformance tests. This runs on
explicit resume, not on instructions, frames or event emissions. Guest state,
checkpoint representation and native trace costs remain unchanged.

Hot callsites: compiler-lowered CALL in `cartlib/event_emitter.lua:emit`, TS
`CPU.callBuiltinFunction`, C++ `CPU::callBuiltinFunction`. The observer cannot
execute guest code or retain the borrowed span. Costs and primitive IDs are
mirrored. The old observation-only `ExecutionHookPhase` extension is removed;
source breakpoints and interrupt fences keep their original control contract.

### Storage-scan review gate (2026-10-05)

The snapshot's entry limit did not bound observation work: Lua `next` searches
through empty array/hash storage. A table with one entry in 65536 array slots
took about 400 ms for 1000 snapshots in an isolated warm run, versus 0.24 ms
for one slot. Neither the retained-entry limit nor the depth limit stops that
search. The existing `forEachStoredEntry` also scans the entire storage, so it
cannot provide bounded observation either.

| Value / operation | TypeScript | C++ | Owner |
| --- | --- | --- | --- |
| Physical entry positions | array slots, then hash nodes | same order | `Table` |
| Scan extent | `storedSlotCount: number` | `storedSlotCount(): size_t` | `Table` |
| One-position read | `loadStoredEntry(slot, ValueWriteTarget, offset)` | `loadStoredEntry(slot, Value&, Value&)` | `Table`, constant work, false for a vacant/dead position |
| Stored key/value | numeric `ValueTag`, scalar, reference columns | tagged `Value` | existing runtime representation |
| Snapshot work budget | 1024 visited positions shared across one emission | no native Studio snapshotter | `GuestValueSnapshot` |

Positions are borrowed during a synchronous read, not handles that survive table
mutation. Reads perform no allocation, metatable lookup or guest execution.
The observer uses a bounded physical scan instead of key-based Lua iteration;
unvisited storage is explicitly marked `omitted`. Normal Lua `next`, table
mutation, GC and save-state paths remain unchanged, with no extra maintained
indexes or hot-path counters. Hot callsites affected: `GuestValueSnapshot.read`
from `RuntimeEventHistory.observe`, and its direct `Table.loadStoredEntry`
reads. The C++ primitive is mirrored and checked independently; it adds no calls
to native gameplay. Preview limits with explicit overflow follow the
[V8 inspector's preview accumulator](https://github.com/v8/v8/blob/main/src/inspector/value-mirror.cc);
the physical scan budget is BMSX-specific and must be measured, not inferred
from that reference.

The 1024-position budget permits sixteen storage probes per retained entry at
the 64-entry limit. It is a fixed observation-work limit, not an elapsed-time
cutoff: the same table representation yields the same snapshot regardless of
host speed. Sparse storage can exhaust it before any entries are captured.

## Initial implementation validation (2026-10-05)

- Compiler/cartlib/CPU coverage: O0/O3, nested and unhandled emission, nil/false,
  immutable snapshots after mutation, cyclic tables, snapshot budgets, selected
  host/guest channels across BIOS/cart/module boundaries, breakpoint admission,
  buffer wrap, reset/install/replay and generation/expiration-aware tool reads.
- Actual browser Studio: startup events were visible on first opening. Closing
  the tab, emitting through the Terminal, and reopening retained those events.
  List/details/filter/copy were operated and visually inspected; `health=9`
  remained readable after mutation to 0. A 2052-event burst retained payloads
  5 through 2052, with four earlier records reported expired. Central transport
  performed forward stepping, play/pause and rewind; after confirming the
  reviewed point a new Terminal emission appeared in timeline 2, with payload 42.
- The C++ primitive works in normal and instruction-debug loops with identical
  guest costs. Supervisor/IRQ, CPU save-state/replay and ROM tooling tests pass.
  The real newly instrumented Nemesis ROM also boots, executes, saves/restores
  and replays in the native runtime conformance runner. Full saved TS/C++ state
  matches after all three checkpoint windows and after history seeks/live branch,
  including active BADP playback and non-empty game VRAM.
- The focused runtime/editor/tool bundle passes 147 tests; the additional
  behavior/trace/preload bundle passes. IDE, tests and scripts typechecks pass;
  architecture-boundary audit reports zero issues and core-parity audit passes.
  Browser Studio, headless tooling, BIOS and Nemesis debug products are rebuilt.

Performance distinguishes erased source, selected/unobserved source and active
host history. Run the emission-heavy fixture alone (not during a parallel build):

```sh
node --import tsx --import ./tests/lua/test_setup.ts --test \
  --test-name-pattern='observer adds no guest work' tests/lua/event_history.test.ts
```

The fixture has 1000 emissions with 32 arithmetic iterations between each. Both
selected variants use 272015 cycles versus 263015 erased: **9 extra guest cycles
per emission**. Both selected variants use the same guest heap space. Host timing
is reported separately; it is not inferred from these guest-cycle counts.

The real-cart profiler alternates unobserved-debug and automatic-history runs
from identical checkpoints with identical input. Restore/setup/state comparisons
are outside timing. It compares the complete machine/CPU state and reports raw
samples plus medians for 120 frames after ticks 400, 1200 and 2400:

```sh
node --import tsx tests/conformance/runtime_replay/profile_event_history.ts \
  dist/system/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
```

Local isolated measurements (11 alternating rounds, first 4 discarded):

| Workload | Unobserved / erased | Automatic history | Interpretation |
| --- | ---: | ---: | --- |
| 1000-emission fixture, erased source | 66.14 ms | 68.87 ms | +4.12% host time, including selected guest work |
| Same fixture, selected/unobserved | 68.35 ms | 68.87 ms | +0.76% for observation; source work already present |
| Nemesis, 120 frames after tick 400; 5 events | 1223.80 ms | 1221.86 ms | -0.16%; sampling noise, not a speedup |
| Nemesis, after tick 1200; 6 events | 532.22 ms | 533.27 ms | +0.20%; within sample variation |
| Nemesis, after tick 2400; 8 events | 543.80 ms | 546.34 ms | +0.47%; within sample variation |

An earlier isolated fixture run was 67.58 / 69.40 / 71.22 ms for erased,
unobserved and observed variants (+5.38% total). The replacement lowers the
previous 12-16% fixture overhead, not to zero. These real-cart windows have
few events; event-heavy gameplay or large payloads require their own measurement.

These headless measurements include real CPU/devices/audio/GPU command work,
not browser presentation or an open viewer. They isolate observation cost over
selected debug code, not the source trace's already-accounted guest cost.
Results are workload-specific, not a universal overhead bound or FPS claim.

Coverage is common cartlib event **emission**, not arbitrary private callbacks,
interrupts, listener completion or duration. Full unbounded payload capture and
persistent trace-file export are not implemented.


## Ownership review follow-up (2026-10-05)

Two actual defects were corrected rather than adding compatibility layers:

1. Constructing/resetting a source debugger implicitly installed/relabelled the
   event observer. In particular, ordinary history seeks created fictitious
   timelines. The Studio session now owns history independently; physical
   restore, admitted Hot Resume and the runtime's explicit branch notification
   are the lifecycle boundaries. A seek/rejoin is not a new branch.
2. The emission path stored only display strings, including six-digit runtime
   number formatting. Tools lost the original types and numeric precision,
   while every emission paid for quoting/formatting, even with the pane closed.
   Snapshots now consume tagged slots into detached typed data; presentation is
   on demand. Cycles, aliases, truncation and JSON-inexpressible IEEE values
   remain explicit. No guest code or new per-instruction work was introduced.

Validation after the fixes:

- Browser Studio operated through keyboard, pointer and Terminal clipboard
  input: startup capture, close/reopen, immutable nested/cyclic payloads,
  details/filter/copy, 2052-event overflow, central stepping and playback.
  The copied evidence stayed in timeline **1** after Back/return-to-present,
  moved to **2** after resuming an earlier point, then **3** after Hot Resume.
  The UI was visually inspected; these are not assertions about required prose.
- 44 focused event/history/navigation tests and 165 broader debugger,
  inspection, Terminal, assistant and Hot Resume tests passed. IDE/tests
  typechecks and boundary/core-parity audits passed. Browser Studio and Node
  headless tooling products were rebuilt.
- Native frame-scheduler tests exercise both branch and rejoin notifications.
  Full Nemesis TS/C++ save-state comparisons passed at the three checkpoint
  windows and after history seeks/live branching, including GPU/audio state.
- An isolated alternating A/B run compared the previous commit's observer with
  typed snapshots: 31 rounds, 8 warmups, 1000 emissions per round. Medians were
  **71.84 ms / 71.08 ms** (-1.05%). Both used **272015 guest cycles**, with equal
  complete CPU state. This small timing difference is not a general speedup
  claim; moving formatting also fixes the data representation independently.
- Repeating erased / unobserved-debug / observed-debug measured
  **66.53 / 67.93 / 69.17 ms**: about **4.0%** total source-plus-observation
  overhead for this emission-heavy fixture, about **1.8%** for observation over
  already instrumented debug code. The source still costs 9 guest cycles/event.
- The three 120-frame Nemesis windows measured **+0.29%, -0.51%, -0.35%**
  observed versus unobserved debug code (5/6/8 emissions). These differences are
  within sample variation, not evidence of zero overhead in all workloads.

Local logs, copied event values, screenshots and the A/B harness are under
`.bmsx/authoring/event-history-review/` (ignored authoring evidence).

## Storage-scan review validation (2026-10-05)

- 20 event/tool/table tests and 61 history/navigation/property-inspector/table
  editing regressions pass. Cases include sparse nested storage, a budget shared
  across arguments, dead hash slots, the exact entry-limit boundary, iteration
  order, IEEE values and absence of guest mutations.
- The mirrored C++ stored-slot reader, CPU save-state and frame-scheduler suites
  pass. Actual Nemesis TS/C++ complete-state replay/history comparisons pass,
  including GPU and audio. IDE/tests typechecks and architecture/core-parity
  audits pass; Browser Studio and Node headless tooling were rebuilt.
- Real Browser Studio was driven through keyboard/pointer/clipboard: normal
  nested payload inspection and copy, filtered history, overflow/scrolling,
  central frame-step/playback, return-to-present, live branch and Hot Resume.
  Copied timeline labels remain **1 / 2 / 3** respectively. A Lua Terminal
  emission of a sparse 8192-slot table shows a yellow incomplete payload and
  an explicit warning in Details; its copied snapshot also marks truncation.
  Screenshots were viewed, not asserted against exact UI prose. No browser
  warnings/errors were reported.
- The isolated sparse microbenchmark (1000 snapshots, 15 alternating rounds,
  first 5 discarded) changed from **400.51 ms to 7.87 ms**. A one-slot table
  remained **0.24 ms**. The sparse result is now explicitly incomplete: this is
  bounded work, not a claim of faster equivalent full capture.
- An alternating old/new observer comparison (31 rounds, 8 warmups, 1000
  ordinary nested emissions per round) measured **67.68 / 67.57 ms** (-0.17%).
  All captured events and the complete CPU state are equal; both use **272015
  guest cycles**. The timing difference is sample variation, not a claimed
  general speedup.
- Isolated erased / unobserved / observed source measured **64.94 / 67.83 /
  67.42 ms**. The selected source still costs **9 guest cycles/emission**;
  observation changes neither guest cycles nor heap allocation. Real Nemesis
  windows after ticks 400/1200/2400 measured **+0.50% / +0.34% / -0.68%**
  observation overhead. These low-event windows do not establish an upper
  bound for event-heavy carts.

Reproduction scripts, raw timings, screenshots, copied payloads and logs are in
`.bmsx/authoring/event-history-storage-review/`. This review changes only the
read-side inspection boundary. It adds no per-write accounting, instruction
hooks, guest listener or UI-specific behavior to the table implementation.
