# Generic machine history and rewind

Status: architecture and save-state prerequisites; no host rewind control has
landed yet. Rewind is an emulator facility shared by TypeScript hosts and the
native/libretro host, not a Studio or cartlib service.

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
match at creation. Snapshot graph traversal also matches: metatable, array,
then hash storage; frame closure before its registers. Cross-core comparison
does not remap object ids, reorder saved tables, or translate string ids.

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
implementation of the external-event journal or a browser rewind UI test.

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

Encoded file size is not retained JS/native heap usage. The snapshot currently
allocates its object graph. These measurements do not justify per-frame full
snapshots or a synchronous TS seek loop on the UI thread; bounded retained
storage and interruptible replay remain gates for the next slices.

Additional checks: machine/toolchain/IDE/host TypeScript builds, the Lua test
suite (835 passed, one skipped), native CTest (26/26), the actual libretro
product build, core-parity and architecture-boundary audits, indentation and
`git diff --check`. Native tests include actual `retro_run`, `retro_serialize`
and `retro_unserialize` entrypoint coverage. No host rewind menu, input journal,
Hot Resume history integration or smooth rewind claim is included in this slice.
