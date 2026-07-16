# Temporary GX/PSX Replacement Workplan

Status file for agents working on the active BMSX graphics replacement goal.
This is **not** a stable ABI contract and is **not** more authoritative than the
live checkout. It is a temporary execution checklist so agents can see the
current direction, completed slices, known blockers, and next work.

Last refreshed: 2026-07-15
Do not duplicate recent commit history here. Use `git log --oneline` for that.

## Source of truth

For the GX/PSX graphics replacement work, the live checkout, current diff, and
recent commits are authoritative. This temporary file is only the current
execution map/checklist. `docs/goal.md` is an older broad hardware-emulation
goal and is not sufficient for this graphics replacement because it does not
capture the current PSX-GPU/GTE direction or the TS/C++ headless
software-renderer requirement.

## Active goal

Replace the current BMSX VDP/RPU direction with a PSX-style GX GPU/GTE machine.
The active target is real PSX-GTE/GPU parity, with completion of the PSX-GTE
emulation as the current hardware-foundation focus. The PSX GTE is the
deliberate basis for the eventual BSX GTE+, not a temporary implementation to
discard once fantasy extensions start.

The long-term console identity is BSX: a fantasy descendant of the PlayStation
architecture with the Lua CPU and its own native GTE+ and GPU. That end state is
recorded in `docs/architecture.md`; it is not active implementation scope until
the PSX-GTE foundation is accepted.

Completion means all of these are true:

- The current VDP/RPU is no longer the active graphics ABI or presentation path.
- GX-GPU/GTE owns the cart-visible graphics contract through raw PSX-style GPU,
  GTE, command, status, timing, VRAM, texture, mask, blend, and display behavior.
- WebGL2, GLES2, and the existing TS/C++ software/headless backends consume the
  same GX command/GTE contract.
- Non-software backends are 100% host-GPU accelerated. They must not rasterize
  pixels on the CPU and then present those pixels through the host GPU.
- Software rendering is already a serious TS/C++ headless backend path. The
  GX/PSX work must make it another implementation/oracle of the same hardware
  contract, not a fallback path hidden inside accelerated backends.
- Render-visible GX/PSX slices need headless validation because TS headless and
  C++ libretro software runs are real users of the software backend.
- There are no backend profiles, legacy compatibility modes, renderer-descriptor
  escape hatches, shader-variant ABI patches, or fake fallback paths.

## Explicit non-goals for this phase

- Do not do migration-only busywork. Migration is required, but every migration
  slice must either depend on already-covered GX/PSX behavior or add the missing
  functional GX/PSX coverage in the same vertical slice.
- Do not preserve retired save-state fields or readers as a compatibility path.
- Do not add defensive require/ensure/fallback/provider/adapter/injection
  patterns.
- Do not keep adding features to the old VDP/RPU spectacle path.
- Do not design or expose BSX GTE+, depth, morphing, local-memory, or native
  surface extensions through the ABI yet. Preserve the goals for later, after
  the PSX-GTE foundation is real and accepted.

## Current implementation owners

GX owners:

- TypeScript GPU: `machine/ts/machine/devices/gx/gpu.ts`
- TypeScript GTE: `machine/ts/machine/devices/gx/gte.ts`
- TypeScript command buffer: `machine/ts/machine/devices/gx/gpu_command_buffer.ts`
- C++ GPU: `machine/cpp/machine/devices/gx/gpu.cpp`, `machine/cpp/machine/devices/gx/gpu.h`
- C++ GTE: `machine/cpp/machine/devices/gx/gte.cpp`, `machine/cpp/machine/devices/gx/gte.h`
- C++ command buffer: `machine/cpp/machine/devices/gx/gpu_command_buffer.h`
- WebGL backend: `machine/ts/render/backend/webgl/gx_gpu.ts`
- GLES2 backend: `machine/cpp/render/backend/gles2/gx_gpu.cpp`
- TypeScript software/headless backend: `machine/ts/render/backend/software/gx_gpu*.ts`
- C++ software backend: `machine/cpp/render/backend/software/gx_gpu*.cpp`
- Raw GX/DMA firmware: `machine/firmware/system/gx_gpu.lua`,
  `machine/firmware/system/dma.lua`
- Cart image-layout owner: `cartlib/gx/image.lua`
- ROM image-placement producer: `scripts/rompacker/atlasbuilder.ts`,
  `scripts/rompacker/rombuilder.ts`
- BIOS fixed system-texture consumers: `machine/firmware/bios/bootrom.lua`,
  `machine/firmware/system/font.lua`

Residual VDP/IMGDEC machine ownership has been removed from both runtimes.
The ROM `vdp_class: psx` field remains a package-format compatibility marker;
it is not a live VDP device contract.

## Current high-level state

GTE is relatively far along. GPU is in the middle of the replacement work. GX
is the only cart graphics route executed by host backends. GPU parity and
accelerated conformance remain open; the old VDP/RPU and IMGDEC machine paths
are no longer blockers.

Implemented or partially covered GX-GPU areas include:

- GP0 primitive command decoding for polygons, lines, polylines, rectangles,
  fills, CPU-to-VRAM upload, VRAM-to-VRAM copy, and VRAM-to-CPU command emission.
- GP1 display/status register work, DMA direction, display mode bits, info
  command range, PAL/NTSC timing-visible state, and interlaced active-field
  behavior.
- Latched GP1 display state now produces native 320x240, 256x192, and 256x212
  presentation targets in TS/C++ software, WebGL2, WebGPU, and GLES2. Width
  comes only from GP1(08h), active height from GP1(07h), and the retained
  GP1(06h) horizontal timing range does not trigger a target transition.
  Backends consume native VRAM coordinates directly without active-range
  resampling or inner-loop scale divisions. The presentation owner rebuilds
  retained targets only when the derived dimensions change; the runtime applies
  published active-line timing at the frame boundary. `pietious` remains native
  256x192 and `2025` remains native 320x240 without cart, asset, atlas-builder,
  or rompacker changes. Focused TS/C++ vectors cover non-zero origins, VRAM
  wrap, 192/212 timing, restore, and one-shot libretro geometry transitions;
  software pixel data matches at Pietious frame 620, and GLES2/llvmpipe captures
  prove 320x240, 256x192, and 256x212 targets. Live browser proof remains
  deferred. Field-aware interlaced scanout now retains the opposite field while
  updating the GPUSTAT-selected current field in TS/C++ software, WebGL2,
  WebGPU, and GLES2. True 480i consumes alternating VRAM source rows; low-line
  interlace consumes the same source rows in alternating temporal fields. The
  retained host pixel storage is allocated only on first interlaced use or an
  output-size change, is rebuilt after a display interpretation or VRAM snapshot
  replacement, and is not save-state data. Progressive scanout stays on its
  original direct path behind one mode dispatch and allocates no field storage.
  GPU field edges publish a presentation frame even without new GP0 work, so the
  opposite retained field and the second disabled field cannot remain hidden.
  Mirrored software vectors cover wrapped source rows, current-field retention,
  display disable, and snapshot reprime; all GLES2/WebGL2 shader variants compile
  and link with Mesa's surfaceless GLES drivers. Live WebGPU browser proof remains
  deferred.
- Cartlib presentation owns one retained active visual-component list per world
  space. Sprite, tile, text and custom visuals inherit the same depth contract
  and draw polymorphically through one visual system; the old hard-coded kind
  stages and the subsystem presentation escape path are gone. Activation uses
  a monotone sequence for stable equal-z order, add/remove preserves the ordered
  list, and the BIOS sort repairs runtime z changes in place. Its ordered
  pre-pass keeps unchanged frames O(n) without a second display list or
  per-frame records. A cartlib pixel gate covers cross-kind ordering and live z
  changes through the normal tile, text, sprite and custom draw paths.
- Text components retain wrapped lines, glyph references and widths at text,
  font, wrap or textobject-dimension mutation. The typewriter reveals retained
  glyph references directly, and prompt/highlight writes happen only at state,
  input or typing boundaries. Steady draw walks retained arrays without line
  tables, glyph substrings or callback closures. The duplicate cartlib font
  module is removed in favor of the system-font owner. Sprite modulation is a
  packed GX color word throughout; the dead float `colorize` DTO is removed.
- Cartlib overlap submission now follows the GEO hardware boundary: direct and
  full-pass commands suspend on `halt_until_irq`, the central cart IRQ
  dispatcher acknowledges DONE/ERROR, and collision code consumes a raw
  completion latch instead of polling IRQ MMIO. `overlap2dsystem` retains its
  alternating pair-history rows, result/contact records and one synchronous
  event record at the system owner. Stable collider high-water frames allocate
  no pair rows or event DTOs; only the documented begin/stay/end events are
  emitted.
- Texture windows/CLUT-ish paths, texture disable, modulation math, mask/fill
  behavior, oversized primitive culling, and VRAM copy overlap chunking.
- Raw PSX textured quad polygons are covered in TS/C++ software/headless tests
  and have GX firmware/cartlib helpers for cart-visible affine textured draws.
- TS/C++ software triangle coverage now owns the PSX integer top-left fill rule,
  half-open bounds, and single-owner quad seams through mirrored raw-VRAM
  vectors. WebGL2, GLES2, and WebGPU apply the matching half-pixel conversion at
  their vertex-transform boundary; live accelerated conformance remains open.
- Polygon raster output now translates the one visible signed-11 coordinate
  bucket after E5 and primitive-size rejection in TS/C++ software, WebGL2,
  GLES2, and WebGPU. Mirrored vectors preserve the valid `+1024` exclusive edge
  and cover negative X/direct16 texture interpolation plus negative Y/Gouraud
  drawing-area clipping without accelerated CPU rasterization.
- Textured polygons now use the same 12-fraction-bit UV gradients, half-texel
  seed, and 20-bit accumulator wrap in TS/C++ software, WebGL2, GLES2, and
  WebGPU. WebGPU consumes the raw plane with native unsigned arithmetic;
  WebGL2/GLES2 interpolate bounded radix-16 digit planes and only resolve their
  carry chain per fragment, removing the split multiply/mod fragment hot path.
  The normal raw-UV vertex stream retains sample-cache bounds. Quads refresh
  read-VRAM between triangle draws when required; rectangles keep their lean
  direct integer UV path.
- Gouraud polygons now use that same fixed-12 attribute-plane contract for RGB
  before dither, RGB555 store, and texture modulation in TS/C++ software,
  WebGL2, GLES2, and WebGPU. Software steps one retained three-component plane
  instead of dividing three barycentric numerators per pixel and skips color
  work for raw textures. WebGPU streams raw plane words; WebGL2/GLES2 use
  retained radix-16 streams and shader permutations, with the fixed textured
  layout staying within eight GLES2 vertex attributes. Representation changes
  split batches, raw-textured Gouraud stays on the normal path, and quads build
  each triangle plane independently. Normal and fixed layouts share one
  retained CPU stream and GPU buffer per primitive family. Mirrored raw vectors
  lock the truncation tie for solid RGB555 store and direct16 modulation;
  accelerated live conformance remains open. The full frame-1,020
  `bare_metal_cart` timeline produces all 146 captures on GLES2/llvmpipe without
  shader/runtime errors, while the same captures match byte-for-byte between TS
  headless and C++ software. Browser execution remains deferred.
- Mirrored raw software vectors now lock E2 bit replacement, direct16 page X/Y
  wrap, palette4 nibble selection across a page edge, and palette8 byte plus
  horizontal CLUT wrap. The matching accelerated live run remains open.
- WebGL2/GLES2 solid batch identity now includes both E6 bits instead of only
  force-mask state. Read-VRAM solid quads are sequenced as two triangle draws in
  WebGL2, GLES2, and WebGPU, with destination refresh between them, matching the
  software command order for concave/bow-tie and other representable overlap.
  Mirrored raw vectors also lock STP-gated blending and E6 solid-draw stores; no
  CPU pixels or per-command side buffers were added.
- Variable rectangles now truncate the coordinate produced by vertex plus E5
  drawing offset back to signed 11-bit in TS/C++ software, WebGL2, GLES2, and
  WebGPU. Mirrored raw-VRAM vectors cover inclusive drawing-area clipping,
  negative vertices plus offsets, solid and textured rectangle clipping with UV
  advance, line clipping, and rectangle coordinate wrap. WebGPU fills now also
  bypass E6 mask state like the other backends and the PSX fill datapath.
- TS/C++ software lines now wrap every emitted DDA sample to signed 11-bit.
  WebGL2, GLES2, and WebGPU use the same endpoint/color ordering, rational form
  of the PSX fixed-point DDA, inclusive endpoints, fixed-12 Gouraud steps, and a
  conservative three-pixel GPU strip instead of geometric round-nearest
  coverage or a full bounding-box fragment walk. Their host geometry translates
  the one visible signed-11 bucket without CPU pixel emission. WebGPU also
  flushes overlapping read-VRAM polyline batches so a shared endpoint observes
  the preceding segment's write.
- WebGL2, GLES2, and TS/C++ software execution for the currently handled command
  kinds.
- GX command logs can be retired after presentation without clearing backend
  VRAM, so carts can build frame commands without losing uploaded texture VRAM.
- BIOS boot image rendering, `emptycart`, `fade_probe`, `vblanktest`,
  `nemesis_s`, `renderhwtest`, and the `2025` runtime/cart path now use
  GX-visible graphics paths instead of active VDP/RPU frame submission.

`GX_GPU_COMMAND_READ_VRAM_TO_CPU` is executed at its retained fence by software,
WebGL2, GLES2, and WebGPU. Only live accelerated conformance remains deferred.

Cart texture residency is independent of the active GP1 display dimensions,
and the GTE does not participate in texture or atlas handling. The ROM packer
emits one fixed system GP0 stream and destination-free cart texture payloads.
Direct16 payloads are row-major RGB555/STP words; palette4 payloads contain raw
packed texels followed by their CLUT. Every runtime image points directly at
the shared ROM span plus integer-local `texture_u`/`texture_v` metadata. The cart
chooses the physical VRAM rectangle. `system/gx_gpu.lua` emits the raw A0 packet
and `system/dma.lua` streams the payload directly from ROM to GP0. Neither
firmware owner, cartlib nor a cart knows the producer's numeric packing-group
ID. Runtime PNG decode and mapped RGBA texture staging are not part of texture
residency; generated PNGs remain tooling previews only.

Each cart declares reserved VRAM, physical texture/CLUT slots, possible group
destinations and simultaneous working sets in `gx_texture_layout`. The producer
validates those regions, packs within the smallest legal slot, and generates
compile-time raw destination words. Its deterministic skyline packer keeps every
ordinary image inside one 256x256 sampling page. A physically larger surface may
span pages and is split only by the central rectangle primitive; ordinary rect
and affine draws perform no runtime page discovery. The compact BIOS direct16
texture remains one fixed 256x256 page and emits one A0 stream. The independent
host-systematlas remains a host UI renderresource, not cart residency.

The `2025` cart deliberately replaces its pre-GX unlimited-atlas assumptions
with an explicit 1024x512 VRAM map. The top half contains the 320x240
framebuffer, Maya B, the fixed system page, and adjacent Maya A/V_S textures.
The bottom half contains two 384x256 background banks and a separate monster
bank. The common combat textures remain resident; a monster switch replaces
only the monster bank, while the opaque all-out image deliberately replaces the
left background bank. None of these ranges overlaps the framebuffer or system
page. Background preload is queued before the authored swap, submitted after
the preceding frame draw, and committed on that single channel's completion
IRQ. A later upload cannot overtake it: its CPU-written A0 header stalls on GP0
ownership until the preceding DMA payload has completed.

DMA owns the CPU GP0 command port until its payload is complete. The CPU keeps a
blocked GP0 store latched against its raw MMIO address and resumes it only when
that address is actually write-ready, rather than re-executing it on every
DMA deadline. A late CPU write-ready probe first synchronizes expired
GPU command time and republishes the CPU/DMA ready lines, so it cannot cancel the
last GPU timer while leaving stale low outputs. Host-invoked closures use that
same device edge rather than polling. The long `2025` black-box capture now
starts the real `combat_wekker` flow and crosses the first common-plus-monster
upload before checking Maya B, the clock scene and the choice prompt.

`pietious` now uses a manifest-required, destination-free native PSX 4-bpp
texture plus CLUT in one cart-owned slot. It has no CPU texture-staging
allocation, whole-texture RGBA decode or VDP tile stream. The legacy header's
eight permanently off-screen black columns are removed, so every Pietious image
fits one hardware sampling page and every blit remains one primitive.

`@atlas=N` is strictly a ROM-producer grouping directive, not a serialized
runtime asset or a GPU, DMA, cartlib or firmware residency unit. `pietious` has
a compact stable 4-bpp texture/CLUT working set, while `2025` uses
smaller cart-owned working sets that match what is simultaneously visible. Its
full-screen direct16 backgrounds legitimately bulk-upload at scene transitions;
they are no longer incidental members of multi-background producer groups. A cart
that needs several independently changing texture sets must program its own raw
VRAM page/CLUT layout instead of growing a semantic firmware slot manager or
another whole-atlas swap wrapper.

GX image production is the only supported ROM path. The old mutable
`--textureatlas no` switch is removed rather than retaining a PNG-backed image
fallback that the GX runtime cannot consume.

For the current assets this changes a background transition from a generated
718,812--896,976-byte multi-background upload to the active image's
153,600--196,608-byte stream. GX samples these integer texture rectangles with
nearest filtering, so the old extruded bilinear-bleed border is gone and a
256-pixel-high background stays page-aligned without a vertical split. The
transition regression follows the authored fade/montage timing and no longer
treats the duration of the oversized DMA as a required black-frame hold.

CPU instructions can service the frame-end timer after its deadline. Both
runtimes therefore advance the frame origin from the previous scheduled frame
boundary instead of scheduler callback time. Late service cannot accumulate
into scanout phase or repeat a host frame; VBlank-edge tick completion and cart
first-tick semantics are unchanged.

## GPUREAD / VRAM-to-CPU implementation contract

The design is implemented for CPU GPUREAD in TS/C++ software, WebGL2, GLES2 and
WebGPU, including GPUREAD-to-RAM DMA. Live accelerated conformance remains open.

- GP0(C0h) creates a command-buffer execution fence. All earlier GPU work must
  reach the real backend VRAM before readback; later commands remain behind the
  fence until the read transfer is consumed. A later C0 marker remains queued
  and cannot overwrite the active request latches.
- The command stream stays read-only to render code. A retained
  `GxGpuReadbackPort` is the real owner of the request latches, fence,
  completion phase, maximum 1024x512 pixel result buffer and the consumption
  cursor/datapath; only that narrow hardware port is mutable to backends. The
  GPU device owns the GPUREAD latch and GPUSTAT and consumes words through the
  port. Do not introduce a proxy, host readback DTO or a second VRAM owner.
- Software reads its raw VRAM directly. WebGL2/GLES2 and WebGPU run a retained
  GPU pack pass that emits two wrapped 16-bit pixels as one RGBA8 word.
  WebGL2/GLES2 then use one direct `readPixels`; WebGPU records pack and
  texture-to-buffer work in the same ordered submission and signals ready only
  after asynchronous mapping. Accelerated backends do no CPU per-pixel packing.
- GPUSTAT ready-to-send and GPUREAD-to-CPU DMA request stay low until completion.
  GPUREAD packs low/high RGB555 words, wraps each coordinate, zero-fills an odd
  high pixel and leaves the final word latched after transfer completion.
- The retained readback port drives the DMA ready line directly. A valid backend
  completion wakes a waiting channel at the current machine cycle; final-word
  consumption, reset, and restore publish the matching low/derived state. A low
  line cancels DMA service instead of scheduling a status poll.
- A channel with `IO_GX_GPU_GP0` as its live read address keeps that address
  fixed, consumes the same mapped GPUREAD word datapath as the CPU, and writes
  each real little-endian word directly to RAM. If its word count outlives one
  C0 transfer, it remains BUSY and resumes on a later completion without ever
  treating the retained latch as payload.
- Save-state capture drains an already submitted accelerated readback where the
  host API permits it. Device capture otherwise stores backend-only SUBMITTED as
  logical PENDING; the current-format codec stores phase/fence/cursor/latch and
  READY result pixels and rejects SUBMITTED on the wire. Async completion checks
  its generation before writing any result byte.
- The mirrored TS/C++ current-format codec has one explicit 16 MiB wire
  capacity and rejects overflow before both encode and decode. Libretro reports
  a fixed header + 16 MiB envelope. Every save captures and encodes once, then
  writes its header and payload directly into the frontend buffer and clears
  the remaining suffix there, without a retained 16 MiB intermediate buffer or
  an extra copy.
- Every BMSX-owned result/staging/pack buffer, uniform, bind group and copy
  descriptor is retained. The WebGPU API's mapping promise and mapped typed view
  are consumed once with a bulkcopy. No full-frame CPU raster, CPU VRAM shadow,
  fake sync, stale fallback or `GameView` readback facade is allowed.
- Readback exchange and save state use the same little-endian pixel bytes, so
  restore bulk-copies the retained range instead of rebuilding u16 pixels in a
  host loop.

Reference basis: DuckStation
[`GPU::ReadGPUREAD`](https://github.com/stenzek/duckstation/blob/35bcff15276dfa474349ea199201d024469487a9/src/core/gpu.cpp#L1887-L1919),
[`GPU::UpdateDMARequest`](https://github.com/stenzek/duckstation/blob/35bcff15276dfa474349ea199201d024469487a9/src/core/gpu.cpp#L772-L827),
[`DMA::TransferDeviceToMemory`](https://github.com/stenzek/duckstation/blob/35bcff15276dfa474349ea199201d024469487a9/src/core/dma.cpp#L843-L919),
[`GPU::HandleCopyRectangleVRAMToCPUCommand`](https://github.com/stenzek/duckstation/blob/35bcff15276dfa474349ea199201d024469487a9/src/core/gpu.cpp#L3799-L3829),
[`GPU_HW::DownloadVRAMFromGPU`](https://github.com/stenzek/duckstation/blob/35bcff15276dfa474349ea199201d024469487a9/src/core/gpu_hw.cpp#L3452-L3513),
[`GPU_HW_ShaderGen::GenerateVRAMReadFragmentShader`](https://github.com/stenzek/duckstation/blob/master/src/core/gpu_hw_shadergen.cpp#L2880-L2943),
and MAME
[`psxgpu_device::gpu_read`](https://github.com/mamedev/mame/blob/2f09baf036f4c95b6a86407f7e826e6ca7dbaf78/src/devices/video/psx.cpp#L3403-L3445).

## Main checklist

### 1. Scope and direction

- [x] Treat GX/PSX-GPU/GTE as the replacement path, not an additional profile.
- [x] Keep PAL/NTSC 50Hz/60Hz display-mode ABI behavior visible.
- [x] Treat the current TS/C++ software/headless renderer as a serious backend,
  not a test toy.
- [x] Make the TS/C++ software/headless renderers consume the GX command buffer
  directly for the currently implemented command set, not as hidden fallbacks
  inside accelerated paths.
- [x] Remove the old RPU render passes from active presentation once GX is
  complete enough. WebGL, GLES2, TS headless/software, and C++ software no
  longer register or execute an RPU frame; WebGPU never registered one.
- [x] Move output quantization to host presentation state. The host menu no
  longer writes VDP MMIO and presentation no longer consumes `VdpDeviceOutput`.
  Retained host modes are RGB565 and MSX10 3:4:3; RGB777 is removed. WebGL,
  GLES2, WebGPU, TS headless and C++ software execute the same mode contract.
- [x] Remove host-only IDE/terminal framebuffer presentation ownership. The
  full-screen IDE owns its frame background; the BIOS monitor is system-ROM
  firmware that takes the primary GX scanout through ordinary GP0 commands.
  The VDP framebuffer texture and pass no longer exist.
- [x] Complete the retained host-UI publication boundary. Workbench and menu
  publish separate retained lanes rather than exposing the menu controller to
  render backends; WebGPU now renders both lanes natively and WebGL2 consumes
  the same allocation-conscious quad stream. Split-bundle headless execution
  proves quick-menu commands reach the backend. Live browser proof remains part
  of the deferred accelerated session.
- [x] Remove old VDP/RPU cart-visible ABI use after carts are migrated. Cartlib
  consumes GX-owned display metrics directly and the rejected Lua VDP/RPU
  firmware modules are gone rather than retained behind compatibility shims.

### 2. PSX GPU command/status/display parity

- [x] GP1 display-mode register masking and PSX dot-clock display sizing.
- [x] GPU info command range behavior.
- [x] Interlaced field drawing behavior in accelerated backends, including
  current-format restore of the three GPU-owned field/parity latches.
- [x] Weave interlaced scanout from a retained backend-owned field buffer in
  TS/C++ software, WebGL2, WebGPU, and GLES2. Only the current field is updated
  during steady-state scanout; progressive scanout does not allocate or execute
  the retained-field path. Mirrored vectors prove 480i source-row stepping,
  temporal retention, display disable, VRAM wrapping, and snapshot reprime.
- [x] Present 320x240, 256x192, and 256x212 directly from the latched
  GP1 display configuration in every software and accelerated backend. Do not
  scale an active range over a fixed host target and do not modify cart assets.
  Mirrored software vectors, libretro transitions, and GLES2/llvmpipe captures
  are green; live WebGL2/WebGPU browser proof remains deferred.
- [x] Texture disable.
- [ ] GPUREAD / VRAM-to-CPU command execution and ordering.
  - [x] Fix the device/backend owner, fence, completion, cursor, DMA and
    save-state contract before implementation.
  - [x] Implement the CPU GPUREAD contract in TS/C++ software, WebGL2, GLES2
    and WebGPU and validate the mirrored raw software vector without live
    browser execution.
  - [x] Feed GPUREAD into RAM through the custom DMA controller without polling
    or consuming the latch while GPUSTAT ready-to-send is low.
  - [ ] Run the same vector live against WebGL2, GLES2 and WebGPU.
- [ ] Complete GPUSTAT details and timing-visible bits against references.
  - [x] Route GP0(1Fh) through a real `IRQ_GPU` source edge. GP1(02h)
    deasserts GPUSTAT bit 24 without consuming the IRQ controller's pending
    latch; `IRQ_ACK` owns that latch. Repeated GP0(1Fh) words while the source
    stays asserted do not synthesize extra edges. TS/C++ raw MMIO tests mirror
    the full assert, system-ack, no-retrigger, GPU-ack and retrigger sequence.
  - [x] Model command execution time and FIFO-capacity-visible readiness with a
    central integer GPU scheduler, fixed FIFO, execution frontier and mirrored
    save-state. DMA grants at most sixteen word slots and resamples DREQ before
    each word; CPU GP0 stores use
    the MMIO write-ready line and jump to the device completion edge without
    polling, dropped words or producer-side waits.
- [ ] Complete GP0/GP1 command decode edge cases and command-buffer ordering.
  - [x] Distinguish machine/device reset from GP1(00h): both clear GPU
    registers, packet/FIFO state and the active readback request, while only
    machine reset clears the accepted backend log, regenerates the fixed raw
    VRAM power-on pattern, advances the shared unsigned 64-bit snapshot revision
    and clears GPUREAD to zero. GP1 reset retains accepted commands and received
    A0 payload alongside the GPUREAD latch and raw VRAM. The command buffer owns
    no separate VRAM-clear signal. Mirrored TS/C++ raw-VRAM tests cover the
    pattern digest, reset/save-state distinction and persistent-backend machine
    recreation.
  - [x] Make GP1(01h) abort active C0 readback state and its queued suffix.
    Pending fences retain the stable command prefix without a revision; a
    submitted/ready transfer invalidates its backend generation and publishes a
    command-stream revision. Mirrored tests cover ready/DMA lowering,
    stale completion rejection, queued-C0 removal, prior VRAM writes and resumed
    command processing. Abandoned image headers and partial polylines also
    truncate their uncommitted word suffix, while received image payload remains
    a partial upload command.
  - [x] Make GP1(00h/01h) also cut C0 during its decoded-but-not-yet-active
    device cycle. The command buffer truncates that marker at the existing
    execution frontier and the GPU cancels only its now-ownerless deadline;
    accepted draws and their deadlines, the GPUREAD latch, raw VRAM, and a C0
    still waiting behind a draw in the physical FIFO keep their direct hardware
    semantics. Mirrored immediate, queued, and save/restore regressions cover
    both GP1 transitions.
- [x] DMA interaction behavior beyond the register/status paths.
  - [x] RAM-to-GP0 DMA word streams feed the memory-mapped GX-GPU GP0 command
    port in TS and C++.
  - [x] GP0-to-RAM DMA consumes retained GPUREAD words only while the
    producer-driven ready line is high and resumes a paused channel on the next
    completion edge.
  - [x] Replace descriptor admission, tickets, queue progress and byte budgets
    with one live word-transfer channel. GP1 gates the GPU-owned DREQ lines;
    request-low discards unused grant slots, direct bus faults remain
    Memory-owned, and current-format save-state stores raw registers plus the
    real timing/grant latches.

### 3. Raster and VRAM behavior

- [x] Deterministic 1 MiB raw-VRAM power-on contents owned by GX device reset;
  every backend consumes the same retained snapshot and save-state restores the
  stored bytes rather than regenerating them.
- [x] Texture modulation math aligned to PSX behavior.
- [x] Fill rectangle masking and fill geometry wrapping.
- [x] Oversized primitive culling.
- [x] Overlapping VRAM-to-VRAM copy chunking.
- [x] Command-log retirement preserves backend VRAM while resetting consumed
  frame commands.
- [ ] Exact triangle/quad edge rules and fill convention.
  - [x] Mirror integer top-left coverage, half-open bounds, winding, textured
    outer edges, and single-blend quad seams in TS/C++ software raw-VRAM tests.
  - [x] Align WebGL2, GLES2, and WebGPU vertex transforms with PSX integer
    raster positions without changing raw CPU vertex/bounds representation.
  - [x] Replace exact barycentric/native polygon UV interpolation with the
    mirrored PSX 12-bit fixed gradient and half-texel seed in every backend.
  - [x] Replace exact barycentric/native Gouraud RGB interpolation with the
    same mirrored fixed-12 plane in every backend, without per-command buffers
    or accelerated CPU rasterization.
  - [ ] Run the same conformance vectors live against all accelerated backends.
- [ ] Exact rectangle/line/polyline raster rules.
  - [x] Truncate rectangle origins to signed 11-bit after applying the drawing
    offset in every active backend.
  - [x] Replace accelerated geometric line interpolation with the same
    fixed-point DDA coverage and Gouraud convention as TS/C++ software, including
    inclusive polyline joints and ordered read-VRAM writes.
  - [x] Wrap each software line sample to signed 11-bit and translate the matching
    visible coordinate bucket in every accelerated backend without CPU
    pixel-rasterization.
  - [ ] Run the line/polyline DDA, Gouraud, wrap, reject, and double-joint vectors
    live against WebGL2, GLES2, and WebGPU.
  - [ ] Resolve the DuckStation/Mednafen `x0 >= x1` versus `x0 > x1` vertical
    Gouraud tie against hardware; all BMSX backends deliberately follow the
    current DuckStation/software convention until then.
- [ ] Exact clipping, drawing offsets, drawing area, and negative coordinate cases.
  - [x] Cover normal negative coordinates plus E5 offsets, inclusive E3/E4
    clipping on every edge, and clipped textured-rectangle UV advance with
    mirrored TS/C++ raw-VRAM vectors.
  - [x] Keep fill commands outside E3/E4 and E6 drawing state in every backend.
  - [x] Implement raster-stage signed-11 wrapping for polygon output; do not
    pre-truncate its vertices because +1024 can be a valid exclusive edge and
    production PSX renderers wrap polygons during rasterization.
  - [ ] Decide the emulated PSX drawing-area Y hardware revision before changing
    the current 512-row VRAM clamp for 10-bit E3/E4 Y words.
  - [ ] Run the clipping/offset vectors live against accelerated backends.
- [ ] Exact texture sampling/window/CLUT edge cases.
  - [x] Mirror raw software vectors for E2 U/V replacement, direct16 page wrap,
    packed palette4/palette8 texels, and same-row CLUT wrap in TS/C++.
  - [ ] Run the same raw vectors live against WebGL2, GLES2, and WebGPU.
- [ ] Exact mask bit, blend, dither, semi-transparency, and store behavior.
  - [x] Keep both E6 bits in accelerated solid batch identity and sequence
    read-VRAM solid quad triangles with a destination refresh between them.
  - [x] Mirror raw software vectors for STP-gated texture stores, E6 solid-draw
    behavior, and representable overlapping solid quads in TS/C++.
  - [ ] Run the same mask/STP/blend/dither/store vectors live against WebGL2,
    GLES2, and WebGPU.
- [ ] Readback-visible VRAM contents after every accelerated operation.

### 4. GTE parity

This is the foundation gate for the later BSX GTE+. Checked coverage records
the current evidence; it is not permission to route around a newly discovered
PSX discrepancy or to start the GTE+ ABI early.

- [x] Broad raw COP2/GTE register and opcode implementation exists.
- [x] RTPS/RTPT, NCLIP, OP, MVMVA, depth, lighting/color, SQR, GPF/GPL families
  have focused coverage.
- [x] Consume IR0 as a signed raw halfword in GPF/GPL and every shared depth-cue
  opcode; mirror negative-IR0, GPL 44-bit wrap/FLAG, and save-state CYCLES-latch
  vectors in TS and C++.
- [x] Audit all 22 implemented canonical GTE opcodes against DuckStation,
  Mednafen, and MAME, then differential-test TS and C++ independently against
  all 1,100 runs in the pinned
  [JaCzekanski hardware log](https://github.com/JaCzekanski/ps1-tests/blob/f727802fead11f1daa7549285548392ef87749cb/gte-fuzz/gte_valid_0xc0ffee_50.log).
  Both owners match all 64 output register words in every run.
- [x] Fill missing edge cases for flags, saturation, divide overflow, MAC/IR
  behavior, and unusual register combinations.
- [x] Keep TS and C++ GTE behavior mirrored.

### 5. Backend parity

- [x] WebGL2 consumes the GX command buffer directly.
- [x] GLES2 consumes the mirrored GX command buffer directly.
- [x] TS software/headless consumes the GX command buffer directly.
- [x] C++ software backend consumes the mirrored GX command buffer directly.
- [x] Profile the release C++ libretro/software path before changing its
  rasterizer. Four unpaced 3,000-frame `bare_metal_cart` runs with audio and CRT
  postprocessing disabled measured the complete `retro_run` boundary, including
  machine execution, GX rasterization and scanout. Baseline, particles, echo and
  morph averaged 2.124 ms, 1.785 ms, 2.611 ms and 1.788 ms per frame; their
  maximum frames were 9.779 ms, 10.695 ms, 12.219 ms and 9.691 ms against the
  20 ms PAL budget. The temporary host timing probe was reverted. DuckStation,
  Mednafen and MAME confirm specialization and scanline spans as the mature next
  steps if target-hardware profiling later proves a problem, but this desktop
  measurement does not justify a speculative rasterizer rewrite now.
- [x] Profile the full 1,100-frame libretro/GLES2 `bare_metal_cart` timeline,
  including the scenes missed by the earlier short run. Baseline measured
  2.85 ms with five framebuffer copies/frame; Tera-Flare 12.24 ms with 70
  copies/frame; particles 14.20 ms with 72 average and 147 maximum copies.
  One representative particle frame spent 21.5 ms in copies and 2.1 ms in
  draws, with no `glReadPixels`.
- [x] Replace the shared accelerated O(primitives) destination-snapshot path.
  Use concrete GLES framebuffer-fetch/barrier capabilities where available,
  retained compatible-command streams in every backend, dirty/valid source
  coverage, and coalesced non-overlapping VRAM copies. Do not substitute naive
  expanded RGBA8 fixed blending unless chained raw 5-bit stores prove exact.
- [x] Route native GLES2 solid/line destination reads through
  `GL_NV_texture_barrier` when the context exposes both the exact extension and
  procedure. The shaders sample the attached raw-VRAM texture at the same pixel;
  the existing overlap splits remain the barrier boundaries. A steady particle
  frame drops from 147 sampletexturecopies to 1, while the full 1,030-frame
  barrier and forced-copy runs produce 146 byte-identical captures.
- [x] Preserve libretro ownership of extension procedure resolution. The core
  now forwards the frontend's `get_proc_address` together with its framebuffer
  getter instead of guessing through process-global symbols. This removes the
  unconditional null resolver on Windows and lets the retained NV barrier path
  exist there. A native regression proves callback identity; WSL D3D12 on the
  RTX 5070 Ti requests `glTextureBarrierNV` through that callback, passes all
  146 slowdown-timeline captures exactly, and completes three capture-free
  1,020-frame runs in 6.48--6.83 seconds wall time.
- [ ] Run that resolved NV path in the actual Windows RetroArch frontend before
  closing the reported RTX slowdown. `GL_EXT_shader_framebuffer_fetch` remains
  deliberately unimplemented: Mesa 25.2.8 llvmpipe has a confirmed zero-output
  color-fbfetch bug, while ANGLE documents that its advertised coherent
  emulation may order only between draw calls. Do not add a driver blacklist,
  runtime capability probe, or shader fallback in lieu of live proof.
- [x] Route native GLES2 textured draws through the same barrier only when the
  physical page/CLUT coverage is disjoint from the clipped destination. Aliased
  texture sources retain the explicit sampletexture path. Tera-Flare drops from
  62.75 average/65 maximum copies to exactly one per frame; all 146 deterministic
  captures remain pixel-identical to both forced-copy mode and the preceding
  retained-dirty implementation.
- [x] Replace the accelerated last-source rect/hash/tile cache with retained
  raw-to-sample dirty coverage in GLES2, WebGL2 and WebGPU. Raw writes mark
  clipped bounds after their draw; page/CLUT/destination reads copy and clear
  the retained dirty union only on intersection. The forced-copy particle
  window drops from 72 average/147 maximum copies to 40.43/94, while the native
  barrier path remains at one non-destinationcopy. Barrier and forced-copy runs
  are pixel-identical over all 146 captures, and CRT-disabled output is
  pixel-identical to the preceding accelerated implementation. WebGPU also
  submits older encoded GP0 work before direct CPU `queue.writeTexture`
  uploads, preserving transfertexture and raw-VRAM command order.
- [x] Replace the accelerated per-row VRAM-copy vertex stream in GLES2, WebGL2
  and WebGPU with bounded physical X/Y runs. The per-frame 320x240
  `bare_metal_cart` present-copy now emits one quad/24 floats/96 bytes instead
  of 240 quads/5,760 floats/23,040 bytes; wrap uses at most nine quads per
  transfer area, while diagonal overlap retains its ordered chunk boundaries.
  All 146 deterministic captures in the 1,030-frame GLES2 timeline remain
  byte-identical to the preceding backend. Four interleaved capture-free A/B
  runs reduce mean full-timeline user CPU from 10.59 s to 9.97 s (5.9%).
- [x] Retain consecutive compatible line commands across GLES2, WebGL2 and
  WebGPU instead of uploading uniforms and vertices once per GP0 command.
  State changes, non-line commands, capacity and read-VRAM overlap remain hard
  flush boundaries, so interleaved primitive order is unchanged. Baseline and
  echo fall from 26 to 3 line draws, flare from 24 to 2, particles from
  96.63 average/97 maximum to 73.78/75, and morph from 32 to 9. All 146 raw
  captures remain byte-identical. Single-worker llvmpipe whole-run CPU stays
  essentially flat (6.70 s to 6.66 s), so this removes driver calls without
  pretending line submission was the remaining dominant software-GPU cost.
- [x] Retain compatible WebGPU solid commands using the same state and
  read-VRAM-overlap boundaries as GLES2/WebGL2. Fills, rectangles and polygons
  now share one uniform upload, vertex upload and render pass per batch, while
  read-VRAM quads retain their ordered two-triangle path. All new batch state
  and bounds are retained and covered by the no-heap/no-GC audit; live browser
  execution remains in the explicitly deferred WebGPU validation session.
- [x] Retain compatible textured commands across GLES2, WebGL2 and WebGPU.
  Exact affine UV-plane state now travels in retained per-vertex data instead
  of per-triangle uniforms. Pipeline state, source reads from pending
  destinations and self-aliasing remain hard ordering boundaries. Opaque GLES2
  batches use the stable sample texture; read-VRAM batches preserve ordered
  per-triangle barriers, matching DuckStation's full-barrier retained batches.
  Baseline textured uploads/draws fall from 13/26 to 8/8, Tera-Flare uploads
  fall from 32 to 3 while its true 62--64 dependency draws remain, and echo
  falls from 16/32 to 9/14. Both native-barrier and forced-copy GLES2 runs keep
  all 146 captures exact. Four interleaved single-worker runs over the
  982-frame capture-free slowdown timeline reduce mean user CPU from 6.37 s to
  6.23 s and total CPU from 6.75 s to 6.56 s; live browser execution remains
  deferred.
- [x] Remove the paced-libretro feedback loop instead of feeding frontend wall
  time into the hardware scheduler. The core no longer registers the optional
  frame-time callback; one `retro_run()` advances one runtime-timed machine
  frame. The direct host uses absolute monotonic deadlines and skips only an
  overdue presentation while retaining machine and audio advancement. Its
  reproducible 16,000-call particle profile and fixed-size, allocation-free
  timing histograms measure 15,500 post-warm-up hidden GLES2 frames at 10.522 ms
  average, 18 ms p95, 20 ms p99 and 115.980 ms maximum; 188 presentations were
  skipped during catch-up. That run exposed 82,624 frames discarded by a copied
  browser-style SDL queue cap. The cap and false full-consumption report are now
  removed. A fixed callback FIFO owner blocks both SDL and ALSA producers until
  every frame is retained, with no hot-path allocation. Its full 16k soak exposed
  172,480 SDL underrun frames and 2,190 late presentation skips while both the
  deadline clock and blocking audio were still pacing. Audio is now the sole
  master when active; the current 1,000-call soak has zero underrun frames and
  zero skipped presentations. A repeated full soak and live target audio remain
  open rather than hidden by a drop policy. Hidden SDL avoids WSLg focus theft and
  therefore does not prove visible compositor swap behavior. The GLES2 blend planner also no longer duplicates
  the line rasterizer or walks `O(commands^2 * line_length)` pixels: conservative
  clipped bounds preserve dependencies, retained per-layer links visit each
  command once, and line dither remains part of batch identity. A clean
  `e1bfd1a29` A/B keeps all 146 deterministic captures byte-identical.
- [x] Restore direct-host protocol ownership instead of advertising ignored
  capabilities. Pixel format requests now accept only the two implemented
  layouts; AV geometry is established before hardware context reset without
  invented 256x240/1280x720 fallback targets; context destruction runs while the
  core and GL context are alive; and V2/V1/legacy core-option definitions feed a
  retained option register that preserves explicit CLI overrides and update
  state. These are cold configuration owners, not per-frame DTO validation.
- [ ] Remove the remaining private keyboard/focus/cart-start direct-host ABI.
  Standard libretro keyboard delivery and a frontend-owned timeline origin must
  replace it without a boot-delay heuristic or a new compatibility facade.
- [x] Give GLES2 dynamic vertex submission a retained stream-buffer lifecycle.
  One 2,654,208-byte driver stream now serves solid, line, textured and transfer
  vertices. Existing fixed solid/line CPU arenas append until a real dependency
  boundary, bulk-upload once per submission epoch and replay a fixed packet arena
  in original order. The cursor survives frame boundaries and storage is
  orphaned only at capacity wrap: fourteen times in the 1,000-frame particle
  soak, never once per frame. Against `8905288ce`, `glBufferSubData` falls from
  32,982 to 7,563 calls with identical uploaded bytes/draws/vertices, the median
  of three Release runs falls from 6.79 s to 6.32 s, and all 146 full-timeline
  captures remain byte-identical. No heap allocation, second vertex copy, VBO
  rotation or cosmetic orphan wrapper was added.
- [x] Give the GLES2 blend planner one retained prepared-command owner. Line
  preparation now decides rejection, direction, raster case, normalized
  endpoints/colors and exact clipped bounds once; rectangles retain their
  decoded quad and bounds once. The dependency pass compares those bounds and
  layer emission writes vertices from the retained payload rather than decoding
  and tessellating every command again. Line and solid layer batches retain
  separate draw bounds, and all ordinary solid/line batches now pass their
  already-produced bounds to both sample synchronization and dirty marking, so
  the renderer no longer rescans their vertex arenas. The fixed command arena
  adds no heap or per-frame allocation. A temporary full-timeline counter found
  450 plans, 19,620 planned commands and 1,376,370 integer rectangle comparisons,
  with a maximum of 146 commands and 10,585 comparisons in one plan. Roughly
  1,336 comparisons per frame do not justify retained spatial-bin state, so the
  measured predecessor scan stays. Three interleaved single-worker Release A/B
  runs remain flat at 5.63 s versus 5.66 s mean user CPU, and all 146 GLES2
  captures remain byte-identical.
- [ ] Re-profile CPU-to-VRAM submission with an upload-heavy cart workload before
  changing it again. The existing owner already packs raw VRAM in one retained
  staging buffer and emits bounded physical wrap rectangles; the particle soak
  issues only three texture uploads in 1,000 frames and therefore cannot justify
  or validate further cross-command coalescing.
- [ ] Keep WebGL2/GLES2 behavior synchronized for every new GX command.
- [ ] Wire the existing TS/C++ software/headless renderer to the same GX/PSX
  contract as oracle/backend, not as a fallback inside GPU backends.
- [ ] Build conformance vectors that every backend can run or be compared
  against.
- [ ] Keep TS headless and C++ libretro software/headless runs green for
  render-visible GX/PSX changes.

### 6. VDP/RPU removal

- [x] Identify every active VDP/RPU presentation registration and machine output
  dependency.
- [x] Remove the dormant WebGL, GLES2, TS headless/software, and C++ software RPU
  presentation executors. GX command buffers are the only cart graphics input
  consumed by host backends; WebGPU already had no RPU executor.
- [x] Remove the orphaned host-side XF/LPU/MFU/JTU transform, lighting, fog, and
  frame-shared structures plus the never-enabled axis-gizmo and dead scene
  math/material/shadow code from both runtimes.
- [x] Move output quantization from VDP MMIO/VOUT into the host presentation
  owner and remove the mirrored VDP view-snapshot consumers.
- [x] Move host-only framebuffer presentation to its real owner without a
  compatibility facade. The full-screen IDE emits its own background and host
  overlay lanes remain transparent outside their content; the mirrored
  framebuffer texture/pass plumbing is removed.
- [x] Remove mapped VDP memory and its timing/register/readback/save-state
  ownership, then delete the mirrored VDP and IMGDEC devices without a facade.
- [x] Retire old VDP/RPU firmware/system paths after cart migration planning.
  The cart-visible Lua firmware path and its prelude exports are removed; the
  residual machine implementation is removed.
- [x] Remove old VDP/RPU and IMGDEC tests that only protected the failed
  renderer-descriptor and runtime decode ABIs.
- [x] Record BSX with its own native GTE+/GPU as the long-term hardware goal,
  while keeping its depth, morphing, local-memory and surface contracts deferred
  behind the accepted PSX-GTE foundation. Do not preserve the old VDP/RPU ABI.

### 7. Cart migration

- [x] Migrate BIOS boot image rendering to GX.
- [x] Migrate `emptycart` to GX.
- [x] Migrate `fade_probe` to GX blend primitives.
- [x] Migrate `vblanktest` to GX/GPUSTAT-visible behavior.
- [x] Migrate `nemesis_s` boot, texture upload, clear, and sprite/tile draws to
  GX/PSX. Its cart programs the VRAM destination and the ROM carries one shared
  raw direct16 texture span; runtime atlas identity and decode are removed.
- [x] Migrate `renderhwtest` to direct GX primitive programming, including a
  cart-visible raw PSX textured affine quad smoke.
- [x] Migrate `2025` engine/cart rendering to GX, including cart-owned
  raw VRAM working sets, background transition uploads, affine parallax
  sprites, fixed-function PSX transition/combat blending, texture-modulated
  fades, and existing custom visual submission on the GX path. Transition and
  combat-result fades no longer pretend that the PSX GPU supports arbitrary
  ARGB alpha: they author subtractive/additive GP0 passes and opaque texture
  brightness directly. Firmware exposes separate opaque and semi-transparent
  primitive emitters instead of treating ARGB alpha as a PSX blend factor. The
  raw bare-metal cart now emits precomputed GP0 texture command words and owns
  every semi-transparent pass's opcode and ABR mode explicitly; it neither uses
  ARGB alpha as a blend factor nor compares signed register words with wide host
  literals. The transition ink and combat-results background now use the cart's
  intended packed Persona-blue palette words. Consecutive-frame gates lock the
  exact RGB555 scanout in TS headless, C++ software, and GLES2/llvmpipe. The
  montage overlay also reaches black before the separate post-fade state when
  the incoming fade is skipped, instead of ending in a full-screen hard cut.
- [x] Migrate `pietious` engine/cart rendering. Its producer-only image group is
  packed at ROM build time under an explicit Palette4 asset contract as native
  PSX 4-bpp texture data plus CLUT, DMA-uploaded into a cart-authored VRAM slot,
  and consumed by retained GX tile sources. The per-frame tile path emits raw
  textured rectangles without rebuilding tables, decoding RGBA pixels, or using
  a VDP stream shim. Every image is page-local and each blit emits one primitive.
- [x] Replace the current `bare_metal_cart` RPU descriptor smoke path with
  GX/GTE-owned PSX-style primitives. `bare_metal_cart` now programs raw GP0,
  GP1, and GTE registers directly instead of going through BIOS/system GX
  helpers, including direct GP0 Gouraud triangles, raw direct16 textured affine
  quads, RTPT projection, AVSZ3/NCLIP depth ordering, and an offscreen VRAM
  scene copied/presented through a post-pass. The cart now also has a
  left/right keyboard carousel of raw GX/GTE effect scenes for AVSZ3-sorted
  exploding crystal shards, a textured projected Tera-Flare shell using
  RTPT/RTPS/NCLIP/AVSZ4, a depth-cued particle storm using RTPS/DPCS/DPCT/INTPL,
  a Gouraud-lit idol using NCT/NCDT/NCCT, a separate framebuffer echo
  post-pass scene, and a morph/skinning/lighting plus near-plane divide-torture
  scene that uses split raw GTE transforms, NCT/NCDT/NCCT lighting, RTPT/RTPS
  projection, and semi-transparent GP0 primitives. The render-parity timeline now
  captures consecutive frame windows for the scenes instead of relying only on
  sparse phase samples.
- [x] Fixed GX presentation so partial/held host presentations no longer
  publish or retire a half-built GP0 command stream. GX command buffers now
  distinguish queued commands from the command count published for presentation,
  and TS/C++ software/GLES/WebGL/headless backends consume only the published
  count.
- [x] Fixed WebGPU GX backend command-encoder resource ownership so each
  recorded VRAM render pass reads the vertex/uniform slice it was recorded
  with. The WebGPU backend no longer overwrites one shared uniform/vertex buffer
  slot repeatedly before submitting the encoder for a frame. WebGL fallback
  browser captures for `bare_metal_cart` and `2025` are coherent; WSL/headless
  Edge cannot visually validate WebGPU because its swapchain/shared-image path
  returns black frames, so live WebGPU still needs a real browser check.
- [x] Keep the current raw GX/GTE carousel as the `bare_metal_cart` coverage
  owner. Do not recreate the rejected historical free-fly/side-camera behavior.
- [x] Replace remaining cart graphics programming with PSX-style GPU/GTE
  programming. Cartlib/prelude no longer publishes the old VDP/RPU ABI, the
  seven Lua VDP/RPU firmware modules are removed, and carts consume GX-owned
  display metrics instead of retired VDP MMIO words.
- [ ] Keep BSX extensions separate and post-parity.

## Recommended next functional slices

Pick one vertical slice and finish it before committing:

1. **Visible GX migration regressions**: finish live host-UI and accelerated
   browser scanout proof when a real browser is available.
2. **Accelerated feedback performance**: run the frontend-resolved NV barrier
   path in the real Windows RetroArch context. If that concrete context does not
   expose NV texture barrier, measure its actual extensions and ordering before
   choosing another GPU feedback mechanism; do not infer one from the GPU name
   or an extension string alone.

## Per-slice rules for agents

Every implementation slice should:

1. Start from the current diff and recent commits. Do not restart the direction.
2. Study serious reference implementations for the touched PSX behavior before
   coding. Prefer mature emulator codebases such as DuckStation, Mednafen,
   MAME/psx, PCSX-Redux, or no$psx docs where appropriate.
3. Change the owner files directly. Do not add provider/injection/facade layers.
4. Keep TS and C++ machine behavior mirrored where both cores own the behavior.
5. Keep accelerated backends accelerated. Do not CPU-raster pixels for WebGL or
   GLES2. Software/headless may rasterize because it is the
   explicit software backend, not an accelerated backend.
6. Add focused tests for the behavior and update both TS/C++ tests when the
   contract is mirrored.
7. Run the smallest relevant validation bundle while iterating, then the broader
   bundle before commit. For render-visible changes, include TS headless and C++
   libretro software/headless validation.
8. Ask before coding if the slice hits GPUREAD/readback semantics, origin rules,
   host-GPU acceleration constraints, or a conflict between PSX behavior and BMSX
   fantasy goals.

## Validation menu

Use the smallest relevant set during iteration. Before a meaningful committed
slice, prefer a bundle like:

```text
npm run compile:machine
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/gx_gpu.test.ts tests/lua/gx_gte.test.ts tests/lua/machine_model_registry.test.ts tests/lua/runtime_timing.test.ts
cmake --build build-cpp-tests --parallel $(nproc)
ctest --test-dir build-cpp-tests --output-on-failure
npm run audit:core-parity
npm run audit:architecture-boundaries:strict
cmake --build build-libretro-host-wsl --parallel $(nproc)
npm run headless:game -- <rom>
npm run run:libretro-host:wsl:headless -- <rom-or-timeline-as-needed>
npm run test:2025-frame-scan
npm run test:render-parity
npm run check:indent
git diff --check
```

For render-facing slices, add an actual TS headless smoke/screenshot, C++
libretro software/headless smoke, or backend parity capture when the behavior is
visually observable.
