# Studio Event Viewer

## Use

Open **View > Event Viewer**. In Studio, debug carts automatically retain recent
event emissions from startup, including while the IDE or viewer is closed. There is
no Record/Stop step. Collection never resumes a paused game. Run, frame-step
and rewind with the existing central transport; the optional Game panel can
show the live image alongside it.

Select an event and press Enter / **Inspect Selected Event** for its wrapped, scrollable
payload. Ctrl+C in the event list copies that historical snapshot; in Details
it copies the selected stored property value. **Filter** searches event and
emitter text. **Clear** deletes retained evidence without disabling collection.
The viewer works without a server or assistant.

**Go to Frame** seeks through the existing central rewind owner and leaves the
game paused. It selects the retained video boundary **at or before** emission,
not the emitting instruction or the state after its listeners ran. The selected
immutable payload and the current physical machine remain distinct: ordinary
clicks/arrows only select evidence. The central timeline shows the actual
machine position, and completion reports the reached frame.

Right-click or Shift+F10 opens the same actions as **…**. **Previous Event** and
**Next Event** explicitly select and seek the adjacent reachable event in the
filtered sequence; ordinary arrow keys do not seek. Multiple emissions can map
to the same video boundary. Inspect and Clear live in this menu rather than
adding another permanent transport row. Timeline labels distinguish retained
evidence from different executions. Unreachable evidence remains inspectable,
with **Frame unavailable** rather than a jump to unrelated state.

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
- `studio_seek_event`: pass the generation and sequence of a read event. The
  event's original recording must still be reachable; the tool awaits ordinary
  frame navigation and returns its actual completion/stop/interruption and
  before/after positions. Cancellation uses the existing finite-operation owner.
  Do not copy an old event's cycles into `studio_seek_history`: a timestamp alone
  does not establish recording provenance after a reset or branch.

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

## Ownership and executable equivalence

Debug metadata describes execution; it must not change the emulated machine.
Ordinary debug, release and Hot Resume builds erase **all** trace statements.
The earlier debug-only native CALL transport was an architectural error: it added
nine guest cycles per event. It has been removed, including `hostTraceChannels`,
`BuiltinFunctionId.Trace` and its bootstrap-lifetime exception. Adding the same
cost to release or weakening the machine contract is not an acceptable fix.
Explicit Scenario sink selection remains available only in derived test images.

The current observation path is entirely host-side:

1. The IDE binds the entry of `cartlib/event_emitter.emit` using installed
   function/source identities, inline call chains and argument liveness. This
   runs once per media revision, not per frame/event. Physical argument slots
   are compiler-owned; there are no hardcoded register numbers. Missing symbols,
   missing/ambiguous function identity or optimized-out arguments are explicit
   availability states. Optimizations are never disabled to satisfy a tool.
2. The mirrored CPU accepts domain-indexed physical PCs and a read-only callback.
   Decode marks only those cache entries with a **host-only** observation dispatch
   and prevents fusion across them. Installing/removing points invalidates cached
   dispatch, including predecessors. No instruction-stream patch, guest opcode,
   per-instruction PC lookup or switch to the source-debugger loop is involved.
3. At an observed instruction the CPU lends tagged registers synchronously,
   then executes and charges the original instruction exactly once. Source
   breakpoints, interrupt admission and fetch faults retain precedence. The
   observer must not mutate guest state, run Lua, reconfigure execution or retain
   that register view. The general hook observes instruction admission, not
   completion; a blocked MMIO operation can be retried. Event-emitter entry is
   not such a retrying MMIO operation.
4. `RuntimeIdeState` owns `RuntimeEventHistory`, independently of debugger/pane/
   conversation lifetime. Reset, admitted Hot Resume and actual live history
   branches notify it at their owning lifecycle boundaries. Rebinding happens
   before resumed guest execution. Shutdown detaches observation.
5. History snapshots remain bounded, immutable host data. Capturing never calls
   Lua/metatables, interns guest strings, formats values or retains guest objects.
   The UI's filtered index updates incrementally and renders only visible rows.

Release packages normally omit source symbols, so cannot bind source observation
without tooling metadata. This affects tool availability, not executable
semantics. Packed metadata can relocate an executable image; fixed-address image
comparison distinguishes that placement from added guest work.

The pre-edit TS/C++ representation table and hot callsites are recorded in
[event observation parity](event_observation_parity.md). Native players expose
the same CPU mechanism but allocate no Studio event history.

## Physical recording provenance

Event evidence and replay retention are different owners. `RuntimeHistory`
assigns monotonically increasing IDs to its existing bounded checkpoint ring;
IDs do not reset on start/stop. At observation, `RuntimeEventHistory` stores the
current recording checkpoint ID in a parallel bounded host array. No checkpoint
or guest object is retained by an event. Emissions while physical history is
disabled remain inspectable evidence but have no replay anchor.

The history owner admits a position only if that checkpoint remains retained,
the cycles are inside the recorded range, and its continuation was not cut by
a live branch. Branching clips the old checkpoints at the branch cycle,
exclusively: an instruction observed at that admission cycle has not yet run in
the restored boundary state. Earlier surviving evidence remains navigable;
discarded futures never become reachable when new execution crosses the same
cycle number. Nested branches preserve earlier cuts. Stop/start, reset, external
load and injected guest execution retire the old physical recording at their
existing history lifecycle boundary. No feature-maintained lineage graph or
inference from timeline labels is involved.

Pre-edit representation/callsite review for the mirrored history extension:

| Value | TypeScript | C++ |
| --- | --- | --- |
| Monotonic checkpoint ID; absent recording | integer `number`; `-1` | `i64`; `-1` |
| Branch cutoff cycles | integer `number` | `i64` |
| Uncut continuation sentinel | `Infinity` | `numeric_limits<i64>::max()` |
| Storage | existing checkpoint ring | existing checkpoint ring |

These are host-history fields, excluded from the machine/save-state format.
`captureCheckpoint` assigns two fields per existing capture; `resumeRecording`
clips the bounded retained checkpoints only on a branch. `recordInputBoundary`,
CPU dispatch, guest bytecode and normal playback gain no work. Observation reads
one scalar anchor; navigation admission binary-searches retained checkpoint IDs.
The observer still charges no guest cycles or allocations. Native players keep
the same provenance semantics without allocating any Studio event snapshots.

## Bounded snapshot and clipboard ownership

Table preview uses the table owner's constant-work `storedSlotCount` and
`loadStoredEntry`, mirrored in TS/C++. Positions are borrowed storage indices,
not handles which survive mutation. The 1024-position budget includes holes and
dead nodes and is shared across event name, emitter and payload. It is a fixed
work budget, not a wall-clock cutoff. A sparse table can exhaust it without
finding a value; `omitted` then records incomplete evidence. Guest writes, GC,
normal Lua iteration and save-state layouts maintain no extra preview indexes.

Strings are copied as budgeted UTF-16 code units using reusable scratch. A
substring can retain its entire parent allocation and is therefore unsuitable.
NUL, BOM and unpaired surrogate code units survive; no encoding roundtrip is
used. Large strings are explicitly truncated within the shared budget.

Details exposes the shared property inspector's read-only clipboard target.
Copy exports its selected **stored** value. Platform admission/error reporting
remain with the platform clipboard owner. No guest evaluation, pane-specific
shortcut, hidden editor or permanent Copy button is involved.

## Production references studied

- [RenderDoc event selection](https://github.com/baldurk/renderdoc/blob/v1.x/qrenderdoc/Windows/EventBrowser.cpp)
  and [capture context](https://github.com/baldurk/renderdoc/blob/v1.x/qrenderdoc/Code/CaptureContext.cpp):
  selected evidence and effective replay position are distinct; one replay owner
  publishes physical state. BMSX retains asynchronous finite navigation rather
  than copying RenderDoc's blocking wait.
- [Perfetto selection](https://github.com/google/perfetto/blob/main/ui/src/core/selection_manager.ts)
  and [search navigation](https://github.com/google/perfetto/blob/main/ui/src/core/search_manager.ts):
  selection, reveal and details are separate, and navigation uses retained results.
- [UE Rewind Debugger](https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-rewind-debugger-in-unreal-engine)
  and [Visual Logger](https://dev.epicgames.com/documentation/en-us/unreal-engine/visual-logger-in-unreal-engine):
  timeline-linked inspection. BMSX reuses its automatic physical history, not an
  additional recording session or inferred live actor from a detached payload.
- [MAME rewinder](https://github.com/mamedev/mame/blob/master/src/emu/save.cpp):
  the physical history owner controls bounded retention and future invalidation.

- [MAME instruction hooks](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp):
  host-side observation before execution, distinct from guest code.
- [QEMU translated-code observation](https://github.com/qemu/qemu/blob/master/accel/tcg/plugin-gen.c):
  host callbacks attached to execution sites, not instructions added to the guest.
- [V8 inspector previews](https://github.com/v8/v8/blob/main/src/inspector/value-mirror.cc):
  explicit preview budgets and overflow. BMSX additionally bounds physical scans.
- [VS Code REPL model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/replModel.ts)
  and [variable Copy Value](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/variablesView.ts):
  stored values, presentation and focus-routed copy are separate responsibilities.

These references establish ownership patterns, not BMSX performance guarantees.
Measurements of the retired native CALL transport in commits `217278bf0` through
`2a3792476` do **not** validate the current transport or debug/release equivalence.

## Reproduction

- `tests/rompacker/debug_release_execution.test.ts` exercises actual packer debug
  selection at O0/O3: erased argument side effects/constants, return values,
  executable size, cycles and guest heap. At a fixed link address, symbol inclusion
  also compares the entire executable payload byte-for-byte.
- `tests/lua/event_history.test.ts`, `function_probe.test.ts` and
  `cpu_superinstructions.test.ts` cover actual cartlib snapshots, complete CPU
  equivalence, inline source bindings/unavailable arguments, source-stop ordering,
  warm-cache observer installation/removal and fusion boundaries. Native CPU
  supervisor tests exercise the mirrored dispatch.
- `tests/conformance/runtime_replay/profile_event_history.ts` alternates automatic
  history and no observer on the **same erased-code image**, with identical input
  and checkpoints. It compares complete runtime state separately from host timing:

  ```sh
  npx tsx --tsconfig tsconfig.base.json tests/conformance/runtime_replay/profile_event_history.ts \
    dist/system/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
  ```

The profiler measures CPU/devices/audio/GPU command work, not browser rendering
or an open viewer. Results are workload-specific. Event-heavy gameplay and large
payloads require their own measurements; this is not a universal FPS claim.

Coverage is common cartlib **emission**, not arbitrary callbacks, interrupts,
listener completion or duration. Full unbounded capture, persistent trace export
and reconstruction of expired events are not implemented.

## Validation of the host-only correction (2026-10-05)

- 81 focused CPU/event/binding/tool checks and 82 compiler/packer/boot/Hot Resume/
  Scenario-debugger regressions pass. IDE, tests and scripts typechecks pass;
  boundary audit reports zero violations. Core-parity checks structure only.
- Native CPU supervisor (including observation), CPU save-state and ROM tooling
  suites pass. Newly built Nemesis debug media has equal complete TS/C++ state
  after all three replay windows and after history seeking/live branching.
- Actual Browser Studio was operated via keyboard, pointer and Terminal clipboard:
  startup history, close/reopen, immutable nested/cyclic payloads, details/filter/
  copy, 2052-event overflow, frame stepping, playback, rewind/rejoin, live branch
  and Hot Resume. Copied events retain timeline 1 on rejoin, use 2 after a branch
  and 3 after installation. Inspected screenshots show health 9 after mutation,
  fresh post-install events and the sparse-payload truncation warning. Browser
  logs contain no warnings/errors. This is separate evidence from harness tests.
- An isolated 31-round alternating fixture (8 warmups) executes 1000 emissions
  with 32 arithmetic iterations between each. No observer / automatic history
  medians are **67.49 / 68.63 ms**, about **1.69%** additional host time. Both use
  **263015 guest cycles**, equal heap usage and equal complete CPU state. The
  removed transport used 272015 cycles for this fixture; those 9000 extra guest
  cycles are gone, not charged elsewhere.
- The three real Nemesis windows (120 frames after ticks 400/1200/2400) capture
  5/6/8 events. Observed/unobserved host-time differences are **+0.25%, +0.34%,
  -0.32%**; the small negative sample is noise, not a speedup claim. Complete
  runtime state remains equal. These low-event windows are not a worst-case bound.
- BIOS/Nemesis debug and release media, Browser Studio and Node headless tooling
  were rebuilt. Browser WebGPU/WebGL pixel parity is a separate outstanding gate;
  these event/CPU checks do not establish accelerated-renderer correctness.

Raw samples, complete replay states, UI screenshots and copied values are kept
in `.bmsx/authoring/event-observation-parity/` (ignored local evidence).

## Event-to-frame navigation validation (2026-10-07)

- The real Browser Studio workflow passes on software, WebGL2 and WebGPU. The
  harness installs a small authored cartlib-emitter fixture through the source
  model and Reboot; subsequent selection, filter, Details, copy, Go to Frame,
  Previous/Next, Continue from Here and Clear use keyboard/pointer controls.
  Inspected screenshots show aligned columns, frame 57 before event #17, and
  disabled navigation for discarded timeline-2 evidence alongside timeline 3.
  Reactivating the Events tab with Details open retains property keyboard focus.
- A separate public `studio_seek_event` invocation completes real physical replay
  while selection/filter/Clear are changed through the UI. An ordinary queued
  host-work fence holds the admitted operation while these interactions occur;
  the result retains its original event identity and reaches its requested
  frame. This distinguishes tool-lifetime coverage from the pointer-only checks.
- The focused event, frame-navigation/scheduler, Actor and inspection regressions
  pass (162 tests). Event tests compare stored payloads and unchanged guest state;
  navigation tests exercise lifecycle and recording identity, not presentation
  string contracts. Both TS and native scheduler suites cover rejoining, nested
  branch cutoffs, overlapping cycles after reset, ring reuse and input expiration.
- Actual Nemesis media passes complete TS/C++ replay and retained-history state
  comparison. The native host rewind and libretro rewind/menu-pause ABI runners
  also pass. The two added checkpoint fields do not enter save-state data.
- Six platform regressions cover the real Codex app-server, browser runtime tools
  and finite navigation on software, WebGL2 and WebGPU. Their deterministic local
  Responses provider checks tool exposure, including `studio_seek_event`; this
  is not a claim about a personal account's authentication or live-model quality.
- Browser Studio builds, IDE/tests typechecks and architecture/core-parity audits
  pass. Structural parity and these interaction checks do not establish general
  accelerated-renderer pixel parity or a universal host-time overhead bound.

Reproduce the browser interaction checks with:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-event-navigation \
  dist/system/bmsx-bios.debug.rom dist/nemesis_s.debug.rom \
  .bmsx/authoring/event-navigation/viewer.png
```

Screenshots and logs are retained in `.bmsx/authoring/event-navigation/` (ignored
local evidence). Browser logs include a resource 404 and Chromium ReadPixels
performance warnings; there were no uncaught browser exceptions. The interaction
checks are not a claim of a warning-free browser environment.
