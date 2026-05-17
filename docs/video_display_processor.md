# Video Display Processor

This is the CPU-visible contract for the Video Display Processor (VDP). The VDP
is a machine device with raw register words, command doorbells, FIFO/stream
packet ingress, VRAM/surface memory, subunit state machines, status/fault
latches, scheduler-visible render work, an FBM presentation transaction, and a VOUT host-output transaction edge.

Host renderers consume VOUT transactions. They do not receive cart intent such
as sprites, rectangles, labels, glyph runs, tile runs, or scene objects.
DEX framebuffer commands are stored as retained fixed-capacity command buffers:
opcode, source, geometry, color, run-entry indexes, and render-cost fields live
in per-field arrays with a length latch; the blitter buffer owns command-slot
reservation, length-latch updates, and the per-field command writes. DEX source-slot admission is a
blitter-source datapath: raw slot words resolve to VDP-owned VRAM surfaces and
source bounds are checked before blit/tile-run records enter the command buffer.
Build, active, and pending submitted frames transfer those buffers by ownership;
mirrored frame owners reset those slots without reallocating retained buffers.
The hot path does not allocate per-command objects or nested glyph/tile vectors.

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
| `VDP_LPU_PACKET_KIND` | Writes raw LPU ambient, directional, and point-light registers. |
| `VDP_MFU_PACKET_KIND` | Writes raw MFU morph-weight registers. |
| `VDP_JTU_PACKET_KIND` | Writes raw JTU joint-matrix registers. |
| `VDP_MDU_PACKET_KIND` | Decodes and emits one MDU mesh draw record. |

`VDP_LPU_PACKET_KIND`, `VDP_MFU_PACKET_KIND`, and `VDP_JTU_PACKET_KIND` use the
same register-window shape as XF packets: the first payload word is the first
register index and the remaining words are stored contiguously. LPU, MFU, and
JTU store raw words; the render snapshot datapath decodes LPU words into frame
lighting, the mesh vertex-stream datapath consumes MFU words as signed Q16.16
morph weights, and the mesh vertex-stream datapath consumes JTU words as signed
Q16.16 matrix words grouped as 16-word column-major joint matrices.

LPU register windows:

| Window | Base | Words per record | Records | Word layout |
|---|---:|---:|---:|---|
| ambient | 0 | 5 | 1 | control, color R, color G, color B, intensity |
| directional | 5 | 8 | 4 | control, dir X, dir Y, dir Z, color R, color G, color B, intensity |
| point | 37 | 9 | 4 | control, pos X, pos Y, pos Z, range, color R, color G, color B, intensity |

Control bit 0 enables the light record. Color, intensity, direction, position,
and range words are stored raw and decoded as signed Q16.16 only when render
snapshots build the frame lighting view.

`VDP_MDU_PACKET_KIND` has ten payload words:

| Word | Meaning |
|---:|---|
| 0 | model asset token low word |
| 1 | model asset token high word |
| 2 | mesh index inside the rompacked model |
| 3 | material index, or `VDP_MDU_MATERIAL_MESH_DEFAULT` to use the mesh material |
| 4 | XF model-matrix slot index |
| 5 | control word: bit 0 enables texture sampling, bits 1..2 select the VDP texture slot |
| 6 | packed ARGB color multiplier |
| 7 | low16 morph-weight base register, high16 morph target count |
| 8 | low16 joint-matrix base index, high16 joint count |
| 9 | reserved, must be zero |

Model tokens identify ROM model assets only. Textured MDU draws sample the
selected VDP VRAM slot; they do not consume standalone GLTF image buffers or an
old material texture-manager path. The native GLES2 and browser WebGL2 output
paths expand at most `VDP_MDU_VERTEX_LIMIT` vertices for one MDU draw record.
Accepted MDU records are stored in retained fixed-capacity frame buffers on
both runtimes, using per-field raw word arrays and a live length latch rather
than per-packet mesh objects. Frame seal, pending/active promotion, and VOUT
presentation transfer the retained buffers by ownership, not by copying mesh
records.
Material image references remain ROM metadata; the shader consumes only material
scalar/surface state and the VDP-selected VRAM slot.

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
| LPU | light registerfile | `lpu.ts/.h/.cpp` |
| MFU | morph-weight registerfile | `mfu.ts/.h/.cpp` |
| JTU | joint-matrix registerfile | `jtu.ts/.h/.cpp` |
| MDU | `Idle`, `PacketDecode`, `InstanceEmit`, `LimitReached`, `PacketRejected` | `mdu.ts/.h/.cpp` |
| FBM | `PageWritable`, `PagePendingPresent`, `PagePresented` | `fbm.ts/.h/.cpp` |
| Readback | `Ready`, `BudgetExhausted`, `OverflowLatched` | `readback.ts/.h/.cpp` |
| VOUT | `Idle`, `RegisterLatched`, `FrameSealed`, `FramePresented` | `vout.ts/.h/.cpp` |
| PMU | selected bank and bank registerfile | `pmu.ts/.h/.cpp` |
| XF | matrix registerfile and selected matrix indexes | `xf.ts/.h/.cpp` |

## Timing

| Unit/path | Work timing | CPU-visible polling/edge |
|---|---|---|
| DEX direct command | BEGIN/END/doorbell writes execute admission immediately. Draw commands enqueue retained work; framebuffer rasterization waits for scheduler work units. | `VDP_STATUS_SUBMIT_BUSY`, `VDP_STATUS_SUBMIT_REJECTED`, and fault registers. |
| DEX FIFO stream | `IO_VDP_FIFO` collects words through the stream-ingress unit. `VDP_FIFO_CTRL_SEAL` decodes/replays the sealed stream immediately into submitted-frame state. | Stream-ingress partial words and submitted frames keep submit busy set. |
| DMA stream | DMA owner opens the stream-ingress DMA submit latch, copies bytes into VDP stream memory, then seals. The VDP decodes the stream on seal. | Submit busy remains set while DMA submit is active. |
| Submitted framebuffer work | Scheduler accrues render work units from CPU cycles and advances active DEX work. Work moves from `Executing` to `ExecutionPending` when retained framebuffer commands are ready for the host backend pass, then to `Ready` only after `completeReadyFrameBufferExecution`. | VBlank presents only `Ready` frames; unfinished or backend-pending frames are held. |
| Framebuffer execution pass | Host render backend consumes the ready DEX command buffer at the render/presentation boundary. TS headless and native software backends use retained software rasterizers that write the VDP framebuffer VRAM slot and mark CPU readback dirty. WebGL/GLES render the same ordered command stream into the backend framebuffer texture and complete with no CPU-readback slot. | `src/bmsx/render/backend/software/*`, `src/bmsx/render/backend/webgl/vdp_framebuffer_execution.ts`, `src/bmsx_cpp/render/backend/software/*`, and `src/bmsx_cpp/render/backend/gles2/*`. |
| SBX | Register-window writes affect live SBX state. Frame seal samples live SBX state and resolves face sources against VRAM surface slots. Visible SBX state changes only when a `Ready` frame is presented. | Invalid face sources fault at frame seal; rejected SBX state does not become visible. |
| BBU | Packet decode, VRAM-backed source resolve, and instance emit happen during sealed stream replay. Accepted instances are retained in fixed-capacity per-field frame buffers. | Packet faults abort the sealed stream frame through VDP fault registers. |
| XF/LPU/MFU/JTU register port | Stream `REG1/REGN` packets write raw live register words during sealed stream replay. Frame seal samples the current words into the submitted VOUT payload. | Bad register ranges fault and abort the sealed stream frame. |
| MDU | Mesh packet decode/source admission happens during sealed stream replay. Accepted mesh records are retained in the submitted frame and carry only ROM asset tokens, raw matrix indexes, raw MFU/JTU ranges, color, and VDP texture-slot control. | Packet faults abort the sealed stream frame through VDP fault registers. |
| FBM | Framebuffer page present happens on VBlank for `Ready` frames with framebuffer work. | Framebuffer presentation and display readback page. |
| Readback | `IO_VDP_RD_*` reads resolve a registered surface, serve retained cache chunks, advance X/Y, and consume per-frame budget. | Readback status/data and VDP fault registers. |
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
| MDU overflow/bad matrix/morph/joint range/texture slot | `VDP_FAULT_MDU_OVERFLOW`, `VDP_FAULT_MDU_BAD_MATRIX`, `VDP_FAULT_MDU_BAD_MORPH_RANGE`, `VDP_FAULT_MDU_BAD_JOINT_RANGE`, `VDP_FAULT_MDU_BAD_TEXTURE_SLOT` | Abort sealed stream frame; no mesh contribution is emitted for the bad packet. |

## Host output and save state

VOUT owns live, frame-sealed, and visible host-output buffers. Host backends read
`VdpDeviceOutput` and VDP surface/presentation transactions. They must not own or
interpret cart intent. Mesh output is a VOUT transaction: the native GLES2 host
renderer resolves the ROM model token at the output edge and samples the selected
VDP VRAM slot. The browser WebGL2 path resolves the same VOUT records and draws
the same MDU mesh contract. TS headless and native software backends rasterize
VOUT mesh records for capture/proof from the same rompacked source and sampled
MFU/JTU/LPU state. The native GLES2 mesh pass expands indexed vertices, morph
targets, and joint matrices on the CPU into a retained dynamic vertex stream.
Its shader then applies material surface mode, double-sided/unlit flags, alpha
cutoff, base/emissive color factors, roughness/metallic factors, and LPU-derived
frame lighting. This keeps the backend compatible with low-end GLES2 targets that
do not expose UBOs, instancing, or vertex texture fetch.

Saved VDP state includes:

- DEX registerfile words;
- DEX build-frame state, active/pending submitted-frame state, render work
  counters, `streamIngress` DMA submit latch, FIFO partial-word bytes, sealed
  FIFO stream words, and blitter sequence;
- VDP status/fault words;
- readback budget/overflow latches;
- PMU selected bank and bank words;
- SBX live face/control words;
- LPU live light register words;
- XF matrix words and selected indexes;
- VOUT/dither/display dimensions that affect future output;
- VRAM unit state: staging bytes and surface pixels.
- framebuffer display/readback pixels.

Host GPU textures, WebGL/SDL resources, texture handles, renderer queues, and
host-side scratch are rebuilt from saved device-visible state. MDU frame output
and sampled LPU/MFU/JTU words are visible-frame payload in the current mesh pass;
LPU live register words are saved as device state, while sampled per-frame output
is rebuilt through VOUT presentation.
DEX command buffers, BBU billboard frame buffers, and MDU mesh frame buffers use
retained per-field storage on both runtimes. Frame seal, submitted-frame
promotion, and VOUT presentation transfer those buffers by ownership rather than
copying per-record objects.

## Owners

- TS VDP device: `src/bmsx/machine/devices/vdp/vdp.ts`
- TS VDP save-state, stream ingress, VRAM/surface memory, and readback:
  `save_state.ts`, `ingress.ts`, `vram.ts`, and `readback.ts`
- TS VDP constants/registers: `src/bmsx/machine/devices/vdp/contracts.ts` and
  `registers.ts`
- TS subunits: `bbu.ts`, `fbm.ts`, `frame.ts`, `jtu.ts`, `lpu.ts`, `mdu.ts`,
  `mfu.ts`, `pmu.ts`, `sbx.ts`, `vout.ts`, and `xf.ts`
- C++ VDP device: `src/bmsx_cpp/machine/devices/vdp/vdp.cpp/.h`
- C++ VDP save-state, stream ingress, VRAM/surface memory, and readback:
  `save_state.cpp/.h`, `ingress.cpp/.h`, `vram.cpp/.h`, and `readback.cpp/.h`
- C++ VDP constants/registers: `src/bmsx_cpp/machine/devices/vdp/contracts.h`
  and `registers.h`
- C++ subunits: `bbu.cpp/.h`, `fbm.cpp/.h`, `frame.cpp/.h`, `jtu.cpp/.h`,
  `lpu.cpp/.h`, `mdu.cpp/.h`, `mfu.cpp/.h`, `pmu.cpp/.h`, `sbx.cpp/.h`,
  `vout.cpp/.h`, and `xf.cpp/.h`
- Host framebuffer execution passes and software rasterizers:
  `src/bmsx/render/backend/software/*`,
  `src/bmsx/render/backend/webgl/vdp_framebuffer_execution.ts`,
  `src/bmsx_cpp/render/backend/software/*`, and
  `src/bmsx_cpp/render/backend/gles2/*`
- Host render output consumers: `src/bmsx/render/vdp/*` and
  `src/bmsx_cpp/render/vdp/*`
- Runtime save-state codecs: `src/bmsx/machine/runtime/save_state/*` and
  `src/bmsx_cpp/machine/runtime/save_state/*`
