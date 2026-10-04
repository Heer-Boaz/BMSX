# Studio Event Viewer

## Use

Open **View > Event Viewer**, then **Record**. Run or frame-step the game with
the existing central transport, or execute an explicit Terminal/Actor operation.
The same rewind transport is docked in this viewer; the optional Game panel can
show the live image alongside it. Starting a recording alone never resumes play.
The `EVENTS (REC)` tab marks recording even while another editor is selected.
**Stop** keeps the recording. Select an event and press Enter / **Details** for
the wrapped, scrollable payload; Ctrl+C in the list copies the selected snapshot.
**Filter** searches event/emitter text. **Clear** deletes the retained recording.

The buffer holds 2048 emissions and stops when full; it never silently drops
old events. Each emission shares a depth-3, 64-entry, 4096-string-code-unit
snapshot budget. Omitted content is marked in both the inspector and copied
text. Table identities/references describe a snapshot, not reusable live handles.
Switching editors does not stop recording; closing the viewer does. The buffer
is in memory, not persisted across a browser/host restart.

Codex and external Studio/MCP clients use the same owner via
`studio_event_capture` (status/start/stop/clear) and `studio_read_events`
(generation-bound paging). Starting capture does not resume gameplay; tools
can bracket an ordinary Terminal call, Actor operation or forward frame step.
Ending a tool context does not discard workspace-owned evidence or recording.
No server or assistant is required for the viewer itself.

## Ownership and capture

The viewer observes **emission**, before listener dispatch, including events with
no subscribers. It does not install listeners, call Lua, modify cartlib, or
recompile the cartridge. Recording is explicitly enabled; the normal CPU loop
remains unchanged when neither recording nor debugging is active.

This follows MAME's opt-in debugger tracing and Unreal Insights' separation of
capture, bounded storage, and analysis. Godot's profiler likewise enables capture
explicitly rather than treating an open editor as a recording request.

- [MAME debugger](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp)
- [Godot debugger](https://github.com/godotengine/godot/blob/master/editor/debugger/script_editor_debugger.cpp)
- [Unreal tracing](https://dev.epicgames.com/documentation/en-us/unreal-engine/developer-guide-to-tracing-in-unreal-engine)

An IDE-owned function probe binds the installed compiler symbols for
`cartlib/event_emitter`'s `event_emitter.emit`. It binds the first statement of
each physical/inlined invocation and its live argument locations, not hard-coded
source lines or register numbers. Missing symbols or unavailable argument
locations prevent capture; they never produce guessed/nil payloads.

Snapshots contain stored values only. No metatable lookup, getters, or guest
references survive the observation. Snapshot depth, entry and text budgets are
explicit; omitted contents are marked. The recording stops when its bounded
buffer fills. Inspection and filtering do not execute the guest.

Reset, rewind restore, and code installation stop recording. Already captured
snapshots remain readable, tagged by capture and execution domain; a new capture
does not pretend it continues the old timeline. Central Studio playback/rewind
controls remain the only runtime transport.

## Runtime representation gate (before mirrored edits)

| Data | TypeScript | C++ | Owner |
| --- | --- | --- | --- |
| Instruction PC | `number` address word | `u32` | CPU |
| Domain | `ExecutionDomainId` (-1/0/1) | `ExecutionDomainId` | execution-domain spec |
| Hook phase | `ExecutionHookPhase` enum | `ExecutionHookPhase` enum | CPU instrumentation |
| Guest value | `ValueTag` / `Value` / `ValueSlots` | tagged `Value` | CPU value owner; no new wire format |
| Event snapshot | immutable IDE data | no native Studio | IDE, not emulated state |

The only mirrored change makes the existing hook phase explicit. A
pre-maskable-interrupt control fence is **not** an executed instruction and must
not publish an event a second time. Hot-path callsites: TS
`CPU.runUntilDepthInstrumented` and the instrumented C++ `CPU::runLoop` invoke
the hook at the interrupt fence and before an instruction. Normal loops remain
uninstrumented. Consumers: `ide/runtime/debugger_state.ts` and
`ide/testing/execution.ts`; C++ consumers are CPU conformance tests. Existing
stop/step control ignores the new phase; event observation only occurs after
stop admission at an instruction boundary.

Active recording uses the instrumented interpreter and allocates bounded host
snapshots per event. It is not free: measure host throughput separately from
unchanged guest instructions/cycles. No guest heap allocation or event dispatch
changes are introduced. Native players continue using the normal CPU loop.

## Validation and limits (2026-10-04)

- Real compiler/cartlib/CPU tests cover O0/O3, nested dispatch, no-listener
  emission, nil/false payloads, mutation after emission, cycles, snapshot limits,
  physical/inline symbol locations, optimized-away argument rejection,
  breakpoint admission, interrupt phases, recording capacity, history/code
  replacement, and shared Studio-tool paging/clear/lifetime.
- A synthetic 1000-emission loop with 32 arithmetic iterations per emission
  used exactly 263015 guest cycles with and without capture and retained the
  same 79314 guest heap bytes after seven runs. Warm host medians across local
  runs were roughly 67-69 ms disabled versus 77-78 ms recording (12-16% extra).
  This is workload-specific throughput evidence, not a universal overhead bound.
- Both actual browser and headless Studio products were operated through keyboard/clipboard
  controls: record, emit through the Terminal, stop, select, inspect nested and
  cyclic data, copy, and filter. Rendered list/details/filter views were inspected;
  the copied historical payload still held `health=9` after it was changed to 0.
- The browser also captured 240 emissions, scrolled the list, and copied its
  first/last entries. The existing central transport was used for forward step,
  live play/pause and previous frame. Restoring history stopped recording,
  removed the recording marker and kept all 240 historical snapshots readable.
- The focused runtime, editor lifecycle and tool regression bundle passed 132
  tests; IDE/tests typechecks and the architecture boundary audit passed.
- The CPU's matching C++ supervisor/IRQ and save-state/replay tests pass. C++
  has no Studio event UI or cartlib logging changes.

Capture covers the selected physical cartridge's common event-emitter dispatch,
not every arbitrary callback, interrupt or private module notification. It
records emission, not listener completion/duration. Installed debug symbols and
available argument locations are required; stripped or incompatible symbols
are reported instead of guessing values. Rewind review does not reconstruct
events from before recording: restoring history stops capture and preserves its
old snapshots as a separate capture timeline.
