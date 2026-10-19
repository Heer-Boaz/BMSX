# Generic machine history and rewind

Status: deterministic save-state, shared TS/C++ history and continuous host
collection are implemented. TS player/Studio and libretro expose checkpoint
navigation in the existing quick menu. Rewind is an emulator facility, not a
Studio or cartlib service. Physical SNES Mini performance remains unmeasured.

The current shared transport also docks in Studio's live inspectors and Game
View. LB/RB step recorded video boundaries; Left/Right retain second-sized
seeking. The earlier slice notes below describe their original controls. The
timeline now owns only presentation, not cursor commands or replay execution;
see [current timeline ownership](studio_runtime_timeline.md).

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
   Intermediate host presentation, audio delivery and diagnostic output are
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

## Default retention window

The default TS/native host policy retains six reusable checkpoints, six emulated
seconds apart, and 4,096 fixed-size ICU records. The memory-constrained SNES Mini
build instead retains three checkpoints, 7.5 emulated seconds apart, and 2,048
records. After periodic PAL/NTSC recording fills the slots, the default window
is at least 30 emulated seconds (nominally 30–36); the Mini window is at least 15
seconds (nominally 15–22.5). Evicting the oldest checkpoint leaves five complete
six-second intervals or two complete 7.5-second intervals, respectively.
Capture occurs at the next recorded input boundary, so the interval can be
slightly longer than the nominal duration. The journal must cover the whole
oldest-checkpoint-to-present continuation. The respective 4,096/2,048 records
cover that continuation at PAL/NTSC rates and occupy 704/352 KiB. Menu endpoints
still come from the actual retained machine-cycle range, never a synthetic
duration limit.

Representation/callsite inventory before this policy change:

| Host policy | TypeScript | C++ default | C++ SNES Mini |
| --- | --- | --- | --- |
| Retained checkpoints | `number`, six slots | `size_t`, six slots | `size_t`, three slots |
| ICU journal records | `number`, 4,096 records | `size_t`, 4,096 records | `size_t`, 2,048 records |
| Capture interval cycles | `number`, `cpuHz * 6` | `i64`, `cpuHz * 6000 / 1000` | `i64`, `cpuHz * 7500 / 1000` |

The owning CMake target emits `BMSX_PLATFORM_SNESMINI` from the existing
toolchain's `BMSX_SNESMINI_TARGET`. This selects the native host constants at
compile time, independently of the Mini controller-layout definition; the
constructor converts integer milliseconds into machine cycles once. No runtime
platform detection, machine-format change or TS policy change is involved.

`HostRewind.service` / `HostRewind::service` start the existing history owner and
service its synchronized captures. The VBlank -> ICU -> history input-source ->
`RuntimeHistory.recordInputBoundary` / `InputJournal.recordLine` hot chain and
its native mirror are unchanged; no extra serialization, allocation or polling
is added there. Capture and replay use their existing owners and buffer reuse.
Mini uses half the checkpoint slots and journal storage, but its wider capture
interval means reconstruction may execute nominally 7.5 rather than six
emulated seconds after a checkpoint. This follows the separate frequency/slot
choices
in [DuckStation's memory-state policy](https://github.com/stenzek/duckstation/blob/master/src/core/system.cpp),
without adding a second store or enabling an unmeasured compressor.

This remains a bounded **slot/record policy**, not a hard byte arena or an
unconditional duration guarantee for arbitrary register configurations. Startup,
reset and a newly established timeline cannot provide unrecorded past; branch
checkpoints and unusually high programmable PCRTC rates can shorten retention.
Snapshot memory varies with CPU object/string storage and cartridge RAM. Six
slots need at least 39 MiB for main RAM, VRAM and APU sample RAM alone; three
slots need 19.5 MiB. CPU and other device metadata add to that. Physical
iPhone/iPad and SNES Mini memory and frame-time headroom have not been measured
by this policy change. Paired x86-64 native Linux measurements after 100 emulated
seconds of Nemesis recorded approximately 55.3 MiB of history-owned allocations
for the default policy and 27.7 MiB for the Mini policy. These are example
retention costs, not whole-process RSS, ARM measurements or hard memory limits.
The ordinary native replay suite also builds and runs the Mini host-policy
branch without requiring ARM hardware, checking both
retention policies and complete guest-state reconstruction with the same owner.

## Seek presentation boundary

Representation/callsite inventory established before the mirrored host edits:

| Representation | TypeScript | C++ |
| --- | --- | --- |
| Seek/record/playback position | Existing scheduler cycle `number` and `HistoryMode` | Existing `i64` and `HistoryMode` |
| Unpublished tick receipt | `FrameSchedulerState.clearPendingTickCompletion` | Same scheduler operation |
| Final image admission | `HostRewind.presentationPending` boolean | Same boolean |
| Previously displayed game image | Existing renderer-owned completed texture | Same renderer-owned texture |

`HostRewind.service` / `HostRewind::service` consume tick receipts during fast
reconstruction without passing them to live presentation. Checkpoint restoration
does not publish an image if forward reconstruction is still required. Completion,
explicit interruption or a physical stop requests the single resolved image after
backend fences finish. UI redraws continue to use the previously published image.
`runPlayback` retains normal paced publication. CPU/device execution, cycle grants,
checkpoint/input formats and guest rendering are unchanged. No image copies,
second replay loop or gameplay hot-path work are added.

This separates reconstruction from playback, as
[openMSX's reverse manager](https://github.com/openMSX/openMSX/blob/master/src/ReverseManager.cc)
separates fast-forward reconstruction from normal replay and output.

## CPU execution grants are not checkpoint state

Owner decision, 2026-09-13, before the mirrored implementation change.
The standalone preload cart exposes a full replay mismatch at checkpoint 400:
only `cpuState.instructionBudgetRemaining` differs (7344 versus 9673).
History and playback tests already filtered that field. This is a snapshot
ownership error, not a guest nondeterminism exception.

In [MAME mame0280 `device_execute_interface`][mame-execution-state], save-state
registration retains device time, total cycles, suspension and interrupt
inputs, not the current execution countdown. Its [scheduler][mame-execution-grant]
assigns the countdown immediately before running a CPU and accounts the
consumed cycles immediately afterwards. BMSX already follows the same execution
lifetime but incorrectly included its expired countdown in `CpuRuntimeState`.

| Owner / representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Current run grant | `CPU.instructionBudgetRemaining: number` | `CPU::instructionBudgetRemaining: int` | Keep the existing live countdown and name. |
| Actual emulated time | `DeviceScheduler.schedulerNowCycles` | `DeviceScheduler::m_schedulerNowCycles` | Keep the current machine-time snapshot. |
| Retained guest state | `CpuRuntimeState` | `CpuRuntimeState` | Remove only the call-local countdown, including capture and restore. |
| Disk format | Save-state property table and CPU decoder | Same property table and CPU encoder/decoder | Remove the field, without a legacy reader or normalization. |
| Host pacing | Existing frame scheduler / executor state | Same owners | No change to pacing, replay grants, instruction stepping or clock domains. |

Hot-path callsites reviewed: TS `runUntilDepthNormal`/`runUntilDepthInstrumented`
and native `runLoop` assign each fresh grant before dispatch;
opcode/fused handlers, builtin charging and TS `charge` debit that grant.
`DeviceScheduler.currentNowCycles` reads it only during an active CPU slice;
`runCpuSlice` brackets that lifetime. `CpuExecutionState.runSlice` and
`runSuspendedUntilDepth` account the result immediately after the call.
`Runtime.callClosure` already requires a suspended CPU. Its capture/restore of
the preceding expired countdown is therefore removed as well: there is no
active caller slice to preserve. Real consumed time and completion frames stay
owned by the shared executor. Dispatch paths gain no checks or allocations.

Capture and load happen at suspended execution boundaries. The next CPU call
gets its budget from its caller, never from the preceding call's remainder.
Tests must compare the complete CPU snapshot; do not replace the removed field
with a zero, exclude another guest field, or make checkpoint state restore a
host invocation. Current host pacing/delivery metadata comparisons remain
separate from guest state.

Validation: the full Lua suite passes (1789 tests, one existing skip), all
31 native CTest targets pass, and `npm run test:runtime-replay` exercises both
Nemesis and the independent preloaded BT cart through the same runners.
Trusted-state replay, disk codec, checkpoint reuse, sparse seeks and history
branching compare complete CPU state without grant filters, including TS/C++
cross-core equality. The Nemesis case still explicitly requires active BADP
playback; the independent cart has no audio workload. Existing host transport
and actual libretro serialize/unserialize/playback coverage also pass.
Both the full Studio workflow and the preload/Hot Resume/Reboot/rewind case
pass on software, WebGL2 and WebGPU. Machine, toolchain and IDE typechecks,
core-parity, architecture boundaries, indentation and `git diff --check` pass;
the test-project typecheck retains its same 46 pre-existing diagnostics.
Browser Studio, Node headless tooling and native libretro products are rebuilt.

[mame-execution-state]: https://github.com/mamedev/mame/blob/mame0280/src/emu/diexec.cpp#L382-L401
[mame-execution-grant]: https://github.com/mamedev/mame/blob/mame0280/src/emu/schedule.cpp#L431-L477

## Paced review playback: REWIND-PLAYBACK-01

The original transport implements seeking and live takeover, not playback of
retained history. This slice adds that missing operation. With the current
interaction mapping, LB/RB step recorded video frames and Left/Right seek
seconds. START accepts the selected point; B cancels back to the retained present;
X toggles recorded playback/pause. Pointer input scrubs and accepts/cancels.
Controls exist only in the open host
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

## Host integration contract (REWIND-HOST-01)

Collection is continuous during ordinary gameplay, from boot, not enabled by
opening the rewind menu. Reboot, external load and tooling mutations establish
a new timeline. Scenario execution is an external test session, not ordinary
player history. The quick menu opens the transport bar described in
`REWIND-UI-01` below. Holding SELECT+START for 500 host milliseconds opens that
bar when history is available; a short release toggles the quick menu instead.
The physical keyboard's Right Ctrl + Right Alt uses the same short/hold contract.
Recognition belongs to per-source host input, not a menu-owned timer, nominal
frame counter, or guest time. A long release never produces a menu request.
START takes over the chosen position only on a fresh unmodified press; east
(canonical B) cancels to the retained present. Enter/Escape remain the keyboard
transport controls. All controllers, including SNES Mini, use the same contract.
The old SELECT+south host shortcut is removed. OSK remains SELECT+west (canonical
X); no ordinary keyboard X/Z alias is added.

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

## Backend readback lifetime (REWIND-GPU-LIFETIME-01)

Reference: [DuckStation GPU state commands](https://github.com/stenzek/duckstation/blob/master/src/core/gpu.cpp)
and [its video command queue](https://github.com/stenzek/duckstation/blob/master/src/core/video_thread.cpp).
Load and save are distinct commands, ordered with rendering; loading is not
implemented by first saving the state that will be abandoned. BMSX has no GPU
worker thread, but WebGPU GPUREAD completion callbacks reference machine-owned
buffers. Those callbacks, including a deferred second GPUREAD, must finish
before host mutations or checkpoint restore. The existing snapshot/replacement
serial then orders the restored texture upload after preceding GPU submissions.

## Host UI input owner (HOST-UI-INPUT-01)

Reference: [MAME ui_input_manager](https://github.com/mamedev/mame/blob/master/src/emu/uiinput.cpp)
keeps physical UI state and repeat deadlines outside individual menus. Its reset
state suppresses held controls until release; clearing a repeat map alone is
not a reset. [MAME menu transitions](https://github.com/mamedev/mame/blob/master/src/frontend/mame/ui/menu.cpp)
reset input on ownership changes. BMSX follows this distinction without copying
MAME's entire menu framework or involving the guest ICU.

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

## Studio execution loop (W01-W03)

Host pause is
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
