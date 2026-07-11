# Video Display Processor (residual)

This is the remaining CPU-visible contract for the Video Display Processor
(VDP) while its residual ownership is migrated. GX GPU/GTE is the active cart
graphics ABI. The cart-visible VDP/RPU firmware ABI and every host RPU execution
pass have been removed; no host renderer consumes `VdpDeviceOutput`.

The VDP still owns raw register words, FIFO/stream ingress, mapped
staging/texture/framebuffer memory, status/fault latches, scheduler/VBlank state,
readback, dither, and save-state records. No host presentation route consumes
its framebuffer or VOUT state; IDE/terminal presentation is owned by the host
overlay.

## Register map

| Register/window | Direction | Value | Unit | Effect |
|---|---:|---|---|---|
| `IO_VDP_STATUS` | R | status bits | VDP | VBlank, submit-busy/rejected, and fault state. |
| `IO_VDP_FAULT_CODE` | R | u32 | VDP | Sticky-first fault code. |
| `IO_VDP_FAULT_DETAIL` | R | u32 | VDP | Fault-specific detail word. |
| `IO_VDP_FAULT_ACK` | W | u32 | VDP | Clears the sticky fault latch and self-clears. |
| `IO_VDP_DITHER` | W | u32 | VOUT | Dither latch for the next sealed frame. |
| `IO_VDP_RD_SURFACE` | W | u32 | FBM/readback | Selects a readback surface. |
| `IO_VDP_RD_X` | W | u32 | FBM/readback | Selects readback X. |
| `IO_VDP_RD_Y` | W | u32 | FBM/readback | Selects readback Y. |
| `IO_VDP_RD_MODE` | W | u32 | FBM/readback | Selects readback format. |
| `IO_VDP_RD_STATUS` | R | status bits | FBM/readback | Ready/overflow for readback data. |
| `IO_VDP_RD_DATA` | R | u32 | FBM/readback | Packed readback data. |
| `IO_VDP_CMD` | W | command word | RPU submit doorbell | Direct frame-submit doorbell. |
| `IO_VDP_CMD_ARG0` / `IO_VDP_REG0..IO_VDP_REG_SLOT_DIM` | W/R | raw u32 words | VDP registerfile | Raw argument latches retained for the retired direct-command path. |
| `IO_VDP_FIFO` | W | packet word | VDP stream | Appends one word to the FIFO ingress buffer. |
| `IO_VDP_FIFO_CTRL` | W | control bits | VDP stream | `VDP_FIFO_CTRL_SEAL` seals and replays the FIFO packet stream. |

The old cart-visible SBX MMIO window is retired and intentionally left as an
unassigned hole so IRQ/DMA and later public MMIO addresses do not move during
the RPU migration.

The VDP exposes three CPU-visible memory ranges: RPU staging/scratch, texture
VRAM, and framebuffer VRAM. Texture residency is plain VRAM contents: the ROM
build may materialise initial atlas bytes and coordinates, but the VDP has no
primary/secondary/system atlas slots and no runtime atlas-binding MMIO. The
DMA/FIFO stream buffer starts at `VDP_STREAM_BUFFER_BASE`; sealed streams are
decoded as VDP packet words, not as host renderer commands.

## Status bits

| Bit/constant | Meaning |
|---|---|
| `VDP_STATUS_VBLANK` | The frame scheduler reports the machine VBlank edge/interval. |
| `VDP_STATUS_SUBMIT_BUSY` | VDP cannot accept a new submission because FIFO/DMA/build/submitted work occupies the path. |
| `VDP_STATUS_SUBMIT_REJECTED` | The last submission attempt was rejected. |
| `VDP_STATUS_FAULT` | The sticky fault latch contains a non-zero code. |
| `VDP_RD_STATUS_READY` | Readback data is available. |
| `VDP_RD_STATUS_OVERFLOW` | Readback requested more data than the readback budget/window can provide. |

## Residual RPU stream state

No active cart or BIOS graphics producer targets this stream. The mapped
FIFO/DMA ingress and RPU packet decoder remain machine state until their memory,
timing, and save-state owners are migrated. Accepted words still flow through
the existing device datapath deterministically, but no retained RPU frame is
executed by presentation.

## Commands and packets

Direct `IO_VDP_CMD` accepts:

| Command | Effect |
|---|---|
| `VDP_CMD_NOP` | No operation. |
| `VDP_CMD_BEGIN_FRAME` | Opens a direct VDP build frame. |
| `VDP_CMD_END_FRAME` | Seals the direct build frame into active/pending submitted-frame state. |
| `VDP_CMD_CLEAR` / `VDP_CMD_FILL_RECT` / `VDP_CMD_DRAW_LINE` / `VDP_CMD_BLIT` | Retired for cart and BIOS rendering; active graphics use GX. |

FIFO/DMA stream packets use `VDP_PKT_*` headers:

Header word-count fields count payload words only; the header word itself is
not part of the count. For RPU packets, payload word 0 is the RPU operation.
ABI harness structs may model a full packet record as header plus payload, but
the public word-count constants remain payload counts.

| Packet | Effect |
|---|---|
| `VDP_PKT_END` | Terminates a sealed stream. It must be the final word. |
| `VDP_PKT_CMD` | Replays a VDP command. BEGIN/END are illegal inside streams. |
| `VDP_PKT_REG1` | Writes one raw VDP register word. |
| `VDP_PKT_REGN` | Writes a contiguous run of raw VDP register words. |
| `VDP_XF_PACKET_KIND` | Writes XF matrix/select registers. |
| `VDP_LPU_PACKET_KIND` | Writes raw LPU ambient, directional, and point-light registers. |
| `VDP_MFU_PACKET_KIND` | Writes raw MFU morph-weight registers. |
| `VDP_JTU_PACKET_KIND` | Writes raw JTU joint-matrix registers. |
| `VDP_RPU_PACKET_KIND` | Writes raw RPU buffers, surfaces, constants, passes, draws, and bindings. |
| Retired/unknown packet kinds | Consume the header as a deterministic no-op. |

`VDP_LPU_PACKET_KIND`, `VDP_MFU_PACKET_KIND`, and `VDP_JTU_PACKET_KIND` use the
same register-window shape as XF packets: the first payload word is the first
register index and the remaining words are stored contiguously. LPU, MFU, and
JTU store raw words. RPU `CONSTANT_UPLOAD_DEVICE` can copy those words into RPU
constant banks; `LPU_RAW` copies unchanged, while MFU/JTU Q16.16 words decode
to fixed shader constants at the RPU boundary.

LPU register windows:

| Window | Base | Words per record | Records | Word layout |
|---|---:|---:|---:|---|
| ambient | 0 | 5 | 1 | control, color R, color G, color B, intensity |
| directional | 5 | 8 | 4 | control, dir X, dir Y, dir Z, color R, color G, color B, intensity |
| point | 37 | 9 | 4 | control, pos X, pos Y, pos Z, range, color R, color G, color B, intensity |

Control bit 0 enables the light record. Color, intensity, direction, position,
and range words are stored raw; the residual RPU datapath decodes the fixed
representation only at its consuming boundary.

Residual RPU packets define raw buffers, surfaces, constants, passes, draws, and
fixed shader bindings. The VDP does not assign higher-level scene meaning to
those words. Retired BBU/MDU/SBX packet headers have no payload contract and
therefore consume only their header word.

Malformed stream headers, missing payload words, illegal BEGIN/END stream
commands, and bad unit-packet ranges fault with `VDP_FAULT_STREAM_BAD_PACKET`
and abort the sealed stream frame. REG1/REGN register addresses wrap through
the VDP registerfile, command high bits stay part of the command word, and
unknown packet kinds consume the header as a deterministic no-op.

## Subunit states

| Unit | States | Owner files |
|---|---|---|
| Stream ingress/build | `Idle`, `DirectOpen`, `StreamOpen` | `frame.ts/.h`, `vdp.ts/.cpp` |
| Submitted RPU frame | `Empty`, `Queued`, `Ready` | `frame.ts/.h`, `rpu.ts/.h/.cpp`, `vout.ts/.h/.cpp` |
| LPU | light registerfile | `lpu.ts/.h/.cpp` |
| MFU | morph-weight registerfile | `mfu.ts/.h/.cpp` |
| JTU | joint-matrix registerfile | `jtu.ts/.h/.cpp` |
| FBM | `PageWritable`, `PagePendingPresent`, `PagePresented` | `fbm.ts/.h/.cpp` |
| Readback | `Ready`, `BudgetExhausted`, `OverflowLatched` | `readback.ts/.h/.cpp` |
| VOUT | `Idle`, `RegisterLatched`, `FrameSealed`, `FramePresented` | `vout.ts/.h/.cpp` |
| XF | matrix registerfile and selected matrix indexes | `xf.ts/.h/.cpp` |
| RPU | retained render command buffer and raw resources | `rpu.ts/.h/.cpp` |

## Timing

| Unit/path | Work timing | CPU-visible polling/edge |
|---|---|---|
| Direct command | Legacy BEGIN/END/doorbell writes execute admission immediately; active cart and BIOS graphics use GX instead. | `VDP_STATUS_SUBMIT_BUSY`, `VDP_STATUS_SUBMIT_REJECTED`, and fault registers. |
| FIFO stream | `IO_VDP_FIFO` collects words through the stream-ingress unit. `VDP_FIFO_CTRL_SEAL` decodes/replays the sealed stream immediately into submitted-frame state. | Stream-ingress partial words and submitted frames keep submit busy set. |
| DMA stream | DMA owner opens the stream-ingress DMA submit latch, copies bytes into VDP stream memory, then seals. The VDP decodes the stream on seal. | Submit busy remains set while DMA submit is active. |
| XF/LPU/MFU/JTU register port | Stream unit packets write raw live register words during sealed stream replay. RPU `CONSTANT_UPLOAD_DEVICE` copies those register words into RPU constant banks. | Bad register ranges fault and abort the sealed stream frame. |
| RPU | Packet admission retains raw buffers, surfaces, constants, passes, draws, and bindings as residual device/save-state state. No presentation backend executes it. | Malformed packets and structural resource ranges fault; representable weird state remains deterministic. |
| FBM | Framebuffer page transitions happen on VBlank for residual display/readback state. | Display/readback page latches. |
| Readback | `IO_VDP_RD_*` reads resolve the framebuffer surface, serve retained cache chunks, advance X/Y, and consume per-frame budget. | Readback status/data and VDP fault registers. |
| VOUT | Dither/dimension/output latches are sampled at frame seal and retained as residual device/save-state state. | No host presentation consumer remains; cart sees MMIO/status only. |

The boundary follows the same device-shape discipline used by mature emulator
codebases: address-space ingress, device timing/service, VBlank/screen edges,
and host output consumption stay separate.

## Fault policy

VDP faults are sticky-first until `IO_VDP_FAULT_ACK` is written. Faulting
cart-originated operations set status/fault words; they do not throw through the
host. Representable but weird register words stay stored unless the consuming
datapath rejects them.

| Source | Fault code | Effect |
|---|---|---|
| Readback unsupported mode | `VDP_FAULT_RD_UNSUPPORTED_MODE` | Latch fault; readback result is not advanced for the bad request. |
| Readback bad surface | `VDP_FAULT_RD_SURFACE` | Latch fault; readback returns no new surface data. |
| Readback out of bounds/budget | `VDP_FAULT_RD_OOB` | Latch fault; overflow status may be set. |
| VRAM write to unmapped or uninitialised VDP memory | `VDP_FAULT_VRAM_WRITE_UNMAPPED`, `VDP_FAULT_VRAM_WRITE_UNINITIALIZED` | Latch fault; no memory mutation for that write. |
| VRAM write out of range/unaligned | `VDP_FAULT_VRAM_WRITE_OOB`, `VDP_FAULT_VRAM_WRITE_UNALIGNED` | Latch fault; write is rejected. |
| Framebuffer surface dimension overflow | `VDP_FAULT_VRAM_SURFACE_DIM` | Latch fault; existing framebuffer dimensions remain. |
| Stream malformed packet | `VDP_FAULT_STREAM_BAD_PACKET` | Abort sealed stream frame and clear stream ingress. |
| Direct bad submit state | `VDP_FAULT_SUBMIT_STATE` | Reject/drop command and keep or cancel the direct frame according to the command path. |
| Unknown draw doorbell | `VDP_FAULT_CMD_BAD_DOORBELL` | Latch fault; drop the doorbell. |
| Submit queue busy | `VDP_FAULT_SUBMIT_BUSY` | Reject the attempt; no visible frame mutation. |
| Retired DEX command payload | `VDP_FAULT_DEX_INVALID_SCALE`, `VDP_FAULT_DEX_INVALID_LINE_WIDTH`, `VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL`, `VDP_FAULT_DEX_SOURCE_SLOT`, `VDP_FAULT_DEX_SOURCE_OOB`, `VDP_FAULT_DEX_OVERFLOW` | Faults retained for stale direct-command payloads; active cart and BIOS graphics use GX. |

## Host output and save state

VOUT still owns live, frame-sealed, and visible device-output buffers, but no
host presentation path reads `VdpDeviceOutput`. Output quantization is now a
host `GameView` option rather than a VDP dither snapshot. GX command buffers and
GX VRAM scanout are the graphics path for accelerated and software/headless
backends.

Saved VDP state includes:

- raw VDP registerfile words;
- build-frame state, active/pending submitted-frame state, `streamIngress` DMA
  submit latch, FIFO partial-word bytes, sealed FIFO stream words, and retained
  RPU resources/commands;
- VDP status/fault words;
- readback budget/overflow latches;
- LPU live light register words;
- XF matrix words and selected indexes;
- VOUT/dither/display dimensions that affect future output;
- VRAM unit state: RPU-local bytes and framebuffer surface pixels;
- framebuffer display/readback pixels.

Host GPU textures, WebGL/SDL resources, texture handles, renderer queues, and
host-side scratch are rebuilt from saved device-visible state. RPU retained frame
refs point at RPU-owned buffers, surfaces, and constant banks; save/restore
serialises device-owned resource contents and rebinds retained refs after
restore.

## Owners

- TS VDP device: `machine/ts/machine/devices/vdp/vdp.ts`
- TS VDP save-state, stream ingress, VRAM/surface memory, and readback:
  `save_state.ts`, `ingress.ts`, `vram.ts`, and `readback.ts`
- TS VDP constants/registers: `machine/ts/machine/devices/vdp/contracts.ts` and
  `registers.ts`
- TS subunits: `fbm.ts`, `frame.ts`, `jtu.ts`, `lpu.ts`, `mfu.ts`,
  `rpu.ts`, `vout.ts`, and `xf.ts`
- C++ VDP device: `machine/cpp/machine/devices/vdp/vdp.cpp/.h`
- C++ VDP save-state, stream ingress, VRAM/surface memory, and readback:
  `save_state.cpp/.h`, `ingress.cpp/.h`, `vram.cpp/.h`, and `readback.cpp/.h`
- C++ VDP constants/registers: `machine/cpp/machine/devices/vdp/contracts.h`
  and `registers.h`
- C++ subunits: `fbm.cpp/.h`, `frame.cpp/.h`, `jtu.cpp/.h`, `lpu.cpp/.h`,
  `mfu.cpp/.h`, `rpu.cpp/.h`, `vout.cpp/.h`, and `xf.cpp/.h`
- Mapped framebuffer pixels remain residual CPU/DMA/device read/write,
  readback, and save-state memory; they have no host presentation consumer
- Runtime save-state codecs: `machine/ts/machine/runtime/save_state/*` and
  `machine/cpp/machine/runtime/save_state/*`
