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
Omitted contents are marked in the inspector, copied text and tool output.
Table identities/references describe that snapshot, not reusable live handles.
Closing a pane or ending a conversation does not stop collection. A host restart
loses this in-memory history.

A rewind seek keeps existing event evidence without emitting duplicates during
replay. Reset, restore and code installation begin a new labelled timeline;
subsequent live emissions remain distinguishable from the old evidence. Clear
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
- The IDE-owned `RuntimeEventHistory` makes bounded immutable host copies at
  emission. It never invokes Lua or metatables and retains no guest objects or
  borrowed register views. UI filtering and payload inspection run on those
  copies, not the machine. The filtered index updates incrementally; rendering
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

Hot callsites: compiler-lowered CALL in `cartlib/event_emitter.lua:emit`, TS
`CPU.callBuiltinFunction`, C++ `CPU::callBuiltinFunction`. The observer cannot
execute guest code or retain the borrowed span. Costs and primitive IDs are
mirrored. The old observation-only `ExecutionHookPhase` extension is removed;
source breakpoints and interrupt fences keep their original control contract.

## Validation (2026-10-05)

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
