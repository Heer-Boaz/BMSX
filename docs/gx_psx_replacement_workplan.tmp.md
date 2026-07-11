# Temporary GX/PSX Replacement Workplan

Status file for agents working on the active BMSX graphics replacement goal.
This is **not** a stable ABI contract and is **not** more authoritative than the
live checkout. It is a temporary execution checklist so agents can see the
current direction, completed slices, known blockers, and next work.

Last refreshed: 2026-07-11
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
The target is real PSX-GTE/GPU parity first, then BMSX fantasy extensions later.

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
- Do not expose BMSX fantasy extensions through the ABI yet. Preserve useful
  ideas for later, after PSX parity is real.

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
- GX firmware helpers: `machine/firmware/system/gx_gpu.lua`,
  `machine/firmware/system/gx_image.lua`

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
  The unchanged raw-UV vertex stream retains sample-cache bounds. Quads refresh
  read-VRAM between triangle draws when required; rectangles keep their lean
  direct integer UV path.
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

Known gap: `GX_GPU_COMMAND_READ_VRAM_TO_CPU` is emitted by the GPU command buffer,
but accelerated backends currently do not execute a GPUREAD/readback command
case. This must be resolved deliberately.

Cart texture residency is owned by the ROM texture producer and PSX GPU
firmware. It is independent of the active GP1 display dimensions, and the GTE
does not participate in texture or atlas handling.
`machine/firmware/system/gx_image.lua` supports the resident system atlas plus
one resident cart atlas in PSX VRAM. Every system/cart atlas is emitted by the
ROM producer as native RGB555/STP GP0 upload words and DMA streams those ROM
words directly to GP0; runtime PNG decode and mapped RGBA texture staging are
not part of atlas residency. Atlas PNGs remain tooling previews and are not
packed as runtime ROM payloads.
The `2025` cart owns explicit direct16 texture-bank upload points for its
transitions, background changes, and combat working-set changes. Each active
full-screen background is its own ROM-produced bank, the sprites that coexist
through combat share one explicit bank, and the opaque all-out screen is a
separate transition bank. It crosses a VBlank before a bank change so the
preceding GX command buffer is presented before the new GP0 upload stream is
submitted. `pietious` now uses a
manifest-required, ROM-produced native PSX 4-bpp texture plus CLUT and GP0
upload stream. Its atlas bypasses the legacy RGBA residency planner and has no
CPU texture-staging allocation. It no longer decodes a whole RGBA atlas at boot
or submits VDP tile streams.

The ROM atlas is a packing artifact, not a universal runtime residency unit.
`pietious` has a compact stable 4-bpp atlas/CLUT working set, while `2025` uses
smaller producer-owned banks that match what is simultaneously visible. Its
full-screen direct16 backgrounds legitimately bulk-upload at scene transitions;
they are no longer incidental members of multi-background auto-atlases. A cart
that needs several independently changing texture sets must introduce explicit
fixed VRAM page/CLUT slots at the GPU residency owner instead of growing another
whole-atlas swap wrapper. No migrated cart currently requires that extra
runtime mechanism.

For the current assets this changes a background transition from a generated
718,812--896,976-byte multi-background upload to the active image's
155,872--199,224-byte stream. The transition regression follows the authored
fade/montage timing and no longer treats the duration of the oversized DMA as a
required black-frame hold.

## Hard open design point: GPUREAD / VRAM-to-CPU

This is the next dangerous boundary.

Acceptable directions:

- Model GPUREAD as real GPU readback from the accelerated backend VRAM/render
  target, with explicit command ordering and completion semantics.
- Defer full GPUREAD until the command/readback contract is designed.

Rejected direction:

- Do not add a CPU-side raster/VRAM shadow as the source of truth for accelerated
  backends. That violates the 100% host-GPU accelerated requirement and creates a
  second graphics machine.

If implementation reaches this point and the correct contract is unclear, stop
and ask before coding.

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
  workbench overlay owns its opaque base through the existing retained rect
  pool; the VDP framebuffer texture and pass no longer exist.
- [x] Remove old VDP/RPU cart-visible ABI use after carts are migrated. Cartlib
  consumes GX-owned display metrics directly and the rejected Lua VDP/RPU
  firmware modules are gone rather than retained behind compatibility shims.

### 2. PSX GPU command/status/display parity

- [x] GP1 display-mode register masking and PSX dot-clock display sizing.
- [x] GPU info command range behavior.
- [x] Interlaced field drawing behavior in accelerated backends.
- [x] Texture disable.
- [ ] GPUREAD / VRAM-to-CPU command execution and ordering.
- [ ] Complete GPUSTAT details and timing-visible bits against references.
- [ ] Complete GP0/GP1 command decode edge cases and command-buffer ordering.
- [ ] DMA interaction behavior beyond the currently tested register/status paths.
  - [x] RAM-to-GP0 DMA word streams feed the memory-mapped GX-GPU GP0 command
    port in TS and C++.

### 3. Raster and VRAM behavior

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
  compatibility facade. The workbench overlay seeds a pooled opaque base rect;
  the mirrored framebuffer texture/pass plumbing is removed.
- [x] Remove mapped VDP memory and its timing/register/readback/save-state
  ownership, then delete the mirrored VDP and IMGDEC devices without a facade.
- [x] Retire old VDP/RPU firmware/system paths after cart migration planning.
  The cart-visible Lua firmware path and its prelude exports are removed; the
  residual machine implementation is removed.
- [x] Remove old VDP/RPU and IMGDEC tests that only protected the failed
  renderer-descriptor and runtime decode ABIs.
- [ ] Keep useful BMSX fantasy hardware ideas documented for later GX extensions,
  but do not preserve the old ABI.

### 7. Cart migration

- [x] Migrate BIOS boot image rendering to GX.
- [x] Migrate `emptycart` to GX.
- [x] Migrate `fade_probe` to GX blend primitives.
- [x] Migrate `vblanktest` to GX/GPUSTAT-visible behavior.
- [x] Migrate `nemesis_s` boot, atlas upload, clear, and sprite/tile draws to
  GX/PSX. The ROM now carries the native GP0 upload stream; runtime atlas decode
  is removed.
- [x] Migrate `renderhwtest` to direct GX primitive programming, including a
  cart-visible raw PSX textured affine quad smoke.
- [x] Migrate `2025` engine/cart rendering to GX, including cart-owned
  producer-owned working-set banks, background transition uploads, affine parallax
  sprites, fixed-function PSX transition/combat blending, texture-modulated
  fades, and existing custom visual submission on the GX path. Transition and
  combat-result fades no longer pretend that the PSX GPU supports arbitrary
  ARGB alpha: they author subtractive/additive GP0 passes and opaque texture
  brightness directly. Firmware exposes separate opaque and semi-transparent
  primitive emitters instead of treating ARGB alpha as a PSX blend factor. The
  raw bare-metal cart now emits precomputed GP0 texture command words and owns
  every semi-transparent pass's opcode and ABR mode explicitly; it neither uses
  ARGB alpha as a blend factor nor compares signed register words with wide host
  literals.
- [x] Migrate `pietious` engine/cart rendering. Its cart atlas is packed at ROM
  build time under an explicit Palette4 asset contract as native PSX 4-bpp
  texture data plus CLUT and GP0 upload commands, DMA-uploaded directly to GPU
  VRAM, and consumed by retained GX tile sources. The per-frame tile path emits
  raw textured rectangles without rebuilding tables, decoding RGBA pixels, or
  using a VDP stream shim.
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
- [ ] Keep BMSX extensions separate and post-parity.

## Recommended next functional slices

Pick one vertical slice and finish it before committing:

1. **GPUREAD/readback contract**: only start after an explicit design decision.
   Accelerated backends must read back from real backend VRAM/render targets with
   command ordering semantics; do not add a CPU shadow as the source of truth.

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
