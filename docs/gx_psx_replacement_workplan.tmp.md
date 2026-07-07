# Temporary GX/PSX Replacement Workplan

Status file for agents working on the active BMSX graphics replacement goal.
This is **not** a stable ABI contract and is **not** more authoritative than the
live checkout. It is a temporary execution checklist so agents can see the
current direction, completed slices, known blockers, and next work.

Last refreshed: 2026-07-07
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
- WebGL2, GLES2, future WebGPU, and the existing TS/C++ software/headless
  backends consume the same GX command/GTE contract.
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
- Do not design or edit save-state representation/schema/capture/restore in this
  slice of work.
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

Legacy VDP/RPU still exists and must not be treated as completion:

- TS/C++ VDP device trees under `machine/*/machine/devices/vdp/`
- VDP/RPU render helpers under `machine/ts/render/vdp/`
- Old VDP/RPU tests and firmware guards, including `tests/cpp/vdp_ingress_test.cpp`
- Presentation registration still contains VDP/RPU paths; removing those is a
  later replacement milestone, not done yet.

## Current high-level state

GTE is relatively far along. GPU is in the middle of the replacement work. The
old VDP/RPU has not yet been removed from the active machine/presentation world.
This is not close to done if the goal is read literally.

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
- WebGL2, GLES2, and TS/C++ software execution for the currently handled command
  kinds.
- GX command logs can be retired after presentation without clearing backend
  VRAM, so carts can build frame commands without losing uploaded texture VRAM.
- BIOS boot image rendering, `emptycart`, `fade_probe`, `vblanktest`, and
  `nemesis_s` now use GX-visible graphics paths instead of active VDP/RPU frame
  submission. `renderhwtest` now also programs GX directly for its primitive and
  affine textured-quad smoke path.

Known gap: `GX_GPU_COMMAND_READ_VRAM_TO_CPU` is emitted by the GPU command buffer,
but accelerated backends currently do not execute a GPUREAD/readback command
case. This must be resolved deliberately.

Known migration blocker: `machine/firmware/system/gx_image.lua` is still a
single-residency atlas helper. It uploads one decoded atlas into a fixed PSX
texture area. That is enough for BIOS boot art and `nemesis_s`, but not enough
for text-heavy or multi-atlas carts such as `2025` and `pietious` without either
a real PSX VRAM residency plan or explicit cart-managed uploads. Do not paper
over this with per-frame whole-atlas uploads or a CPU-side accelerated-backend
texture shadow.

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
- [ ] Remove the old VDP/RPU from active presentation once GX is complete enough.
- [ ] Remove old VDP/RPU cart-visible ABI use after carts are migrated.

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
- [ ] Exact rectangle/line/polyline raster rules.
- [ ] Exact clipping, drawing offsets, drawing area, and negative coordinate cases.
- [ ] Exact texture sampling/window/CLUT edge cases.
- [ ] Exact mask bit, blend, dither, semi-transparency, and store behavior.
- [ ] Readback-visible VRAM contents after every accelerated operation.

### 4. GTE parity

- [x] Broad raw COP2/GTE register and opcode implementation exists.
- [x] RTPS/RTPT, NCLIP, OP, MVMVA, depth, lighting/color, SQR, GPF/GPL families
  have focused coverage.
- [ ] Audit all implemented GTE opcodes against a serious PSX reference.
- [ ] Fill missing edge cases for flags, saturation, divide overflow, MAC/IR
  behavior, and unusual register combinations.
- [ ] Keep TS and C++ GTE behavior mirrored.

### 5. Backend parity

- [x] WebGL2 consumes the GX command buffer directly.
- [x] GLES2 consumes the mirrored GX command buffer directly.
- [x] TS software/headless consumes the GX command buffer directly.
- [x] C++ software backend consumes the mirrored GX command buffer directly.
- [ ] Keep WebGL2/GLES2 behavior synchronized for every new GX command.
- [ ] Add WebGPU as another implementation of the same GX contract, not a new
  profile.
- [ ] Wire the existing TS/C++ software/headless renderer to the same GX/PSX
  contract as oracle/backend, not as a fallback inside GPU backends.
- [ ] Build conformance vectors that every backend can run or be compared
  against.
- [ ] Keep TS headless and C++ libretro software/headless runs green for
  render-visible GX/PSX changes.

### 6. VDP/RPU removal

- [ ] Identify every active VDP/RPU presentation registration and machine output
  dependency.
- [ ] Replace active presentation routing with GX output when GX is sufficient.
- [ ] Retire old VDP/RPU firmware/system paths after cart migration planning.
- [ ] Remove or quarantine old VDP/RPU tests that only protect the failed
  renderer-descriptor ABI.
- [ ] Keep useful BMSX fantasy hardware ideas documented for later GX extensions,
  but do not preserve the old ABI.

### 7. Cart migration

- [x] Migrate BIOS boot image rendering to GX.
- [x] Migrate `emptycart` to GX.
- [x] Migrate `fade_probe` to GX blend primitives.
- [x] Migrate `vblanktest` to GX/GPUSTAT-visible behavior.
- [x] Migrate `nemesis_s` boot, atlas decode/upload, clear, and sprite/tile
  draws to GX/PSX.
- [x] Migrate `renderhwtest` to direct GX primitive programming, including a
  cart-visible raw PSX textured affine quad smoke.
- [ ] Migrate `2025` engine/cart rendering. This needs GX texture residency and
  PSX textured polygon/affine sprite coverage, not VDP compatibility aliases.
- [ ] Migrate `pietious` engine/cart rendering. This needs GX tile/text/image
  residency and tile-run ownership, not a VDP stream shim.
- [x] Replace `bare_metal_cart` RPU descriptor demo with GX/GTE-owned PSX-style
  primitives: direct GP0 Gouraud triangles, raw direct16 textured affine quads,
  and cart-visible RTPT projection through `system/gx_gte.lua`.
- [ ] Replace remaining cart graphics programming with PSX-style GPU/GTE
  programming.
- [ ] Keep BMSX extensions separate and post-parity.

## Recommended next functional slices

Pick one vertical slice and finish it before committing:

1. **GX image residency for multi-atlas carts**: define a PSX-VRAM texture
   residency model in `system/gx_image.lua`/cart-owned GPU programming that can
   support cart atlas plus system font usage without per-frame whole-atlas
   uploads, CPU-side accelerated-backend shadows, or hidden fallbacks. Use this
   as the unlock for `2025` or `pietious` migration.
2. **Migrate a real 2025 or pietious image path onto GX textured polygons**:
   use the covered raw textured quad/affine primitive, and add the missing
   residency/tile-run ownership needed by that cart slice instead of adding VDP
   aliases.
3. **GPUREAD/readback contract**: only start after an explicit design decision.
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
5. Keep accelerated backends accelerated. Do not CPU-raster pixels for WebGL,
   GLES2, or future WebGPU. Software/headless may rasterize because it is the
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
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/gx_gpu.test.ts tests/lua/gx_gte.test.ts tests/lua/machine_model_registry.test.ts tests/lua/runtime_timing.test.ts tests/lua/firmware_raw_words.guard.test.ts
cmake --build build-cpp-tests --parallel $(nproc)
ctest --test-dir build-cpp-tests --output-on-failure
npm run audit:core-parity
npm run audit:architecture-boundaries:strict
cmake --build build-libretro-host-wsl --parallel $(nproc)
npm run headless:game -- <rom>
npm run run:libretro-host:wsl:headless -- <rom-or-timeline-as-needed>
npm run test:render-parity
npm run check:indent
git diff --check
```

For render-facing slices, add an actual TS headless smoke/screenshot, C++
libretro software/headless smoke, or backend parity capture when the behavior is
visually observable.
