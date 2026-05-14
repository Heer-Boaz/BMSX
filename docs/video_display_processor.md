# Video Display Processor

This is the CPU-visible contract for the Video Display Processor (VDP). The VDP
is a machine device with raw register words, command doorbells, FIFO/stream
packet ingress, VRAM/surface memory, subunit state machines, status/fault
latches, scheduler-visible render work, and a VOUT host-output transaction edge.

Host renderers consume VOUT transactions. They do not receive cart intent such
as sprites, rectangles, labels, glyph runs, tile runs, or scene objects.

## Register map

| Register/window | Direction | Value | Unit | Effect |
|---|---:|---|---|---|
| `IO_VDP_STATUS` | R | status bits | VDP | VBlank, submit-busy/rejected, and fault state. |
| `IO_VDP_FAULT_CODE` | R | u32 | VDP | Sticky-first fault code. |
| `IO_VDP_FAULT_DETAIL` | R | u32 | VDP | Fault-specific detail word. |
| `IO_VDP_FAULT_ACK` | W | u32 | VDP | Clears the sticky fault latch and self-clears. |
| `IO_VDP_DITHER` | W | u32 | VOUT | Dither latch for the next sealed frame. |
| `IO_VDP_SLOT_PRIMARY_ATLAS` | W/R | slot id | DEX source binding | Selects the primary atlas slot used by cart/BIOS draw setup. |
| `IO_VDP_SLOT_SECONDARY_ATLAS` | W/R | slot id | DEX source binding | Selects the secondary atlas slot used by cart/BIOS draw setup. |
| `IO_VDP_RD_SURFACE` | W | u32 | FBM/readback | Selects a readback surface. |
| `IO_VDP_RD_X` | W | u32 | FBM/readback | Selects readback X. |
| `IO_VDP_RD_Y` | W | u32 | FBM/readback | Selects readback Y. |
| `IO_VDP_RD_MODE` | W | u32 | FBM/readback | Selects readback format. |
| `IO_VDP_RD_STATUS` | R | status bits | FBM/readback | Ready/overflow for readback data. |
| `IO_VDP_RD_DATA` | R | u32 | FBM/readback | Packed readback data. |
| `IO_VDP_CMD` | W | command word | DEX | Direct draw/frame doorbell. |
| `IO_VDP_CMD_ARG0` / `IO_VDP_REG0..IO_VDP_REG_SLOT_DIM` | W/R | raw u32 words | DEX registerfile | Argument latches for draw commands, slot setup, and packet replay. |
| `IO_VDP_FIFO` | W | packet word | DEX stream | Appends one word to the direct FIFO ingress buffer. |
| `IO_VDP_FIFO_CTRL` | W | control bits | DEX stream | `VDP_FIFO_CTRL_SEAL` seals and replays the FIFO packet stream. |
| `IO_VDP_PMU_BANK` | W/R | u32 | PMU | Selects the PMU bank register window. |
| `IO_VDP_PMU_X/Y/SCALE_X/SCALE_Y/CTRL` | W/R | raw u32 words | PMU | Writes the selected PMU bank words. |
| `IO_VDP_SBX_CONTROL` | W/R | u32 | SBX | Writes the skybox face window control word. |
| `IO_VDP_SBX_FACE0..+29` | W/R | raw u32 words | SBX | Writes six skybox face source windows. |
| `IO_VDP_SBX_COMMIT` | W | command word | SBX | `VDP_SBX_COMMIT_WRITE` commits the face window into live SBX state and self-clears. |

The framebuffer, primary, secondary, system, and staging VRAM ranges are
CPU-visible memory ranges owned by the VDP. The DMA/FIFO stream buffer starts at
`VDP_STREAM_BUFFER_BASE`; sealed streams are decoded as VDP packet words, not as
host renderer commands.

## Status bits

| Bit/constant | Meaning |
|---|---|
| `VDP_STATUS_VBLANK` | The frame scheduler reports the machine VBlank edge/interval. |
| `VDP_STATUS_SUBMIT_BUSY` | DEX cannot accept a new submission because FIFO/DMA/build/submitted work occupies the path. |
| `VDP_STATUS_SUBMIT_REJECTED` | The last submission attempt was rejected. |
| `VDP_STATUS_FAULT` | The sticky fault latch contains a non-zero code. |
| `VDP_RD_STATUS_READY` | Readback data is available. |
| `VDP_RD_STATUS_OVERFLOW` | Readback requested more data than the readback budget/window can provide. |

## DEX registerfile

The table names the DEX register indexes. CPU MMIO addresses use the matching
`IO_VDP_REG_*` aliases over `IO_VDP_CMD_ARG0`.

| Register | Word format | Used by |
|---|---|---|
| `VDP_REG_SRC_SLOT` | slot id | BLIT/COPY source resolve. |
| `VDP_REG_SRC_UV` | low16 X, high16 Y | Source rectangle origin. |
| `VDP_REG_SRC_WH` | low16 width, high16 height | Source rectangle size. |
| `VDP_REG_DST_X`, `VDP_REG_DST_Y` | signed Q16.16 | Destination origin. |
| `VDP_REG_GEOM_X0..Y1` | signed Q16.16 | FILL_RECT/DRAW_LINE geometry. |
| `VDP_REG_LINE_WIDTH` | signed Q16.16 | DRAW_LINE thickness. |
| `VDP_REG_DRAW_LAYER` | u32 layer id | Blitter priority pipeline. |
| `VDP_REG_DRAW_PRIORITY` | u32 | Blitter priority pipeline. |
| `VDP_REG_DRAW_CTRL` | bitfield | flip, blend, PMU bank, parallax weight. |
| `VDP_REG_DRAW_SCALE_X/Y` | signed Q16.16 | BLIT scale. |
| `VDP_REG_DRAW_COLOR` | packed ARGB | Draw/blit color. |
| `VDP_REG_BG_COLOR` | packed ARGB | CLEAR and implicit framebuffer clear. |
| `VDP_REG_SLOT_INDEX` | slot id | Selects the slot affected by `VDP_REG_SLOT_DIM`. |
| `VDP_REG_SLOT_DIM` | low16 width, high16 height | Updates selected slot logical dimensions. |

Register writes store raw words. The VDP decodes fixed-point, bitfields, slot
ids, and packed rectangles only at the datapath boundary that consumes them.

## Commands and packets

Direct `IO_VDP_CMD` accepts:

| Command | Effect |
|---|---|
| `VDP_CMD_NOP` | No operation. |
| `VDP_CMD_BEGIN_FRAME` | Opens a direct DEX build frame. |
| `VDP_CMD_END_FRAME` | Seals the direct build frame into active/pending submitted-frame state. |
| `VDP_CMD_CLEAR` | Enqueues a clear command from the registerfile. |
| `VDP_CMD_FILL_RECT` | Enqueues a rectangle command from the registerfile. |
| `VDP_CMD_DRAW_LINE` | Enqueues a line command from the registerfile. |
| `VDP_CMD_BLIT` | Enqueues a blit command from the registerfile through PMU/source resolve. |
| `VDP_CMD_COPY_RECT` | Enqueues a framebuffer copy command from the registerfile. |

FIFO/DMA stream packets use `VDP_PKT_*` headers:

| Packet | Effect |
|---|---|
| `VDP_PKT_END` | Terminates a sealed stream. It must be the final word. |
| `VDP_PKT_CMD` | Replays a draw command. BEGIN/END are illegal inside streams. |
| `VDP_PKT_REG1` | Writes one DEX register word. |
| `VDP_PKT_REGN` | Writes a contiguous run of DEX register words. |
| `VDP_XF_PACKET_KIND` | Writes XF matrix/select registers. |
| `VDP_SBX_PACKET_KIND` | Writes SBX packet state. |
| `VDP_BBU_PACKET_KIND` | Decodes and emits one BBU billboard packet. |

Malformed stream headers, reserved packet bits, missing payload words, illegal
BEGIN/END stream commands, and unknown packet kinds fault with
`VDP_FAULT_STREAM_BAD_PACKET` and abort the sealed stream frame.

## Subunit states

| Unit | States | Owner files |
|---|---|---|
| DEX ingress/build | `Idle`, `DirectOpen`, `StreamOpen` | `frame.ts/.h`, `vdp.ts/.cpp` |
| Submitted DEX work | `Empty`, `Queued`, `Executing`, `Ready` | `frame.ts/.h`, `vdp.ts/.cpp` |
| SBX | `Idle`, `PacketOpen`, `FrameSealed`, `FrameRejected` | `sbx.ts/.h/.cpp` |
| BBU | `Idle`, `PacketDecode`, `SourceResolve`, `InstanceEmit`, `LimitReached`, `PacketRejected` | `bbu.ts/.h/.cpp` |
| FBM | `PageWritable`, `PagePendingPresent`, `PagePresented`, `ReadbackRequested` | `fbm.ts/.h/.cpp` |
| VOUT | `Idle`, `RegisterLatched`, `FrameSealed`, `FramePresented` | `vout.ts/.h/.cpp` |
| PMU | selected bank and bank registerfile | `pmu.ts/.h/.cpp` |
| XF | matrix registerfile and selected matrix indexes | `xf.ts/.h/.cpp` |

## Timing

| Unit/path | Work timing | CPU-visible polling/edge |
|---|---|---|
| DEX direct command | BEGIN/END/doorbell writes execute admission immediately. Draw commands enqueue retained work; framebuffer rasterization waits for scheduler work units. | `VDP_STATUS_SUBMIT_BUSY`, `VDP_STATUS_SUBMIT_REJECTED`, and fault registers. |
| DEX FIFO stream | `IO_VDP_FIFO` collects words through the stream-ingress unit. `VDP_FIFO_CTRL_SEAL` decodes/replays the sealed stream immediately into submitted-frame state. | Stream-ingress partial words and submitted frames keep submit busy set. |
| DMA stream | DMA owner opens the stream-ingress DMA submit latch, copies bytes into VDP stream memory, then seals. The VDP decodes the stream on seal. | Submit busy remains set while DMA submit is active. |
| Submitted framebuffer work | Scheduler accrues render work units from CPU cycles and advances active DEX work. Work moves from `Executing` to `Ready` when remaining units reach zero. | VBlank presents only `Ready` frames; unfinished frames are held. |
| SBX | Register-window writes affect live SBX state. Frame seal samples live SBX state. Visible SBX state changes only when a `Ready` frame is presented. | Invalid face sources fault at frame seal; rejected SBX state does not become visible. |
| BBU | Packet decode/source resolve/instance emit happen during sealed stream replay. Accepted instances are retained in the submitted frame. | Packet faults abort the sealed stream frame through VDP fault registers. |
| FBM | Framebuffer page present happens on VBlank for `Ready` frames with framebuffer work. Readback executes through readback registers with a chunk budget. | Readback status/data and VDP fault registers. |
| VOUT | Dither/dimension/output latches are sampled at frame seal and become visible at frame presentation. | Host consumes `VdpDeviceOutput`; cart sees MMIO/status only. |

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
| VRAM write to unmapped/stale/uninitialized slot | `VDP_FAULT_VRAM_WRITE_UNMAPPED`, `VDP_FAULT_VRAM_WRITE_UNINITIALIZED` | Latch fault; no surface mutation for that write. |
| VRAM write out of range/unaligned | `VDP_FAULT_VRAM_WRITE_OOB`, `VDP_FAULT_VRAM_WRITE_UNALIGNED` | Latch fault; write is rejected. |
| Slot dimension overflow/bad slot | `VDP_FAULT_VRAM_SLOT_DIM` | Latch fault; existing slot dimensions remain. |
| Stream malformed packet | `VDP_FAULT_STREAM_BAD_PACKET` | Abort sealed stream frame and clear stream ingress. |
| Direct bad submit state | `VDP_FAULT_SUBMIT_STATE` | Reject/drop command and keep or cancel the direct frame according to the command path. |
| Unknown draw doorbell | `VDP_FAULT_CMD_BAD_DOORBELL` | Latch fault; drop the doorbell. |
| Submit queue busy | `VDP_FAULT_SUBMIT_BUSY` | Reject the attempt; no visible frame mutation. |
| DEX invalid scale/line width/draw control | `VDP_FAULT_DEX_INVALID_SCALE`, `VDP_FAULT_DEX_INVALID_LINE_WIDTH`, `VDP_FAULT_DEX_UNSUPPORTED_DRAW_CTRL` | Latch fault; drop that draw command and keep the direct frame open. |
| DEX source slot/source OOB | `VDP_FAULT_DEX_SOURCE_SLOT`, `VDP_FAULT_DEX_SOURCE_OOB` | Latch fault; drop that draw command and keep the direct frame open; sealed streams abort. |
| DEX command FIFO overflow | `VDP_FAULT_DEX_OVERFLOW` | Latch fault; drop overflowing command. |
| SBX source OOB | `VDP_FAULT_SBX_SOURCE_OOB` | Reject frame seal; invalid SBX state does not become visible. |
| BBU zero size/source OOB/overflow | `VDP_FAULT_BBU_ZERO_SIZE`, `VDP_FAULT_BBU_SOURCE_OOB`, `VDP_FAULT_BBU_OVERFLOW` | Abort sealed stream frame; no billboard contribution is emitted for the bad packet. |

## Host output and save state

VOUT owns live, frame-sealed, and visible host-output buffers. Host backends read
`VdpDeviceOutput` and VDP surface/presentation transactions. They must not own or
interpret cart intent.

Saved VDP state includes:

- DEX registerfile words;
- DEX build-frame state, active/pending submitted-frame state, render work
  counters, `streamIngress` DMA submit latch, FIFO partial-word bytes, sealed
  FIFO stream words, and blitter sequence;
- VDP status/fault words;
- PMU selected bank and bank words;
- SBX live face/control words;
- XF matrix words and selected indexes;
- VOUT/dither/display dimensions that affect future output;
- VRAM staging bytes, surface pixels, and framebuffer display/readback pixels.

Host GPU textures, WebGL/SDL resources, texture handles, renderer queues, and
host-side scratch are rebuilt from saved device-visible state.

## Owners

- TS VDP device: `src/bmsx/machine/devices/vdp/vdp.ts`
- TS VDP save-state and stream ingress: `save_state.ts` and `ingress.ts`
- TS VDP constants/registers: `src/bmsx/machine/devices/vdp/contracts.ts` and
  `registers.ts`
- TS subunits: `bbu.ts`, `fbm.ts`, `frame.ts`, `pmu.ts`, `sbx.ts`, `vout.ts`,
  and `xf.ts`
- C++ VDP device: `src/bmsx_cpp/machine/devices/vdp/vdp.cpp/.h`
- C++ VDP save-state and stream ingress: `save_state.cpp/.h` and
  `ingress.cpp/.h`
- C++ VDP constants/registers: `src/bmsx_cpp/machine/devices/vdp/contracts.h`
  and `registers.h`
- C++ subunits: `bbu.cpp/.h`, `fbm.cpp/.h`, `frame.cpp/.h`, `pmu.cpp/.h`,
  `sbx.cpp/.h`, `vout.cpp/.h`, and `xf.cpp/.h`
- Host render output consumers: `src/bmsx/render/vdp/*` and
  `src/bmsx_cpp/render/vdp/*`
- Runtime save-state codecs: `src/bmsx/machine/runtime/save_state/*` and
  `src/bmsx_cpp/machine/runtime/save_state/*`
