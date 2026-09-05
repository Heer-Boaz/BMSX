# Generic machine history and rewind

Status: deterministic save-state and the shared TS/C++ history core are
implemented. Collection is disabled by default; no host rewind control has
landed yet. Rewind is an emulator facility, not a Studio or cartlib service.

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
`resumeRecording()` truncates future events/checkpoints and requests a fresh
synchronized checkpoint before new live input. It clears the partial replay
target and grants so normal scheduling does not inherit abandoned work.

These operations require a suspended machine. Before any restore, the host
must also finish outstanding asynchronous backend operations against the old
state. Cancellation does not revoke a submitted GPU readback; the host must
finish it before a subsequent restore or branch capture.

Reboot, external full-runtime load and external `Runtime.callClosure` execution
end history at their runtime owners. The explicit restore-origin enum keeps
internal seeking distinct from external load without duplicating restore.
Media replacement, debugger mutation and Hot Resume still need the host-owner
integration below; direct machine mutation is not silently journalled.

### Remaining host and storage gate

No player, Studio or libretro menu starts collection yet. Before enabling it:

- Use the existing GPU backend's synchronous/asynchronous VRAM capture contract
  while holding execution; serialize capture, cancellation, load and media
  operations in the host that owns those asynchronous jobs.
- Present restored VRAM and reset derived presentation history; discard
  intermediate audio/debug delivery and clear abandoned transport backlog.
  APU clocks, DSP, DMA and GPU work still execute normally. Do not insert
  silence, prebuffer audio or compensate by advancing guest time.
- Stop history **before** media replacement, Hot Resume or debugger writes.
  A restored machine cannot use checkpoints from a different inserted image.
- Establish a measured retention/capture budget for the real host. The current
  CPU graph is now stored directly in retained word arenas, and the input
  journal is retained. Other device/string snapshots and capture scratch still
  allocate. A bounded count is not a fixed byte arena or a zero-GC capture
  path. Improve those storage owners rather than masking pauses with skipped
  guest work, per-frame snapshots or UI-only rewind state.
- Implement the host/quickmenu control surface and prove responsiveness and
  output recovery in actual TS and libretro hosts. No shortcut is assigned.

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
