# Generic machine history and rewind

Status: deterministic save-state, shared TS/C++ history and continuous host
collection are implemented. TS player/Studio and libretro expose checkpoint
navigation in the existing quick menu. Rewind is an emulator facility, not a
Studio or cartlib service. Physical SNES Mini performance remains unmeasured.

## References and ownership

- [DuckStation memory states](https://github.com/stenzek/duckstation/blob/master/src/core/system.cpp):
  `DoMemoryState`, `SaveMemoryState`, GPU state synchronization, bounded retained
  storage and host presentation after restore. This is the relevant
  PlayStation-class machine example; BMSX is not an MSX.
- [openMSX ReverseManager](https://github.com/openMSX/openMSX/blob/master/src/ReverseManager.cc):
  complete checkpoints plus an emulated-time event journal; additional
  checkpoints accelerate seeking, and seeking does not itself discard the
  recorded future. Only this record/replay algorithm is a reference here, not
  its motherboard, slot, video, or CPU model.
- [openMSX StateChangeDistributor](https://github.com/openMSX/openMSX/blob/master/src/input/StateChangeDistributor.cc):
  recording and replay meet at external state consumption, rather than
  recording host event-loop iterations. BMSX's consumption boundary is its
  existing ICU input-source interface.
- [RetroArch state manager](https://github.com/libretro/RetroArch/blob/master/state_manager.c):
  the frontend owns its own serialization/delta rewind. A BMSX history service
  must not replace or silently compete with that frontend facility. Ordinary
  `retro_serialize`/`retro_unserialize` remain supported independently.
- [Lua VM closure creation](https://github.com/lua/lua/blob/master/lvm.c):
  `pushclosure` allocates the closure before filling its upvalues. The two BMSX
  cores must also agree on that allocation order; snapshot readers must not
  compensate for different producer identities.

## Contract

1. A checkpoint contains the complete guest-observable machine state at a
   suspended execution boundary. Replay consumes recorded external events at
   their original machine-time input boundary. Internal CPU execution, RNG,
   PCRTC, GP0, DMA, IRQ, VRAM and APU transitions run normally.
2. The machine clock is the timeline coordinate. PCRTC/VBlank boundaries are
   useful seek endpoints but are neither a fixed 50/60 Hz host frame nor a
   cartlib `worldtick`. A later Studio projection may index guest worldticks;
   the emulator does not inspect worlds to implement rewind.
3. The ICU input-source boundary includes both armed pad/key/pointer snapshots
   and the supervisor request line sampled even without an ICU arm. Host menu
   navigation is not guest input. Replay must not sample live controllers or
   repeat host vibration effects.
4. Checkpoints are sparse and history storage is bounded. No full-machine
   serialization, object graph traversal, or allocation per input sample.
   External disk serialization/validation is not the internal journal format.
5. Seeking is wall-clock independent and services every GPU backend fence.
   Intermediate host presentation, audio delivery and diagnostic output may be
   suppressed; emulated work may not be skipped. Async GPU capture suspends
   machine execution until the checkpoint is complete.
6. Moving through retained history preserves its future. Resuming live control
   or a state-changing external operation creates a branch. Reboot, media
   replacement, external state loading, debugger writes and Hot Resume need
   explicit owner integration; they must not leave replay using unrelated
   current bytes. There is no source revision, editor event or linker lineage
   in the CPU/device state. Cross-code-revision Studio history is a separate
   design and is not implied by generic gameplay rewind.
7. Host/quickmenu is the initial control surface. No new keyboard/gamepad
   shortcut is reserved. Collection/seek state and retained range must be
   visible; a seek must not freeze host event processing.

## Paced review playback: REWIND-PLAYBACK-01

The original transport implements seeking and live takeover, not playback of
retained history. This slice adds that missing operation. LB/RB still seek one
emulated second; A toggles recorded playback/pause; START takes live control;
B cancels back to the retained present. The pointer can select the timeline and
activate those same transport actions. Controls exist only in the open host
transport; no gameplay keyboard shortcut or cartlib worldtick stepping is added.

The production reference is [openMSX ReverseManager](https://github.com/openMSX/openMSX/blob/master/src/ReverseManager.cc):
`goTo` reconstructs a position, `replayNextEvent` supplies the original external
events at machine time, and `stopReplay` truncates future events only on takeover.
[Its reverse bar](https://github.com/openMSX/openMSX/blob/master/src/imgui/ImGuiReverseBar.cc)
projects current/begin/end and distinguishes view-only replay from recording.
BMSX adopts that separation, not MSX devices, board replacement, implicit
takeover on input, or a claim about closed-source Clover/Castlevania internals.

Representation table established before mirrored edits:

| Representation | TypeScript | C++ |
| --- | --- | --- |
| Replay input and retained future | Existing `HistoryMode.Replaying`, `InputJournal`, checkpoint slots | Same |
| Resume replay without restoring | `RuntimeHistory.beginPlayback`, existing machine-cycle/tick coordinates | Same names, i64 coordinates |
| Wall-paced replay | `RuntimeHistory.advancePlayback` uses the existing `FrameSchedulerState.runScheduledToNextLogicalTick` | Same; host time remains f64 milliseconds |
| Transport intent | `RewindRequest`, `afterSeek`, `playbackActive` in `HostRewind` | Same names and values; no new `m_` naming |
| Visible cursor | Requested coordinate during seek; actual scheduler cycles during playback/pause | Same |
| UI | Retained tiny-font labels and hit rectangles owned by `HostRewindTimeline` | Same arrays and action ids |

Affected hot-path callsites: mirrored `FrameSchedulerState.runScheduledToNextLogicalTick`,
`HostRewind.service`/`runPlayback`, TS `runHostFrame` and `runWorkbenchHostFrame`,
native `runLibretroFrame`, libretro audio delivery and both timeline input/render
owners. Input consumption stays in the existing `HistoryInputSource`; no new
per-instruction check, per-frame checkpoint, input copy, save-state codec or
second wall-clock accumulator is introduced. Playback continues the current
machine and journal cursor. Seeking may restore; Play/Pause may not.

Playback consumes normal host-time cycle grants, not the unpaced seek budget.
It presents and delivers current audio, suppresses live ICU input/vibration,
preserves future history, and pauses at its recorded end. A pause retains the
actual suspended machine boundary, including a position between checkpoints;
resuming does not charge paused wall time. Seek/Play/Takeover requests while a
GPU fence is pending retain the latest accepted intent. Opening the IDE retains
and pauses review before source editing/Hot Resume. Independent host pause
reasons still govern execution; explicit Play/Takeover releases only Requested,
not fullscreen/vibration initialization. The transport is not a second Studio
pause owner. `HostFrameSession.syncMachineOutput` projects timing and supervisor
audio state for both live and replay execution; libretro already performs those
projections at its frame-output boundary.

Proof gate: real BIOS/Nemesis TS and native hosts, libretro ABI, input-sensitive
deterministic replay comparison, unchanged history/capture counts during
playback, 50/60/144-Hz host pacing, repeated Play/Pause and held-button edges,
recorded-end stop, arbitrary-position takeover, pointer targets, pending backend
work, and the software/WebGL2/WebGPU Studio workflow. Physical SNES Mini timing
and worldtick stepping remain separate, unproved surfaces.

### Playback validation (2026-09-06)

- `npm run test:runtime-replay`: real BIOS/Nemesis full-state comparisons now
  include ordinary paced replay from an earlier reviewed position to the
  retained end. Both cores reject any live input/vibration during replay and
  reproduce guest state without translating values or object identities.
  TS/native host-controller runs and the libretro ABI run pass.
- The host-controller runs exercise held A, repeated pause/play, fresh replay
  audio, unchanged game pixels on pause, automatic end pause, pointer
  Play/Pause/Takeover/Cancel, and a new branch checkpoint at the exact paused
  playback position. Capture/restore counts do not
  increase during Play/Pause. TS additionally verifies independent pause
  reasons and queued Play superseded by Seek/Takeover during a backend wait.
- Mirrored scheduler tests pass for 50/60/144-Hz host deltas, a pause between
  input boundaries, continuation without restore, and backend latency. A fence
  completion consumes its already accepted grant, never the intervening wall
  time. Paused playback consumes no wall-time budget.
- The software/WebGL2/WebGPU Studio matrix passes playback → pause → playback
  → IDE → source edit → Hot Resume, then the existing repeated edits, real
  breakpoint/step, rejected build and guest-init repair. Each renderer retains
  cycle **718177228** for the first edit. The additional WebGPU test queues
  playback during an actual mapped-buffer wait, then supersedes it with IDE
  retention and Hot Resume. This is Chrome's software GPU test environment,
  not physical GPU or Mini hardware evidence.
- Lua suite: **852 passed, 1 skipped**. Native CTest: **28 passed**. Separate
  live Hot Resume harness: **92 assertions**; Scenario Lab: **124 assertions**.
  Browser player/Studio, headless tooling and native libretro product builds
  pass. Product machine,
  common-host, browser and IDE typechecks, core parity, strict boundaries and
  indentation audits pass. The broad tests typecheck still has the same
  **52 pre-existing diagnostics**; it is not reported as green.

Two six-second checkpoint slots, 1,024 input records and the save-state format
are unchanged. No new physical SNES Mini or ARM performance measurement is
claimed for this slice. The playback work does not complete W04-W09 or add
frame/worldtick stepping.

## Prerequisite: exact CPU restore

The initial live-owner probe (`return {}`, restore the same checkpoint three
times) produced object ids 5, 7, 9. Restoring a state also invoked guest GC,
which can clear weak entries and change allocation-triggered collection time.
Neither is an acceptable base for deterministic replay.

| Representation | TypeScript owner | C++ owner |
| --- | --- | --- |
| Next object hash id, raw u32 | `CPU.nextObjectHashId` | `GcHeap.m_nextObjectHashId` |
| Hard-halt latch | `CPU.hardHalted` | `CPU.m_hardHalted` |
| Tracked bytes and next collection bytes | `LuaHeap` | `LuaHeap` |
| Globals storage, including table capacity/hash chains | CPU snapshot object reference to `globals` | Same |
| System and ordinary global registerfiles | Ordered raw string-id keys and guest values | Same |
| Materialized canonical closures | Physical function addresses in CPU snapshot objects | Same |
| Resident execution domains | Existing `ExecutionDomainMask` | Same |
| Strings | Existing `StringPoolState` | Same |

Hot-path callsites before the prerequisite diff:

- TS `CPU.allocateObjectHashId`, `createTable`, `staticClosureAtAddress`,
  runtime closure/upvalue allocation, `LuaHeap.reserve`,
  `CPU.collectTrackedHeapBytes`.
- C++ `GcHeap.allocateHashId`, `allocate`, `allocateClosure`,
  `CPU.createTable`, `staticClosureAtAddress`, `allocateTrackedClosure`,
  `LuaHeap.reserve`, `CPU.collectHeap`, `GcHeap.collect`/`sweep`.
- Cold state boundaries: mirrored `CPU.captureRuntimeState` /
  `restoreRuntimeState`, `captureRuntimeSaveState` / `applyRuntimeSaveState`,
  external save-state codecs and libretro envelope serialization.

Restore rebuilds derived execution caches from the inserted media and preserves
the saved allocation sequence and collection schedule. Native reclamation of
the discarded host object graph is not a guest collection: snapshot weak
entries remain intact. Actual guest GC recomputes live byte usage, including
after a checkpoint that had accounted-for but unreachable allocations.

The replay comparison also exposed existing TS/native producer differences:
error-string interning order and closure/upvalue allocation order. These now
match at creation. The snapshot traversal in that prerequisite slice matched:
metatable, array, then hash storage; frame closure before its registers. The
storage slice below replaces recursive traversal with deferred object records. Cross-core comparison
does not remap object ids, reorder saved tables, or translate string ids.

## CPU checkpoint storage: REWIND-CPU-STORAGE-01

The storage refactor follows the producer/writer boundary in
[DuckStation's state wrapper](https://github.com/stenzek/duckstation/blob/master/src/util/state_wrapper.h)
and [MAME's save manager](https://github.com/mamedev/mame/blob/master/src/emu/save.cpp):
write owner state directly to storage, rather than construct a second object
model for a serializer. BMSX's dynamic Lua heap needs explicit graph identity;
[V8's snapshot sink](https://github.com/v8/v8/blob/main/src/snapshot/snapshot-source-sink.h)
and [serializer reference map](https://github.com/v8/v8/blob/main/src/snapshot/serializer.h)
provide that reference, not a memcpy of host pointers. Compression/delta storage
such as [openMSX DeltaBlock](https://github.com/openMSX/openMSX/blob/master/src/utils/DeltaBlock.cc)
operates on completed raw blocks; adding it above our previous DTO graph would
have left the capture allocations and duplicate table copies in place.

Representation table, established before the mirrored edits:

| Saved representation | TS | C++ |
| --- | --- | --- |
| Value record | Existing `ValueTag` plus two payload words | The same tags, converted at capture/restore from native NaN-boxed `Value` |
| Numeric payload | Low/high f64 words, no numeric conversion | The same bits via `bit_cast` |
| String/builtin payload | Existing u32 pool/primitive id | Same; restore resolves builtin ids against the CPU-owned singleton array |
| Table/closure payload | Object ordinal | Same; never a host pointer or guest hash id |
| Object index | Ordinal to u32 word offset | Same |
| Root/frame/completion values | Offsets of value records | Same |
| Capacity | Retained typed-array buffers; a capture writer publishes exact active views | Retained vector storage with logical word/object counts |

Object headers and child records are defined in `machine/cpu/snapshot`:
tables keep nine header words, three words per array slot, and seven per hash
node (key, value, next). Closures keep five header words and their upvalue
ordinals. Upvalues keep eight words, including open/frame/index state and the
saved value. A 2,048-table chain exposed a host-stack overflow in the old
recursive capture. Following [V8's deferred object serialization](https://github.com/v8/v8/blob/main/src/snapshot/serializer.cc),
capture now reserves ordinals at references and drains a flat pending-object
list, in ordinal order, after root capture. There is no recursive descent or
depth limit. Entire records are reserved before their columns are written;
references use ordinals, never pointers into a growable buffer. Both cores
use the same root/record order; guest hash ids remain independent of this
snapshot-local traversal order.

The capture-only reference map reserves ordinals before following edges. It
tracks identity, not value classification. Tables write their own array/hash
columns directly, including unused slots, chains, tombstones, metatables and
capacity. Restore allocates every object identity before resolving edges, and
fills final table storage directly. There is no intermediate `TableRuntimeState`
or per-value/per-object `CpuValueState`/`CpuObjectState` DTO graph.

Changed callsites are the mirrored CPU/table capture and restore boundaries,
`captureRuntimeSaveState`, `RuntimeHistory.captureCheckpoint`, and the external
save-state codec. Normal instruction dispatch, table mutation, guest allocation,
guest GC, ICU polling and replay execution gain no additional work. The existing
scalar CPU/frame metadata remains separate from the word arena.

Only a checkpoint slot being overwritten may supply storage for capture.
Expired/future checkpoints leave the logical retained range but their physical
slots keep storage until reuse or stop. A seek does not consume its checkpoint.
Capture reuses the evicted slot's buffers, grows geometrically when needed, and
publishes only the active prefix. Spare capacity is neither encoded nor compared
as machine state. TS keeps writer cursors outside the returned snapshot; it does
not introduce JavaScript-private/WeakMap access on the ES2020 browser build.

Disk and libretro serialization encode the same active words as little-endian
binary blocks through the common endian owner. No graph DTO is reconstructed
for disk, and no legacy graph reader remains. The trusted history path does not
invoke the external codec or its file-boundary validation.

This is not a zero-allocation full-machine capture: reference-index scratch,
pending-object/root/frame metadata, strings and other device snapshots still allocate, and
restore still reconstructs the live Lua heap. Bounded slot count is not a fixed
byte budget. Those costs need a host-specific budget before menu enablement;
CPU-buffer reuse does not justify skipping guest work or collecting every frame.

## Bulk checkpoint storage: REWIND-MEMORY-STORAGE-01

This storage boundary follows DuckStation's `AllocateMemoryStates` /
`SaveMemoryState` and MAME's `write_buffer` (sources above): devices copy their
raw memory into exclusively owned checkpoint storage, not a fresh intermediate
buffer subsequently copied into history. No second state format or buffer-pool
facade is introduced.

Representation and callsite inventory established before the mirrored edits:

| Saved region | TypeScript | C++ | Capture owner |
| --- | --- | --- | --- |
| Main RAM | `Uint8Array` of machine-model RAM size | `vector<u8>` of the same size | `Memory.captureSaveState` |
| VRAM | `Uint8Array` of synchronized device snapshot bytes | `vector<u8>` of the same bytes | `GxGpu.captureSaveState` |
| APU sample RAM | Fixed-size `Uint8Array` | `vector<u8>` copied from the device array | `ApuSampleMemory.captureState`, through `AudioController` |
| Socket 0/1 RAM | Present card's `Uint8Array`, or hardware absence | `optional<vector<u8>>` | `CartridgeCard.captureState`, through the controller |
| CPU heap | Existing word arena and object index | Existing retained word arena and index | `CPU.captureRuntimeState`; representation unchanged |

`captureRuntimeSaveState` accepts exclusive storage from a previous capture of
the same runtime/media configuration. Runtime/machine capture passes the saved
regions back to their existing owners. A fresh capture allocates them there;
reuse overwrites them there. Native callers transfer ownership with moves, not
vector copies. The former snapshot is consumed as storage, not retained as an
immutable checkpoint. Independent captures and every other retained slot stay
unchanged. There is no corrupt-state recovery or media-shape compatibility path.

Changed cold callsites: `RuntimeHistory.captureCheckpoint`, runtime/machine
save-state capture, and the four memory-region producers above. GPU/APU timing
synchronization and dependent DMA/IRQ capture order stay intact. The backend
must still finish pending work and synchronize VRAM before capture; storage
reuse cannot substitute for that fence. Restore and external/libretro encoding
continue to consume the same saved bytes. CPU instructions, RAM/MMIO writes,
DMA transfers, rendering, audio mixing and ICU polls gain no additional work.

This step targets bulk allocation churn, not retained byte count or all metadata
allocations. Strings, CPU traversal scratch and device queue snapshots remain
separate measured costs. Compression must be assessed on the completed owner
blocks, including workspace and decode cost, before choosing retention policy.
The current tree has an IMGDEC word-stream codec, not a general rewind byte
codec; the historical `BinaryCompressor` (last tree before removal `154458d8a^`) is
not a live dependency and has no mirrored native owner. Neither is silently
made part of the machine or resurrected as a compatibility path.

## Delivery gates

- CPU replay regressions in TS and C++: new object ids, cold/warm canonical
  closures, weak tables, GC schedule, hard halt, table layout, string identities
  and domain activation across restore. External codec round trips cover the
  same representation; no compatibility reader for previous internal formats.
- Device/scheduler replay: real ROM execution from a checkpoint under recorded
  ICU input, with CPU/RAM, cartridge RAM, VRAM/GPUREAD, APU, DMA and IRQ evidence.
  Normal output transport state is not compared as guest state.
- Bounded journal and seek controller: retention wrap, input-context changes,
  unarmed supervisor edges, branch behavior and backend-yield continuation.
- TS and libretro menu integration: presentation after seek, host responsiveness,
  ordinary frontend save/load, and explicit history lifecycle boundaries.
- Measure real-cart capture/restore/seek time and retained memory; build and
  parity audits alone are not runtime or performance proof.

## Runtime history owner: REWIND-HISTORY-01

The mirrored `machine/runtime/history/` modules own the timeline:
`input_journal` owns retained raw event storage, `input_source` selects live or
recorded input and suppresses replay vibration, and `history` owns checkpoints,
retention, seek and branch transitions. `Runtime` constructs the input source
before `Machine`. The ICU still consumes its ordinary input-source interface;
its registerfile, arm latch, interrupts and sample timing are unchanged.
The history itself is not recursively included in save-state.

Representation and hot-path inventory established before the mirrored diff:

| Value | TypeScript | C++ | Owner |
| --- | --- | --- | --- |
| Full machine-cycle time and journal sequence | Integer-valued `number`; retained times in `Float64Array` | `i64` | Device scheduler time; history coordinates |
| ICU payload | 41 raw words in `Uint32Array` | 41 `u32` words | Existing `devices/input/contracts` snapshot layout |
| Poll header | Raw word: sample present, Normal/Supervisor context, supervisor line | Same bit layout | `InputJournal` |
| Checkpoint | Machine time, event sequence, trusted `RuntimeSaveState` | Same | `RuntimeHistory` |
| Replay grant | Explicit integer machine-cycle count | `i64` | Existing frame scheduler |
| Restore origin | `RuntimeRestoreOrigin` enum | Same enum | Runtime restore boundary; not serialized |

Hot callsites are the ICU's existing `sampleInputControllerSnapshot` and
`supervisorRequestLineHigh` calls at VBlank, its vibration output call, and
the existing frame scheduler's execution entry/continuation checks. No history
branch is added to CPU instructions, guest GC, BIOS, cartridge devices or
cartlib. The input contract owns raw word storage/loading; history does not
invent pointer, pad-axis or fixed-point conversions.

### Recording and retention

`start(options)` allocates the checkpoint slots and fixed input arena, enters
`Recording`, and requests the initial checkpoint. `checkpointPending` pauses
scheduled execution. With the machine held, the host drains GPU work,
synchronizes backend VRAM and calls `captureCheckpoint()`. Snapshot capture
uses the existing trusted save-state owner, not the external file codec.

Each ICU VBlank poll stores an eight-byte machine time and 42 words: one
header plus the 41-word snapshot. The supervisor-line read finishes the record
even when no sample was armed. Unarmed payload words are unused. Recording
and replay allocate nothing per poll; existing guest execution is unaffected
by host input-polling frequency.

Checkpoint age is measured in machine cycles; requests are published at ICU
poll boundaries. Input-arena pressure also requests a checkpoint, stopping
before the next poll could overwrite an event needed by the newest checkpoint.
Older checkpoints whose event range has expired leave the retained range.
Their CPU snapshot buffers are reused on cold capture, not destructed inside
an ICU callback. Branching also discards future checkpoints logically while
retaining physical slot storage for reuse. Both physical rings wrap; checkpoint storage never
contains more than the configured number of snapshot slots.

Capacities and the interval are positive runtime configuration, not guest
registers. Hosts call `start` on a disabled history and complete the initial
capture before offering seek. No partial-history reader, missing-input
fallback or owned-value validation is involved.

### Seeking, cancellation and live takeover

`beginSeek(machineCycles)` selects the nearest earlier retained checkpoint and
the last recorded PCRTC boundary not after the requested time. A UI request
outside retention is clamped to the retained range. A checkpoint itself may
also be a suspended mid-tick boundary, for example after cancellation.
Checkpoint restore uses `RuntimeRestoreOrigin.HistorySeek`, preserving the
journal while replacing the machine state. Existing host pacing grants and
in-flight frame bookkeeping are discarded, not replayed as guest time.

`advanceSeek(cycleGrant)` reuses `runToNextLogicalTick` with an explicit grant,
independent of wall time or a hardcoded refresh rate. The call runs at most
one logical tick and retains unfinished work across yields. Prior residual
carry can accompany the new grant; a grant bounds emulated work, not the wall
time of an instruction, GC or backend operation. Both unsubmitted backend
work and an already submitted asynchronous readback return `BackendPending`.
The host services the backend and yields to its event loop between quanta.
It never samples live guest input or sends vibration during replay.

Reaching the target enters `Reviewing`: ordinary paced execution and debugger
instruction stepping remain paused. `Complete` reports the machine endpoint,
not completion of host delivery; pending GPU work must still finish before
presentation or capture. `cancelSeek()` also enters review at the current
execution boundary without deleting the recorded future. Only
`resumeRecording()` truncates future events/checkpoints. A branch requests a
fresh synchronized checkpoint before new live input; rejoining the recorded
end preserves its capture schedule. It clears the partial replay
target and grants so normal scheduling does not inherit abandoned work.

These operations require a suspended machine. Before any restore, the host
must also finish outstanding asynchronous backend operations against the old
state. Cancellation does not revoke a submitted GPU readback; the host must
finish it before a subsequent restore or branch capture.

Reboot, external full-runtime load and external `Runtime.callClosure` execution
end history at their runtime owners. The explicit restore-origin enum keeps
internal seeking distinct from external load without duplicating restore.
The host queue serializes media replacement, AEM application and Hot Resume
with snapshots. Direct machine mutation is not silently journalled; callers
must end the current history before an external write.
Queue admission and source/build rejection do not end history. The accepted
media, completion-call or supervisor-return owner does. Studio's pending
supervisor/init batches suspend collection until they finish; the physical
input journal is not misrepresented as containing tool-directed execution.

### Host delivery and remaining storage scope

The host integration below implements GPU synchronization, serialized
operations, cooperative seeking, restored presentation and audio/debug-output
suppression. APU clocks, DSP, DMA and GPU work still execute normally. No
silence insertion, prebuffering, guest-time compensation or guest GC is added.

The common host policy is bounded by snapshot count and input-record count,
not by a hard byte arena. CPU graph/string size, cartridge RAM and capture
scratch still affect memory and latency. Compression and a fixed-byte arena
are separate storage work, not prerequisites hidden behind a compatibility
reader or dropped emulated work. ARM/QEMU proof below is functional evidence;
it is not a measurement of total RSS or real-time headroom on physical hardware.

## Validation record: REWIND-STATE-01

`npm run test:runtime-replay` builds the actual BIOS and Nemesis S ROM, runs both
cores with software GPU backends and the same changing raw pad input, and
checks checkpoints at PCRTC ticks 2, 400 and 1200. Each checkpoint is replayed
for 120 ticks through trusted in-memory restore and through the external
codec (the libretro serialization envelope in C++). The complete resulting
runtime state must equal the uninterrupted reference state. The decoded final
states also compare equal between TS and C++ without normalization.
The final checkpoint additionally requires cart execution, nonempty VRAM and
active BADP playback, rather than treating equal idle devices as playback proof.

The runner services GPU backend fences and drains only the host APU output
ring. A nonzero supervisor fault sequence fails the run. This exercises real
guest execution and devices, but it is a scripted replay test, not an
browser rewind UI test. The history phase below additionally exercises the
external-event journal.

Measured in this checkout on 2026-09-05: Node 22.23.1, C++ Release, software GPU,
debug ROMs compiled at O3. Times are single-run measurements, not latency
guarantees. Capture includes backend VRAM synchronization and the trusted
snapshot; restore excludes disk decoding. Replay covers all 120 machine ticks.

| Core | Checkpoint | Capture ms | Restore ms | Replay ms | Encoded checkpoint bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| TS | 2 | 7.6 | 11.2 | 1428.6 | 6,888,591 |
| TS | 400 | 14.5 | 20.0 | 1214.7 | 8,936,523 |
| TS | 1200 | 18.1 | 26.9 | 521.3 | 10,232,918 |
| C++ | 2 | 3.6 | 1.9 | 33.2 | 6,888,591 |
| C++ | 400 | 4.3 | 3.9 | 33.7 | 8,941,643 |
| C++ | 1200 | 5.2 | 6.5 | 11.9 | 10,235,206 |

Encoded file size is not retained JS/native heap usage. At this prerequisite
stage, the snapshot still allocated its object graph. Those measurements do
not justify per-frame full
snapshots or a synchronous TS seek loop on the UI thread; bounded retained
storage and interruptible replay remain gates for the next slices.

Additional checks: machine/toolchain/IDE/host TypeScript builds, the Lua test
suite (835 passed, one skipped), native CTest (26/26), the actual libretro
product build, core-parity and architecture-boundary audits, indentation and
`git diff --check`. Native tests include actual `retro_run`, `retro_serialize`
and `retro_unserialize` entrypoint coverage. Those were the save-state
prerequisite results, not proof of a host rewind menu or Hot Resume history.

## Validation record: REWIND-HISTORY-01

The same real-ROM conformance runner now records 111 further ticks with
varying host-time grants, four checkpoint slots, 96 input records and a
20-tick-sized machine-cycle checkpoint interval. Both rings wrap. It seeks
to recorded offsets 111, 55 and 77 using 16,384-cycle replay grants, then
takes live control at 77 and records ten ticks on the new branch. None of
the three seek endpoints is a stored checkpoint. The live input provider
fails the test if replay reads it or sends vibration.

Every seek compares the full CPU and device state with the recorded endpoint,
including machine cycles and PCRTC tick count. Only host scheduling quotas,
frame bookkeeping and CPU execution budget are excluded from the comparison
between paced recording and quantum replay. Guest identities and registerfiles
are not normalized. After live takeover, the **complete** final state compares
equal between TS and C++, including their host scheduling state.

Additional mirrored regressions cover raw high-bit input words and times above
32 bits, sample contexts, unarmed supervisor NMI edges through the actual ICU,
input-pressure suspension, retention clamping, cancellation mid-quantum,
review/live transitions, reboot and delayed completion of a submitted GPUREAD
backend request. The real-ROM runner also checks external-load invalidation.

Single-run measurements on 2026-09-05, Node 22.23.1 and C++ Release, real
Nemesis debug ROM at O3 with software GPU backends:

| Core | Replay calls | Replay work total ms | Largest measured call ms | Three restores total ms | Five periodic captures total ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| TS | 1,788 | 250.1 | 7.9 | 84.3 | 105.6 |
| C++ | 1,788 | 7.2 | 0.6 | 25.1 | 39.9 |

Replay work includes backend service/retirement and audio transport draining,
but excludes assertion comparison and external state encoding. Captures
include VRAM synchronization and trusted capture; the initial and branch
captures are not included in the five periodic captures. These are observed
costs, not UI latency guarantees.

The journal is exactly **16,896 bytes** for 96 polls. Separate memory probes
stopped immediately after recording tick 1431 with four retained checkpoints,
kept the live runtime and three reference snapshots rooted, and measured the
drop caused by `history.stop()` without executing the machine:

- Node with `--expose-gc`, two full host collections before and after stop:
  `heapUsed` dropped 62,576,968 bytes and `arrayBuffers` 27,279,872 bytes,
  approximately **85.7 MiB combined**. These are distinct categories in
  [Node's memory accounting](https://nodejs.org/docs/latest-v22.x/api/process.html#processmemoryusage).
- Native single-threaded glibc probe: `mallinfo2().uordblks + hblkhd` dropped
  74,976,400 bytes, approximately **71.5 MiB**, using
  [glibc allocator accounting](https://sourceware.org/glibc/manual/latest/html_node/Statistics-of-Malloc.html).

These are allocator/GC-based estimates for this retained history, not RSS,
encoded checkpoint sizes, portable byte limits or peak capture memory. No
profiling allocation/GC calls were added to the runtime. At this stage the
snapshot graphs, not the event journal, dominated retention. The following
CPU-storage slice addresses that producer; host enablement remains separate.

Final checks for this history slice: 840 Lua tests passed, one skipped; native
CTest 26/26; real-ROM replay and cross-core history comparison passed; machine,
toolchain, IDE and TS host builds, the actual libretro product build,
core-parity/architecture-boundary audits, indentation and `git diff --check`
passed. These checks do not substitute for the remaining live host/UI gate.


## Validation record: REWIND-CPU-STORAGE-01

The same real BIOS/Nemesis regression still passes trusted restore, external
state/libretro restore, all three history seeks and live branching. Cross-core
comparison covers the complete decoded machine state, including the new word
arenas and object indices, without remapping ids or normalizing table storage.
Mirrored CPU regressions add buffer growth/reuse, shorter active prefixes,
independent retained checkpoints, equal wrapped hash ids, primitive/f64 bit
round trips and a 4,096-table cycle. The previously recursive TS capture failed
already at 2,048 linked tables. The external codec test also checks exact
little-endian bytes and exclusion of unused capacity.

Single-run observations on 2026-09-05, Node 22.23.1 / native Release, the same
real-ROM workload and software backends as the history record above:

| Core | Five periodic captures ms | Three restores ms | Replay work ms | Largest replay call ms |
| --- | ---: | ---: | ---: | ---: |
| TS | 85.4 | 56.6 | 248.4 | 7.4 |
| C++ | 28.3 | 14.1 | 7.4 | 0.6 |

The replay still takes 1,788 bounded grants. These timings include the same
backend/audio service work as the earlier history measurements; they are not
p99 values or real browser/frontend responsiveness measurements. In particular,
TS capture remains roughly 17 ms on average in these five samples, not a
zero-cost or zero-GC operation.

Both cores expose identical active CPU word counts and retained capacities:

| Checkpoint tick | Objects | Active CPU snapshot bytes | CPU buffer capacity bytes |
| --- | ---: | ---: | ---: |
| 2 | 805 | 47,260 | 69,632 |
| 400 | 13,973 | 1,728,044 | 2,162,688 |
| 1200 | 16,389 | 2,879,092 | 4,325,376 |

The same stop-at-tick-1431 retention probe, with four checkpoint slots and
three independent reference snapshots kept rooted, now reports:

- Node: `heapUsed` drops **1,584,176 bytes**, `arrayBuffers` drops
  **44,515,840 bytes**; combined **44.0 MiB**, previously **85.7 MiB**.
- glibc native allocation accounting: drops **46,688,672 bytes**,
  **44.5 MiB**, previously **71.5 MiB**.
- Input history is unchanged: **16,896 bytes** for 96 polls.

The method and limitations are the same as the earlier probe: allocator/GC
estimates, not RSS, portable byte limits, or peak transient allocation. The
large JS object-graph retention is gone; retained arena capacity, device/string
snapshots and capture/restore scratch still matter. Compression or device
buffer reuse must work at those owners, not hide behind a UI rewind facade.

Final validation: **844 Lua tests passed, one skipped; CTest 26/26**; full
real-ROM TS/native replay and post-branch equality passed. Machine/toolchain/
IDE/TS host typechecks and the actual ES2020 Browser Studio and native libretro
product builds passed. Core-parity, architecture-boundary and indentation
audits plus `git diff --check` passed. Host history collection remains disabled
by default; no quickmenu control or shortcut is introduced by this slice.

## Validation record: REWIND-MEMORY-STORAGE-01

Mirrored regressions write high-bit words through main RAM, both cartridge RAM
windows and the scheduled APU transfer port. Repeated runtime capture retains
all five destination buffers and contains exactly the new live state, while an
independent checkpoint remains unchanged and restores its original bytes.
The GPU restore still requests host redraw; storage reuse does not erase that
presentation invalidation. Neither socket needs executable media for RAM.

The real BIOS/Nemesis conformance runner now recycles a separate destination
across 120 ticks at each of its three anchors. It checks main RAM, VRAM and APU
buffer identity, compares the complete reused state against a fresh capture,
and verifies that the original anchor was not changed. Trusted restore,
external/libretro restore, sparse history seeks and branching still pass full
TS/C++ comparison with actual guest execution, nonempty VRAM, active BADP and
no supervisor fault.

A Node 22.23.1 probe at Nemesis tick 1200 reused CPU storage, warmed capture
eight times, then measured 25 stationary full-runtime captures without GPU
readback in the timed section. It kept buffer identities rooted to count the
distinct bulk allocations; that instrumentation is not normal history retention.

| Bulk destination policy | Distinct RAM/VRAM/APU buffers | Total bytes in those buffers | Median capture ms | Largest capture ms |
| --- | ---: | ---: | ---: | ---: |
| Before this slice | 75 | 170,393,600 | 16.5 | 19.6 |
| Recycled owner buffers | 3 | 6,815,744 | 12.7 | 14.5 |

Thus an overwritten Nemesis checkpoint no longer allocates another **6.5 MiB**
for these three regions. Cartridge RAM adds its installed size to that saving;
this Nemesis configuration has none. This is an allocation-churn reduction,
not a claim that the four retained checkpoints became smaller. Timings are
single-run instrumented observations, not browser p99 latency or zero-GC proof.

The core-parity audit exposed a separate checking error: it conflated
`AudioController::captureState` with `ApuOutputMixer::captureState` because
both definitions occupy `audio/save_state.cpp`. Method entries can now select
their qualified C++ class owner; the APU entry does so. Optional TS parameter
punctuation is not part of a parameter name. A subprocess regression verifies
acceptance of the selected owner and rejection of its missing/wrong signature,
even when another class has the same method name. No runtime method was moved
or excluded to silence the audit.

### Existing compression assessment

`src/bmsx/serializer/bincompressor.ts` was removed in `154458d8a` on
2026-03-19; its last implementation was inspected and executed outside the
working tree, not reintroduced. On the same real-cart tick, five warmed TS
passes on each completed raw region produced the following means:

| Region | Raw bytes | Encoded bytes | Encode ms | Decode ms |
| --- | ---: | ---: | ---: | ---: |
| Main RAM | 4,194,304 | 59,300 | 4.5 | 3.5 |
| VRAM | 2,097,152 | 1,140,893 | 14.1 | 5.1 |
| APU sample RAM | 524,288 | 6,174 | 0.3 | 0.6 |
| CPU value/object-record words (without ordinal index) | 2,813,536 | 739,124 | 5.6 | 4.7 |

All four of these zero-offset buffers round-tripped, but this is not a
ready-to-use rewind codec. A separate deterministic byte test failed exact
round-trip at lengths 9,000 and 65,536 with a four-byte-offset input view. Its
word-match view starts at backing-buffer offset zero, not `input.byteOffset`.
The implementation also creates typed-array views inside match search,
copies its output and grows decode buffers, and has no native counterpart.

The measured size reduction makes compression worth pursuing. It does not
justify adding that historical code unchanged, using the guest IMGDEC unit
for host history, or treating the encode/decode times as free. The next codec
decision must compare retained-workspace block/delta implementations (including
the openMSX/LZ4 reference above), cover exact subarray/tail behavior in both
cores, and include decode workspace and keyframe dependencies in the history
memory budget. No compression or new dependency is enabled by this slice.

Final validation: **846 Lua tests passed, one skipped; native CTest 26/26**;
the full real-ROM replay and post-branch cross-core comparison passed.
Machine/toolchain/IDE/TS host typechecks, the ES2020 Browser Studio build and
the actual native libretro product build passed. Core-parity (including the
qualified-owner regression), architecture-boundary and indentation audits plus
`git diff --check` passed. At this storage-prerequisite stage, host collection
was still disabled; the host integration below supersedes that status.

## Host integration contract (REWIND-HOST-01)

Collection is continuous during ordinary gameplay, from boot, not enabled by
opening the rewind menu. Reboot, external load and tooling mutations establish
a new timeline. Scenario execution is an external test session, not ordinary
player history. The quick menu opens the transport bar described in
`REWIND-UI-01` below; no rewind shortcut is assigned.

Production references checked before the host diff:

- [DuckStation System](https://github.com/stenzek/duckstation/blob/master/src/core/system.cpp):
  `AllocateMemoryStates`, `UpdateMemorySaveStateSettings`, `SetRewindState`,
  `DoRewind`; retained slots, explicit capture frequency, message pumping while
  reviewing, and restoration separate from ordinary paced execution.
- [openMSX ReverseManager](https://github.com/openMSX/openMSX/blob/master/src/ReverseManager.cc):
  sparse checkpoints plus event replay and a retained future until live takeover.
  This is a host timeline reference, not an MSX hardware model for BMSX.
- [RetroArch state manager](https://github.com/libretro/RetroArch/blob/master/state_manager.c):
  bounded retention and frontend ownership. BMSX's input replay remains inside
  the shared runtime; frontend serialize/unserialize is still an external load.

### Representation and callsite table, before the mirrored host diff

| State | TypeScript | C++ | Owner / active callsites |
| --- | --- | --- | --- |
| Checkpoint, input and cycle coordinates | Existing `RuntimeHistory`, integer `number` | Existing `RuntimeHistory`, `i64` | `captureCheckpoint`, `beginSeek`, `advanceSeek`, `resumeRecording`; no new guest state format |
| Pending user seek / branch / return | Host enum and cycle coordinate | Host enum and `i64` | Host rewind controller, quick-menu actions; never ICU actions |
| Exclusive asynchronous machine operations | Shared host `RuntimeTaskQueue` | Synchronous `retro_run`/load boundary | TS player/Workbench frame, checkpoint capture and existing IDE mutation tasks share one queue; no concurrent WebGPU snapshot and Hot Resume |
| Replay work budget | 16,384-cycle grants, bounded host work time | Same grants and host work limit | Host rewind service; backend drain/readback service between grants, return to host event loop |
| Audio delivery | Existing output ring/resampler plus rewind mute reason | Existing output ring/resampler plus rewind mute reason | Host audio owner; discard replay output, reset transport at transitions, execute APU normally |
| Restored image | Explicit committed presentation request | Same presentation request | Presentation owner overwrites held-frame texture from restored VRAM; backend replacement serial already invalidates interlace fields |

Initial retention policy deliberately uses the already measured reusable raw
slots, as DuckStation does, rather than silently enabling the failed historical
compressor. All hosts, including SNES Mini:
two checkpoints, six emulated seconds apart. The journal uses 1,024 fixed input records
(180,224 bytes). Nominal retained time after warmup is 6–12 emulated seconds; unusual PCRTC timings can exhaust the input ring earlier.
The actual retained endpoints, not these nominal durations, drive the menu.

This is a bounded **slot policy**, not a hard byte arena: CPU graph/string size
and cartridge RAM determine snapshot size. The measured four-slot Nemesis case
is about 44 MiB, excluding the live runtime, renderer and transient capture
scratch. The common policy halves that measured number of resident checkpoints and
trades that for longer replay. ARM build/functional evidence is not proof of
real SNES Mini frame-time or total-RSS headroom. Compression and a hard byte
arena require their own measured storage representation; neither a misleading
fixed-MiB label nor corrupt-data compatibility is introduced to claim that gate.

The original checkpoint-only command list is superseded by `REWIND-UI-01`:
the transport seeks through recorded time using the same input replay between
sparse snapshots. Returning to the latest retained boundary preserves the
recorded future. There is still no per-frame state capture.

Returning to the recorded end rejoins recording without allocating another
checkpoint slot just for looking at history. An actual branch still requires
an immediate synchronized checkpoint; a due timer or full newest-checkpoint
input interval also still requests capture on rejoin. This follows the
openMSX distinction between replay completion and discarding recorded future.
TS/C++ `resumeRecording` recompute that same request at the runtime owner.

The new host rewind class deliberately uses matching command, property and
method names in TS/C++, including `request`, `requestedCycles`, `resumeAtTarget`,
`stepCheckpoint`, `capture`, `restore` and `service`. The method-parity audit
checks the shared public commands. TS queues `capture`/`restore` because WebGPU
returns a Promise; native invokes the corresponding operations synchronously.

Capture requests raised by a completed machine tick are serviced after that
frame's presentation, rather than waiting for the next host callback to submit
the snapshot. This avoids discarding an extra host frame at every checkpoint.
The frame entry still services initial capture, navigation and bounded replay;
the end-of-frame call only services a pending recording checkpoint. TS holds
execution until its queued GPU capture finishes; native completes it inline.

Names in the new history/rewind owners use ordinary `camelCase` in both
languages. C++ member prefixes are not copied into TypeScript; existing owners
outside this slice are not subject to a repository-wide naming migration.

The SNES Mini cross-build exposed that its supported GCC 10 library does not
provide `std::bit_cast`. `CpuSnapshot.setNumber`/`number` keep the same two raw
32-bit words as TS's retained `DataView`; native uses fixed-size `std::memcpy`
for the floating-point bit transfer, as the existing native value and endian
owners do. These calls occur during CPU checkpoint capture/restore, not guest
instruction execution. No alternate snapshot format or toolchain fallback is
introduced.

## Validation record: REWIND-HOST-01

- `npm run test:runtime-replay` retains the full real-ROM state/history
  cross-core comparison and now also runs the actual common TS host loop and
  native libretro entrypoints. The host tests run 1,100 ordinary callbacks
  before opening the menu, then restore checkpoints, hold machine time, suppress
  replay audio, return to latest and resume from the past. Native additionally
  restores an external serialized state and checks the new timeline and reboot.
  The TS test holds a submitted backend capture while a tooling mutation and
  cancellation arrive; the mutation cannot run against the in-flight capture.
- `tests/conformance/runtime_replay/browser.mjs` bundles the same host owners
  against the actual browser backend. Chrome 153 / software Vulkan passed
  continuous collection, menu navigation, return/branch and an exact comparison
  of all 2,097,152 restored VRAM bytes. WebGPU is asserted, not replaced by the
  browser's WebGL fallback. The fault-gated canvas screenshot was inspected.
  Invocation (Playwright installed as a separate host test tool):

  ```sh
  BMSX_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node \
    tests/conformance/runtime_replay/browser.mjs \
    dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/rewind.png
  ```

  Headless Vulkan flags follow [Chrome's testing guidance](https://developer.chrome.com/blog/supercharge-web-ai-testing).
  Merely detecting a WebGPU adapter was insufficient with an incompatible
  headless swapchain configuration; no application fallback was added.
- `npm run build:platform:libretro-snesmini` passed the pinned ARM cross-build,
  imported-target-rootfs ABI audit and QEMU product smoke. The additional
  `bmsx_host_rewind_conformance_runner` CMake target was cross-built with the
  same SNES Mini toolchain, static compiler-runtime linkage and controller
  layout, passed `check_abi.py`, then passed the full actual BIOS/Nemesis host
  test under `qemu-arm-static -L .snesmini/rootfs`. This does not prove physical
  Mini rendering, audio-driver latency or memory/frame-time headroom.
- Quick-menu headless pixel assertions pass. The real Hot Resume IDE harness
  passes 91 assertions, including a new timeline before scheduler-owned init;
  it waits for the breakpoint rather than assuming an asynchronous capture
  finishes within one host callback. Scenario Lab passes 124 assertions with
  `--ttl 300`; the same longer test also passes on the unchanged baseline.
- 847 Lua tests pass, one is skipped; native CTest passes 26/26. Cartridge
  conformance and the ScenarioRunService test pass. Machine, IDE, browser and
  Node project typechecks plus Browser Studio/player and native libretro builds
  pass. Broad scripts/tests typechecks are not clean: an untouched model
  resource lacks `datatype`, and legacy test typing errors remain. A detached
  `4bd331800` worktree reproduces these; this slice adds no test type errors.

No frame-time or fixed-MiB guarantee is inferred from these functional tests.
Core method-parity, strict architecture-boundary and indentation audits pass;
the final patch also passes `git diff --check`.

## Rewind transport UI (REWIND-UI-01)

The initial command-list submenu is rejected: rewind is a transport over the
game image, not a list of separate seek/return/pause actions. The quick menu is
only the entry point. A compact bottom bar owns the timeline, selected time and
control hints, using the existing host tiny-font atlas. The game retains its
viewport and is not resized or replaced with a second render target.

References examined before this mirrored UI diff:

- [Nintendo's demonstration, 2:35](https://youtu.be/f4Ge7iVyOyw?t=155) and
  [official Rewind controls](https://en-americas-support.nintendo.com/app/answers/detail/a_id/27462/p/172/c/898):
  game-first transport presentation, L/R navigation and START for live takeover.
- [openMSX ImGuiReverseBar](https://github.com/openMSX/openMSX/blob/master/src/imgui/ImGuiReverseBar.cc):
  a bottom-positioned time range/cursor, proportional pointer seeking and
  delayed commands to the existing replay owner, not UI-owned snapshots.
- [mpv OSC](https://github.com/mpv-player/mpv/blob/master/player/lua/osc.lua):
  bottom-bar layout and coalesced, non-identical seek requests. Its Lua player
  integration is not an invitation to move this host UI into guest cartlib.
- [MAME menu lifecycle](https://github.com/mamedev/mame/blob/master/src/frontend/mame/ui/menu.cpp):
  stack changes deactivate the previous owner and reset UI input centrally;
  the destination menu does not clean up whichever screen happened to precede it.

### Representation and hot-path callsites, before implementation

| State | TypeScript | C++ | Owner / callsites |
| --- | --- | --- | --- |
| Recorded range / seek target | Existing integer cycle `number` | Existing `i64` | `RuntimeHistory`, `HostRewind.seekTo`; storage and journal unchanged |
| Transport inputs | Normalized host LB/RB, A playback, START takeover, B; existing repeat state | Same controller bits and native repeat state | `HostOverlayMenu.tickInput`; consumed before live ICU input, including the exit frame |
| Previous button state | Input owner keeps physical pressed state separate from consumption | Normalized physical button bits; keyboard navigation also includes its existing stick thresholds | `HostOverlayMenu.latchButtonStates` must not latch consumed output as a release; holding the opening button does not activate the destination page |
| Timeline navigation | One emulated-second relative steps; pointer position mapped to range | Same integer-cycle target calculation | `HostRewindTimeline.moveCursor` / `seekAt`; existing replay snaps to a recorded PCRTC boundary |
| Bottom bar | Retained rectangles, glyph submissions and host command arrays | Same retained submissions / arrays | `HostRewindTimeline.queueRenderCommands`; no per-frame buffer construction |
| Pending live takeover/playback | Seek intent plus `afterSeek` request | Same | `HostRewind.resumeHere` / `togglePlayback` / `service`: START or A during seek waits for the selected target; Pause or a newer seek supersedes that intent |
| Overlay transition | Page plus Accept/Cancel/Discard/Retain outcome | Same enums | `HostOverlayMenu.transitionTo` is the only page writer after construction; departure, pointer/repeat reset, exclusive input and destination activation are one lifecycle |

Opening the keyboard must not know about rewind. A transition deactivates its
old page before activating its destination. Leaving rewind accepts the selected
position, cancels back to the recorded end, retains the reached position for
another view, or discards the UI session when its execution owner takes over or
the native runtime is unloaded. Leaving the keyboard releases its virtual key pulse
through the existing next-poll input publication boundary. Every transition
consumes routed controller input for its exit frame, including shortcut routes.
Every route uses this lifecycle, not destination-specific cleanup calls. This
is a bounded state machine for the existing host overlays, not a new workbench
navigation framework or a generic callback facade.

LB/RB (or left/right) move through the recorded range; holding uses the existing
host button-repeat cadence. A now toggles recorded playback/pause and START
takes live control, as specified in REWIND-PLAYBACK-01 above. B or the existing
menu chord cancels and returns to the recorded end. Pointer hit targets expose
the same actions. Seeking, playback and paused review are visibly distinct.
No new activation shortcut is introduced.

The two-checkpoint capacity and six-second capture interval are unchanged.
Navigating between checkpoints reuses the existing input replay; it does not
capture every frame, increase capacity or expose guest objects to the UI.

### UI and lifecycle validation

- Real BIOS/Nemesis TS and libretro host runs cover a held opening button,
  LB/RB navigation between checkpoints, held-repeat bounds, B cancel, START
  branch and rewind-to-keyboard cancellation. Native also covers external
  save/load and reboot. The native held-button regression failed before its
  latch was corrected to read physical input instead of consumed output.
- TS accepts the intended journal boundary while a submitted GPU capture is
  deliberately held; START cannot resume from an intermediate replay state.
  The input-routing test checks virtual-key release on the next input poll
  and consumption of the departing page's controller input on its exit frame.
- The actual browser WebGPU test exercises both clickable track endpoints,
  LB/RB keyboard aliases, return and branch, and compares all 2,097,152 bytes
  of restored VRAM. Browser and native software screenshots were inspected:
  the game retains its viewport, the transport stays at the bottom, and the
  tiny-font labels fit. TS assertions also inspect the retained submissions'
  bounds and six-pixel font height.
- `npm run test:runtime-replay` passes real-cart state/history cross-core
  comparison and both host runs. Lua tests pass 847 with one skipped; native
  CTest passes 26/26. Quick-menu headless pixel assertions still pass.
- Browser player/Studio and native libretro product builds pass. The SNES Mini
  core build, target-rootfs ABI audit and QEMU product smoke pass; the expanded
  actual libretro host test also passes under ARM/QEMU with the Mini controller
  layout. This is not physical Mini memory, GPU or frame-time evidence.

Machine, IDE, browser and Node project typechecks, method-parity, strict
architecture-boundary and indentation audits pass, as does `git diff --check`.
No new snapshot allocation or capture frequency is introduced by this UI slice;
the existing storage limitations above still apply.

## Transport ownership corrections (REWIND-OWNERS-01)

The UI validation above missed a cursor round-trip error and a stale completed
preview label. It also used serialization as a native completion probe and a
VRAM download as a GPU fence. These are not compatibility requirements.

Implementation order, with a separately validated commit for each owner:

1. Separate selected transport time from resolved replay time; draw after
   service/update in all hosts. Observe native controller completion directly;
   keep external libretro ABI tests separate from controller tests.
2. Separate GPU state-replacement synchronization from snapshot readback.
   Checkpoints still materialize VRAM; replacing discarded state must not.
3. Give host UI edges, repeats and pointer capture one input owner. Pages own
   bindings and actions, not physical-history bookkeeping or repeat algorithms.
4. Make positioned glyph runs the actual render-command contract; remove
   unsupported layout fields, rather than pretending to implement
   alignment in the blitter.

References reviewed before the transport/phase diff:

- [Qt QAbstractSlider](https://github.com/qt/qtbase/blob/dev/src/widgets/widgets/qabstractslider.cpp):
  slider position and committed value are distinct; relative actions operate
  on the slider position. BMSX keeps the selected cycle coordinate even when
  replay resolves it to the preceding recorded PCRTC boundary.
- [MAME menu processing](https://github.com/mamedev/mame/blob/master/src/frontend/mame/ui/menu.cpp):
  input handling and drawing are separate phases. Commands are built from the
  state being presented, not before the operation that changes that state.

### Representation and hot-path callsites, before mirrored edits

| State / operation | TypeScript | C++ | Owner and callsites |
| --- | --- | --- | --- |
| Selected transport coordinate | `HostRewind.requestedCycles: number` (integer cycles) | `HostRewind::requestedCycles: i64` | `seekTo`, `positionCycles`, timeline `moveCursor`/`seekAt`; retained throughout review, including pending/coalesced seeks |
| Resolved replay boundary | Existing `RuntimeHistory.targetCycles` | Same `i64` field | `beginSeek` resolves against the journal; no extra presentation copy |
| Interrupted replay coordinate | Scheduler cycle count | Same `i64` count | `service` Pause/Stopped adopts the reached cycle as both resolved and selected position |
| Frame phases | `runHostFrame`, `runWorkbenchHostFrame`, tooling `runCpuProfileHostFrame` | `runLibretroFrame` | Poll/route input; clear presentation once; service/update; queue current overlay; present; capture due checkpoint |
| Overlay output | Retained host command arrays | Same retained arrays | `HostOverlayMenu.queueFrameOverlayCommands` selects the active page or passive FPS/usage overlay after update |
| Completion observation | Public `seeking`, task readiness, history mode | Public `seeking()`, history mode | Real-cart conformance runners; no stable-cycle heuristic, test-only core API or per-poll serialization |

The cursor must return exactly to the recorded end after LB then RB, both
after each seek completes and when requests are coalesced. Only a deliberate
range clamp or interrupted replay changes the selected coordinate. The actual
machine still stops on a journal boundary, not on an invented partial frame.

Transport/phase validation: the added real BIOS/Nemesis regression failed at
748,124,835 instead of 748,805,462 cycles before the fix. TS and native controller
runs now pass repeated LB/RB round trips, held navigation, cancel, branch and
keyboard transitions. The separate libretro ABI run passes audio transport,
external save/load and reset without using save-state as a completion probe.
WebGPU passes full restored-VRAM comparison and same-frame submitted-label
assertions; the extra screenshot frame is removed. The screenshot was inspected.
IDE Hot Resume passes 91 assertions; Scenario Lab passes 124. Host input tests,
browser/IDE typechecks, parity/boundary/indent audits and diff checks pass.

## Backend readback lifetime (REWIND-GPU-LIFETIME-01)

Reference: [DuckStation GPU state commands](https://github.com/stenzek/duckstation/blob/master/src/core/gpu.cpp)
and [its video command queue](https://github.com/stenzek/duckstation/blob/master/src/core/video_thread.cpp).
Load and save are distinct commands, ordered with rendering; loading is not
implemented by first saving the state that will be abandoned. BMSX has no GPU
worker thread, but WebGPU GPUREAD completion callbacks reference machine-owned
buffers. Those callbacks, including a deferred second GPUREAD, must finish
before host mutations or checkpoint restore. The existing snapshot/replacement
serial then orders the restored texture upload after preceding GPU submissions.

### Representation and callsites, before mirrored edits

| Operation | TypeScript | C++ | Owner / callsites |
| --- | --- | --- | --- |
| Complete outstanding host readbacks | `GPUBackend.finishGxGpuReadbacks(): void \| Promise<void>` | Same virtual method, `void` | `HostRewind.restore`, TS `RuntimeTaskQueue` mutations; no emulated cycles, VRAM copying or execution of discarded commands |
| Async readback chain | Existing `gpureadCompletion` / deferred GPU and token | No async CPU callbacks in software/GLES2 | WebGPU drains the chain, not just its first promise; GL/software completion is synchronous and needs no additional fence |
| Actual snapshot | Existing `captureGxGpuVramSnapshot(gpu)` | Same | Checkpoint capture and external save-state only; WebGPU capture also finishes the complete readback chain before downloading VRAM |
| Mutation consumers | Hot Resume installation, AEM application, reboot, Scenario Lab media replacement | Rewind state restore | None of the TS task callbacks captures runtime state or consumes a VRAM snapshot; keeping their old blanket capture would copy unused bytes |

No `glFinish`, GPU readback used as a fence, new renderer epoch, or per-frame
promise is needed. This method guarantees CPU callback lifetime, not device-wide
GPU idleness. GPU work and the next snapshot upload remain ordered in the same
graphics queue/context. Checkpoint capacity, capture frequency and raw register
representations are unchanged.

GPU-lifetime validation: real-cart TS/native runs assert zero extra VRAM
captures during seeks. The actual browser WebGPU backend test submits a GPUREAD,
resets its FIFO before mapping completes, and submits a second deferred request.
Separately gated real mapping callbacks prove that the replacement boundary
waits for both, without publishing a VRAM snapshot. After restore, all 2,097,152
VRAM bytes still match. Existing live return/branch/audio tests, browser
typecheck, parity/boundary/indent audits and diff checks pass.

## Host UI input owner (HOST-UI-INPUT-01)

Reference: [MAME ui_input_manager](https://github.com/mamedev/mame/blob/master/src/emu/uiinput.cpp)
keeps physical UI state and repeat deadlines outside individual menus. Its reset
state suppresses held controls until release; clearing a repeat map alone is
not a reset. [MAME menu transitions](https://github.com/mamedev/mame/blob/master/src/frontend/mame/ui/menu.cpp)
reset input on ownership changes. BMSX follows this distinction without copying
MAME's entire menu framework or involving the guest ICU.

### Representation and callsites, before mirrored edits

| State | TypeScript | C++ | Owner / hot-path callsites |
| --- | --- | --- | --- |
| Host UI controls | Existing `InputControllerGamepadButtonBit` indices / `u32` masks | Same enum / masks | `HostUiInput.update`: keyboard aliases plus four physical pads; no machine sampling, remapping or guest action maps |
| Input participation | Host-only Keyboard/Gamepad/LeftStick/Pointer flags and keyboard-control mask | Same flags / mask | Menu transition `reset`; views choose sources, the input owner has no page enum, keyboard command or rewind action |
| Physical / suppressed / edge masks | Retained typed arrays | Fixed arrays | `updateButtons`; transitions suppress every held control until its physical release, independently of routed consumption |
| Repeat deadlines | Shared `ButtonRepeat`, also used by `PlayerInput` | Same `ButtonRepeat` | One retained record per source/control; repeated queries share the frame result, no second cadence implementation or per-transition map allocation for host overlays |
| Pointer capture | Viewport position, changed/down/up flags, captured target | Same fields | Input owner maps/samples once; view hit-tests only on changes and supplies target to `activatePointer`; transition reset cancels capture |
| Input routing | Existing device consumption methods | Existing libretro input consumption | `HostUiInput.consume` after handling; reset consumes departing/entering sources on the transition frame. OSK leaves physical keyboard input to the game |

The menu only chooses actions and hit targets. It must not latch physical state,
own repeat arrays, reconstruct stick directions, or duplicate input consumption
across its return paths. Poll, handle, consume is one frame phase; a transition
cannot create a synthetic press from consumed output. Closed overlays do no UI
sampling work. The existing quick-menu and OSK shortcuts remain unchanged.

Pointer callback IDs now come from the owning libretro ABI header, matching
[libretro-common](https://github.com/libretro/libretro-common/blob/master/include/libretro.h),
rather than input.cpp-local constants.

Input validation: TS and native tests cover held-button/stick suppression until
release, repeat cadence and same-frame queries, physical state after consumption,
and pointer capture cancellation across transitions with the same target ID.
Real BIOS/Nemesis TS, native controller and libretro ABI runs pass transport,
keyboard, cancel/branch and audio checks. The actual WebGPU run and Scenario Lab
(124 assertions) pass. The full Lua suite passes (849 tests, one skipped).
IDE/browser typechecks, parity/boundary/indent audits and diff checks pass.

## Positioned glyph command (HOST-GLYPH-CONTRACT-01)

Reference: Dear ImGui's
[RenderTextClippedEx](https://github.com/ocornut/imgui/blob/master/imgui.cpp)
calculates alignment before submitting positioned text to
[ImDrawList::AddText](https://github.com/ocornut/imgui/blob/master/imgui_draw.cpp).
BMSX adopts that ownership boundary, not ImGui's full text layout API. Its
bitmap glyph iterator consumes a top-left origin, glyph advances and explicit
newlines/tabs. The UI already measures and positions centered labels.

The audit hypothesis that background fields were also unused was incorrect:
quad-stream, TS headless, native software and GLES2 all render per-glyph
backgrounds. Those fields and their ordering test remain. Only unsupported
`align`, `baseline`, `wrap_chars` and `center_block_width` are removed. Guest
cartlib text layout is independent and remains unchanged.

### Representation and callsites, before mirrored edits

| Contract | TypeScript | C++ | Owner / hot-path callsites |
| --- | --- | --- | --- |
| Positioned host glyph run | `GlyphRenderSubmission`: top-left `x/y`, font, item range, foreground/background, layer | Same fields; native vector of text lines | `forEachBatchBlitGlyph` emits positioned glyphs; no ignored layout flags or compatibility translation |
| Retained producers | `HostOverlayMenu`, `HostOnScreenKeyboard`, `RewindTimeline`, IDE `OverlayRenderer` pool | Same host views; no native IDE | Views measure at layout changes and update positions/text; IDE pooled submissions no longer rewrite unsupported fields |
| Consumers | `HostOverlayQuadStream` (WebGL/WebGPU), headless host 2D | GLES2 host pipeline and software host renderer | Existing glyph iterator and background-before-glyph passes; no additional layout pass, buffer, allocation or validation |

Glyph validation: TS/native tests exercise explicit item ranges, top-left
positions, tabs and newlines with both MSX and tiny fonts. The existing glyph
background/atlas test remains green. Actual headless quick-menu pixel checks
pass; native rewind and WebGPU screenshots were inspected without adding a
settling presentation frame. Final IDE typechecking also removed an obsolete
second Execute-to-PresentPending conversion: the execution branch already
owns that transition.

### Combined delivery validation

- `test:runtime-replay`: actual BIOS/Nemesis TS/native state and history parity,
  host-controller behavior and separate libretro ABI behavior pass.
- Actual WebGPU deferred-GPUREAD lifetime test, all 2,097,152 restored VRAM bytes,
  and same-frame submitted overlay status pass. Seeks perform no extra VRAM
  captures in the TS/native controller tests.
- Lua suite: 851 passed, one skipped. Native CTest: 28 passed. Live IDE Hot Resume:
  91 assertions; Scenario Lab: 124 assertions. Headless quick-menu pixels pass.
- Machine/IDE/browser/node typechecks, browser-player/browser-Studio/native
  GLES2 product builds, parity/boundary/indent audits and diff checks pass.
- Pinned SNES Mini build, target-rootfs ABI checks and 16-frame QEMU product
  smoke pass. Both expanded ARM host-controller and libretro ABI rewind runs
  also pass against that rootfs. Physical Mini memory, GPU/audio behavior and
  frame-time headroom are not established by these runs.

No capacity, checkpoint interval, compression policy, guest instruction path or
input-journal representation changes are part of these corrections. They do
not make full-machine capture/restore allocation-free or prove that the current
retention policy fits a physical Mini's memory budget.

## Studio execution loop (W01-W03)

The combined contract and production references are in
[Studio development workflows](studio_development_workflows.md). Host pause is
independent of rewind and of editor focus. The Run menu has one checked Pause
toggle, without a gameplay shortcut. F5/F6 remain guest keyboard input outside
the IDE; debugger Continue is enabled only at a debugger stop. No DOM pause
overlay or frame-stepping control is introduced. Both host menus
support Retain when yielding to another view. The generic post-restore
notification ends old inspector references without serializing debugger state.

Source compilation is non-mutating preparation within the shared GPU-exclusive
task queue. A compile rejection leaves installed media, position, history and
the ability to resume intact. Actual Hot Resume installation or accepted
supervisor-return execution invalidates the previous history. New collection
waits for annotated init to complete, including debugger stops and fault repair. This does not
retain a timeline across code revisions or introduce replay of tool commands.

Validation on 2026-09-06:

- `test:studio-workflows`: actual BIOS/Nemesis and browser-Studio composition
  run the same workflow with software, WebGL2 and WebGPU, each in an isolated
  workspace/browser session. Repeated rewind/pause/FSM edits on the retained
  actor, current hover inspection after restore, compile rejection,
  breakpoint/step inside init, fault repair and pointer Run-menu actions pass
  on all three. The corrected menu-only pause toggle and F5/F6 down/up in real
  ICU keyboard registers are part of the same workflow, including holding a
  pointer press without repeated toggling. Only the additional real pending
  `mapAsync` callback test is WebGPU-specific. All three tiny-font screenshots
  were inspected; no obsolete fault adornments after repair.
- Player WebGPU restore still compares all 2,097,152 VRAM bytes and the actual
  deferred-readback callback lifetime. TS/native real-ROM replay/history,
  host-controller and libretro ABI tests pass. Native Retain preserves both
  the selected state and recorded future; post-restore observes installed state.
- Live IDE Hot Resume: 92 assertions; Scenario Lab: 124. The separate unpaced
  headless `nemesis_s_pause_assert.lua` scenario also passes. Lua tests: 851
  passed, one skipped; ROM/compiler/tooling tests: 119 passed; CTest: 28 passed.
- Machine, IDE, common/browser/node host and Lua/ROM toolchain typechecks pass;
  browser player/Studio, Node tooling and libretro product builds pass. Parity,
  strict architecture-boundary and indentation audits pass.
- Broad `tsc -p tests` and `tsc -p scripts` are **not green**: respectively 52
  diagnostics and the `rombuilder.ts` missing model `datatype` diagnostic also
  reproduce identically from an isolated archive of pre-slice `9cb4cf93b`.
  No new diagnostics remain; these wider pre-existing errors were not hidden
  by changing tsconfig or weakening types.

There is no new physical Mini, ARM memory-budget or sustained frame-time
measurement in this Studio slice. Checkpoint capacity, input stride, guest
timing and the TS/native rewind algorithms are unchanged. Current closure and
static-layout migration limitations remain explicit in the workflow document;
the passing loop is not a claim that every possible Lua edit is supported.
