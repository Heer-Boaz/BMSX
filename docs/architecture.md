# BMSX Architecture Contract

Last checked: 2026-05-15.

This document is the current machine/host boundary contract. It is not a work
log, a prompt, or a migration diary. If implementation changes land, this file
must be updated in the same slice.

## Hard boundary

BMSX carts observe a machine, not the host application:

```text
cart Lua / BIOS helper -> CPU-visible RAM or MMIO -> machine device -> host output edge
```

Forbidden cart-visible shapes:

- cart or BIOS calls into `engine.*`, renderer, audio backend, IDE, platform, or
  workspace objects;
- runtime shortcuts that mutate device-visible state without RAM/MMIO;
- host registries that duplicate cart-visible ROM, resource, input, video,
  audio, or geometry state;
- old-format fallbacks, defensive state repair, or stale decode branches for
  BMSX-owned formats.

Host code may load files, build ROMs, display frames, play samples, edit source,
and inject input events. It must not be the owner of cart-observable semantics.

## Mirrored core contract

The TypeScript core under `src/bmsx/machine` and the native core under
`src/bmsx_cpp/machine` are mirrored implementations of the same machine.

Rules:

- Core files use the same relative path and basename unless
  `scripts/core_parity_manifest.json` has a narrow explicit exclusion.
- Public constants, register words, opcodes, state records, device methods, and
  save-state fields match by role and representation.
- Runtime representation is not changed to make one language easier. If a value
  is a word, address, opcode, register, fixed-point word, slot, surface id,
  packet field, or render command, it remains that representation.
- `npm run audit:core-parity` is the standing parity audit. Passing it does not
  prove semantic parity; it only proves the mirrored surface is still accounted
  for.

## ROM and program image

ROM data is CPU-visible source material.

Owners:

- ROM package wire layout: `src/bmsx/rompack/format.ts` and
  `src/bmsx_cpp/rompack/format.h/.cpp`.
- ROM TOC wire layout: `src/bmsx/rompack/toc.ts` and
  `src/bmsx_cpp/rompack/toc.h/.cpp`.
- Layered ROM lookup: `src/bmsx/rompack/source.ts` and
  `src/bmsx_cpp/rompack/source.h/.cpp`.
- Program image layout/loading/linking:
  `src/bmsx/machine/program/*` and `src/bmsx_cpp/machine/program/*`.

The ROM package and program image use the current wire records only. There is no
old-format reader and no decode path for obsolete records.

Compiled Lua/YAML is source/program material, not mutable machine state.
`__program__` is a linked object image. `__program_symbols__` is debug metadata
and never counts as RAM.

## Memory, CPU, and scheduler

- `Memory` owns RAM, ROM windows, IO slots, and MMIO callback dispatch.
- The CPU consumes instruction words and runtime values directly from the mapped
  machine representation.
- The frame scheduler owns CPU/device advancement and IRQ/VBlank timing. The
  host frame pump may request work; it does not own device state transitions.
- VBlank is a machine edge. Devices with VBlank behavior expose explicit edge
  methods and latch/commit their own state there.

## Save-state contract

Save-state captures deterministic machine state, not host conveniences.

Saved:

- CPU registers, stack/frame/root runtime values, string pool ownership, RAM/IO
  state, scheduler/VBlank state, device registerfiles/latches/FIFOs/buffers, and
  device-visible memory.
- VDP registerfile, DEX build/submitted-frame state, named stream-ingress
  latches/FIFO words, readback budget/overflow latches, surfaces,
  display/readback pixels, and PMU/SBX/BBU/VOUT state that determines future
  output.
- APU command/source/output state that determines future audio output,
  including the command FIFO ring, queued parameter latch words, active AOUT
  voice position, gain-ramp, filter history, and BADP decoder state.
- GEO command/result/fault state and device-visible scratch/result memory.
- ICU registerfile, sample latch, committed action records, and sampled action
  status/value words.

Not saved:

- host windows, WebGL/SDL handles, browser objects, editor state, build caches,
  parser caches, derived lookup tables, scratch arrays that are fully rebuilt
  from saved device state, and output queues that belong only to a host backend.

Save-state bytes start with the current property-table payload. There is no
format-version field, old reader, or migration path. Aggregate machine
save-state records live in
`machine/save_state` on both runtimes. IRQ and ICU save-state contracts live in
dedicated `machine/devices/irq/save_state` and
`machine/devices/input/save_state` files on both runtimes; C++ keeps those
capture/restore bodies in the matching save-state translation units.

## Device contracts

### IRQ

IRQ is a machine device with flag/status words. Devices raise/clear IRQ state
through the IRQ owner. Cart-originated faults surface as status/fault bits and
IRQ flags when the device contract says so; they do not escape as host
exceptions. IRQ save-state is the pending flag register word only, owned by
`machine/devices/irq/save_state`.

### DMA and image decode

DMA and IMGDEC are MMIO devices. Command words latch work, device status/fault
registers expose completion or rejection, and bus faults become device-visible
fault state.

### VDP

VDP is a video device, not a render API. Its detailed register, timing,
fault, subunit-state, host-output, and save-state contract is
`docs/video_display_processor.md`.

Cart-visible ingress:

- raw VDP register writes;
- doorbell/status/fault words;
- packet/FIFO/stream words;
- VRAM/surface memory owned by the VDP;
- BIOS helpers that emit those same words.

Internal units:

- `registers` owns the raw VDP transform, draw, surface, mode, dither, and
  control words; shared `machine/devices/device_status` owns VDP
  status/fault/code/detail register images and the fault-ack write edge.
- `DEX` owns direct/stream frame state, submit admission, and the retained
  fixed-capacity framebuffer-command buffer used by the scheduler blitter.
- `streamIngress` owns the DMA submit latch, FIFO partial-word bytes, and sealed
  FIFO packet words.
- `VRAM` owns staging memory, surface slots, dirty spans, CPU readback pixels,
  and surface-upload transactions.
- `readback` owns the CPU-visible read-surface registry, retained read cache,
  per-frame read budget, and overflow latch.
- `PMU` owns bank registers, selected bank, and BLIT resolve state.
- `SBX` owns skybox register-window staging, packet staging, frame seal,
  VRAM-backed face-source resolution, and sampled face words.
- `BBU` owns billboard packet decode, VRAM-backed source admission, retained
  fixed-capacity billboard frame buffers, and instance emission limits.
- `LPU` owns raw ambient, directional, and point-light register words.
- `MFU` owns raw morph-weight register words.
- `JTU` owns raw joint-matrix register words.
- `unit_register_port` owns stream `REG1/REGN` range admission and raw
  XF/LPU/MFU/JTU register writes.
- `MDU` owns mesh-packet decode, mesh-source admission, and per-frame mesh draw
  emission limits.
- `FBM` owns framebuffer pages, display pixels, and presentable display
  dimensions.
- `XF` owns transform register words.
- `VOUT` owns live, frame-sealed, and visible host-output buffers, including
  mesh draw records plus sampled LPU/MFU/JTU words, scanout phase, beam
  position, and retained `VdpDeviceOutput`.

Host render backends consume VOUT output transactions. They do not receive cart
intent such as sprites, rectangles, labels, or scene objects. VDP save-state
record shapes live in dedicated `machine/devices/vdp/save_state` files on both
runtimes; the stream-ingress, VRAM/surface-memory, and readback latch/buffer
owners live in mirrored `machine/devices/vdp/ingress`, `machine/devices/vdp/vram`,
and `machine/devices/vdp/readback` files. C++ keeps aggregate VDP capture/restore
method bodies in the VDP save-state translation unit; TS aggregate capture/restore
stays on the device boundary and imports only the save-state record shapes while
subunit state is owned by the subunit files.

Mesh rendering follows the same hardware boundary. Cart streams submit model
asset tokens and raw VDP register words to the MDU/MFU/JTU/LPU; VOUT exposes the
mesh and lighting records at the host-output edge. Frame lighting is device
state: cart streams write raw LPU register words for ambient, directional, and
point lights; VOUT carries those words with the frame; render snapshots decode
them at the host-output boundary. The native GLES2 renderer resolves the
rompacked model from those VOUT records and samples textures only from VDP VRAM
slots. GLTF material image texture references are ROM metadata, not GPU texture
ownership; MDU texture sampling is controlled by the raw VDP texture-slot word.
DEX blitter commands, BBU billboard records, and MDU mesh records are retained
fixed-capacity frame buffers on both runtimes, with per-field raw arrays and a
length latch rather than per-packet objects or nested run vectors. VDP frame
seal, submitted-frame promotion, and VOUT presentation transfer those buffers by
ownership rather than copying command, billboard, or mesh records.
The native GLES2 and browser WebGL2 mesh shaders consume the resolved material
surface bits (opaque/mask/blend, double-sided, unlit, base color, emissive,
roughness, and metallic factors) together with the LPU-derived frame lighting
state. TS headless and native software backends also rasterize VOUT mesh records
for capture/proof through the same rompacked model source and sampled
MFU/JTU/LPU state rather than a private test hook. The native GLES2 path must
stay compatible with low-end GLES2 targets by expanding mesh, morph, and skinning
data on the CPU into a retained dynamic vertex stream instead of relying on UBOs,
instancing, vertex texture fetch, or other GLES3/WebGL2-only features; the
browser WebGL2 path follows the same MDU output contract while using WebGL2
shader syntax.

### APU and AOUT

APU is an audio device, not a sound service.

Cart-visible ingress:

- APU register writes;
- command FIFO words;
- parameter registers;
- source/sample memory;
- status/fault/IRQ words.

Internal units:

- APU registerfile/status/fault latch;
- command doorbell ingress, command FIFO, and parameter latch bank;
- service clock: CPU-cycle sample accrual, carry latch, pending-sample latch, and APU scheduler edge;
- active-slot datapath: active-mask register image, slot phase transitions, source-byte teardown, selected-slot refresh, and slot-ended event emission;
- slot bank: slot phases, per-slot register words, playback cursors, fade counters, and voice ids;
- source bytes DMA bank and metadata validator;
- playback parameter decoder;
- mixer/filter datapath and retained mix buffer;
- AOUT active voice records;
- PCM source data validator;
- BADP block decoder and seek-table datapath;
- AOUT fixed-capacity output ring, retained render buffer, and host-audio pull
  edge.

Save-state captures active AOUT voice datapath state. It does not capture the
already-rendered AOUT output ring; queued frames at the host edge are not
machine state and are rebuilt from the restored voice datapath. The audio
save-state data contract lives in dedicated `machine/devices/audio/save_state`
files on both runtimes. The shared device-status latch owns fault/status/code/detail register images and
fault-ack writes through mirrored `machine/devices/device_status` files. The
command latch default register image is owned by
mirrored `machine/devices/audio/command_latch` files. The command-doorbell
ingress path is owned by mirrored `machine/devices/audio/command_ingress` files;
it admits command words into the FIFO, clears the command latch, raises command
faults, and wakes the service clock. Command FIFO drain, PLAY/STOP/GAIN command
execution, the selected-slot register window, source-DMA replacement, and AOUT
voice replay are owned by mirrored `machine/devices/audio/command_executor`
files. The APU event latch
(sequence, kind, slot, source address, and IRQ edge) is owned by mirrored
`machine/devices/audio/event_latch` files. The command FIFO ring,
read/write pointers, queued count, and per-entry parameter words are owned by
mirrored `machine/devices/audio/command_fifo` files and are saved through that
owner. Queue-depth status registers for command FIFO and AOUT output ring state
are owned by mirrored `machine/devices/audio/queue_status_registers` files. The APU service clock owns CPU-cycle sample accrual, carry and
pending-sample latches, and the scheduler service edge in mirrored
`machine/devices/audio/service_clock` files; aggregate save-state stores only
those latch words.
The selected-slot source/status latch is owned by mirrored
`machine/devices/audio/selected_slot_latch` files. The active-slot datapath is
owned by mirrored `machine/devices/audio/active_slots` files; it writes the
CPU-visible active-mask register image, clears source-DMA slot bytes when a slot
stops, refreshes the selected-slot latch, and emits slot-ended events from the
advance edge. The composite APU status register read datapath is owned by
mirrored `machine/devices/audio/status_register` files. The APU slot bank owns
slot phase/register/cursor/fade/voice-id words in mirrored
`machine/devices/audio/slot_bank` files; aggregate save-state records
read and restore those live words through that owner.
The AOUT playback/filter parameter decoder is owned by mirrored `machine/devices/audio/playback` files. The APU source register decoder, source DMA latch, and source metadata validator are owned by mirrored `machine/devices/audio/source` files. The PCM source data validator is owned by mirrored `machine/devices/audio/pcm_decoder` files; scalar PCM sample decode lives in mirrored `pcm_decoder_hot_path` files so AOUT keeps the same retained-buffer hot path without owning sample-format decoding. The BADP decoder and seek-table datapath are owned by mirrored
`machine/devices/audio/badp_decoder` files; active decoder latches stay in the
voice record and are captured through the audio save-state contract. C++ keeps
its per-sample BADP decode loop in a C++-only `badp_decoder_hot_path` internal
header included only by `output.cpp`, so the hot path remains same-TU inline
without exposing those helpers through the public audio headers; TS mirrors that
split in `badp_decoder_hot_path.ts`. The host-edge AOUT output ring
is owned by mirrored
`machine/devices/audio/output_ring` files; the mixer fills that ring from live
voice state, and save-state deliberately excludes the already-rendered ring
frames.
C++ keeps aggregate capture/restore method bodies in the audio save-state
translation unit. TS keeps aggregate controller methods at the private-field
device boundary while command-FIFO state transfer stays on the FIFO hardware
owner, including the FIFO save-state record shape. BADP fixture proof covers
saved decoder latches and selected-slot start-sample mutation while a
decoder-backed voice is active.

Hot paths must use retained buffers and fixed-size state. No per-sample,
per-render, or per-pull allocation is acceptable.

### GEO

GEO is a geometry/collision accelerator.

Cart-visible ingress:

- command and parameter registers;
- source/result RAM addresses;
- device scratch/result memory;
- scheduler service and IRQ/status/fault words.

The `overlap2d_pass` command reads packed shape/instance/candidate records,
executes through the GEO controller, writes packed result records, and exposes
faults through GEO status/fault registers. Geometry math helpers are allowed only
under the GEO device boundary; cart-visible proof must use RAM/MMIO/status, not a
private direct helper call.

GEO active-job latch records live in `machine/devices/geometry/job` on both
runtimes. GEO save-state record shapes live in
`machine/devices/geometry/save_state`; C++ keeps the aggregate GEO
capture/restore bodies in the matching save-state translation unit.

### ICU

ICU is the Input Controller Unit.

Cart-visible ingress:

- `sys_inp_player`, `sys_inp_action`, `sys_inp_bind`, `sys_inp_ctrl`,
  `sys_inp_query`, and `sys_inp_consume` writes;
- `sys_inp_status` and `sys_inp_value` reads;
- `sys_inp_event_*` FIFO status/front-entry reads and event control writes;
- `sys_inp_output_intensity_q16`, `sys_inp_output_duration_ms`,
  `sys_inp_output_status`, and `sys_inp_output_ctrl` output registers;
- `inp_ctrl_commit`, `inp_ctrl_arm`, `inp_ctrl_reset`,
  `inp_event_ctrl_pop`, `inp_event_ctrl_clear`, and
  `inp_output_ctrl_apply` command words.

State owned by ICU:

- selected player/action/bind/query/consume register words,
  `sys_inp_status`/`sys_inp_value` result words, and reset/restore register
  mirroring owned by `machine/devices/input/registers`;
- `sys_inp_ctrl` command latch side effects owned by
  `machine/devices/input/control_port`;
- private sample arm, sequence, and last-cycle latches owned by
  `machine/devices/input/sample_latch`;
- per-player committed action records and mapping contexts owned by
  `machine/devices/input/action_table`;
- per-action sampled `statusWord`, signed-Q16.16 `valueQ16`, `pressTime`, and
  `repeatCount` words owned by the action table;
- `sys_inp_query`/`sys_inp_consume` write side effects and query-result
  datapath owned by `machine/devices/input/query_port`;
- event FIFO hardware state: retained event slots, read/write pointers, queued
  count, overflow latch, and pop/clear control doorbells;
- output intensity and duration latch words; the output command datapath is
  owned by `machine/devices/input/output_port`.

The runtime VBlank owner enters through the ICU controller edge. The sample
latch subunit remains private and only consumes the arm latch into sample
sequence/last-cycle state. The controller edge then asks the input owner to
sample players once and snapshots committed actions. Later MMIO queries enter
the query port and evaluate against that ICU snapshot. A root action query
returns the sampled action status/value words; a compound expression returns
boolean `1`/`0` in `sys_inp_status` and zero in `sys_inp_value`.

`sys_inp_ctrl` writes enter the control port. The control port latches the raw
command word through the registerfile, then commits selected action/bind words,
arms the VBlank sample latch, or resets the selected player's committed action
records and result words.

The event FIFO is filled at the same sample edge. It queues action edge/repeat
snapshots and exposes a front-entry register bank plus pop/clear doorbells.
`machine/devices/input/event_fifo` owns the retained ring slots, pointers, count,
and overflow latch on both runtimes. The queue is saved as visible device state;
it is not a host queue.

`machine/devices/input/save_state` is only the aggregate persistence boundary.
Live ICU register, action-table, and FIFO record shapes stay in their hardware
owner files rather than in a parallel save-state contract.

The output register bank is a selected-player output datapath. Carts write an
unsigned-Q16.16 intensity word and a duration word, then ring the output
doorbell. The ICU decodes those latch words at the output datapath boundary and
passes one output command to the selected player's input hardware. Status reads
expose host output support for the selected player; that support bit is runtime
capability, not save-state payload.

ICU string ingress is a raw interned-string-id MMIO contract. The register
metadata marks action, bind, query, and consume writes as interned string ids;
normal Lua strings are rejected before program image emission. The ICU consumes
interned string-id words directly. Dynamic producers use the existing `&`
operator at the producer boundary, for example `&(action .. '[p]')`, so the
device still sees raw string-id words rather than a high-level input API.

## Firmware and Lua layer

BIOS and cart libraries may hide register programming behind helpers, but those
helpers must write/read the same RAM/MMIO words the cart could use directly.
Gameplay/cart files own intent values only. They must not define VDP/APU/GEO/ICU
ABI encoders, fixed-point helpers, register maps, packet layouts, or hardware
fallbacks locally.

Lua heap counts as RAM. Public accounting should talk about RAM, not a separate
heap budget outside the machine.

## IDE, editor, and host tooling

IDE/editor/workspace code is host tooling. It may compile source, inspect debug
symbols, display terminals, and patch ROM/workspace inputs at host edges. It must
not be imported by machine devices or become the cart-visible source of truth.

Terminal commands return explicit owner actions; workbench/editor owners apply
those actions. Runtime faults must surface through the runtime/terminal error
channel instead of being swallowed by deferred host code.

## Validation policy

A machine-boundary slice is not done without proof appropriate to the touched
surface:

- TS build/typecheck for touched TS core;
- native build/tests for touched C++ core;
- focused unit/integration tests that exercise RAM/MMIO/device state rather than
  only private helper calls;
- scoped code-quality scanner with zero issues for touched files;
- `npm run audit:core-parity` for mirrored runtime changes;
- `git diff --check`;
- headless run when cart-visible runtime behavior is touched.

Subagent review is useful at the slice boundary, not for every tiny edit. Review
findings are blockers only when they identify ownership drift, stale docs,
performance regression, fake parity, hidden old-format paths, defensive clutter, or
hardware-contract violations.

## Documentation policy

Hardware documents must read like hardware contracts:

- register map and bit meanings;
- latches, buffers, FIFOs, registerfiles, datapaths;
- timing edges and service points;
- fault/status/IRQ behavior;
- save-state-visible state;
- TS/C++ owner files.

They must not be prompts, migration journals, marketing copy, or product-pitch
explanations. If a document cannot be made into a current hardware contract, it
should be deleted.

The active work-order checklist lives in `docs/goal.md`; this architecture file
remains the stable machine contract.
