# BMSX Architecture Boundary Review

Status: current architecture review, not a quality rule.
Last checked: 2026-04-24.

BMSX is already usable as a quasi-professional fantasy-console codebase. The
important remaining work is not broad cleanup for its own sake. The largest
architecture pressure is that the top-level system still reads more like
engine + firmware + host shell than a strict driver/device-tree model.

That shape is not preferred for BMSX. Host, platform, render, IDE, and workspace
conveniences must not become the cart-facing hardware contract.

This review uses MAME's general posture as the reference point:
https://github.com/mamedev/mame. MAME treats source code as hardware
documentation, with machine state and devices owning emulated behavior. BMSX
should not imitate MAME wholesale, but the same discipline applies to
machine-vs-host ownership. MAME save-state guidance is also a useful pressure
test: a useful emulator save state must account for CPU state, device state,
RAM including video/palette/sound RAM, timing state, peripheral state, and
banking/driver-specific state.

## Healthy Baseline

The codebase already has the pieces needed to keep building:

- `src/bmsx/machine` and `src/bmsx_cpp/machine` contain real machine concepts:
  CPU/runtime state, memory, MMIO, VDP, input, DMA-style device work, scheduling,
  VBLANK, firmware, and capture/restore hooks.
- The preferred cart-visible flow is clear:

```text
cart Lua -> BIOS/firmware or cart library -> MMIO/RAM -> machine device -> host output
```

- Recent hardware notes such as `docs/geo_overlap2d_pass_v1.md` show the right
  style: concrete MMIO contracts, memory formats, deterministic behavior, and
  explicit division between hardware work and gameplay work.
- Runtime save-state plumbing now exists in both TS and C++, and libretro has
  serialization entry points wired to it. The next question is proof and
  completeness, not whether the platform functions are placeholders.

The current state does not justify pausing feature work for a giant cleanup
phase. It does justify doing the next architecture fixes in the right order,
because new features will otherwise keep growing new direct edges into
`EngineCore`, render helpers, IDE state, workspace state, or platform state.

## Largest Boundary Problems

### 1. VDP Still Knows Too Much About Render State

The C++ VDP remains the most important boundary to clean first. Recent work has
removed some of the older direct presentation shape: the VDP header no longer
pulls in broad render submission types or exposes `GameView`-style commit APIs.
The remaining leak is narrower and more concrete: the device still directly
coordinates render-side texture/readback helpers.

Current evidence:

- `src/bmsx_cpp/machine/devices/vdp/vdp.cpp` includes
  `render/vdp/framebuffer.h`, `render/vdp/slot_textures.h`,
  `render/vdp/surfaces.h`, and `render/vdp/texture_transfer.h`.
- `VDP::initializeFrameBufferSurface()` still creates a framebuffer-backed
  image slot and initializes display readback state from inside the device.
- `VDP::captureSaveState()` and `VDP::restoreSaveState()` now correctly include
  VDP surface pixels, VRAM staging, render framebuffer pixels, and display
  framebuffer pixels, but they do so by calling render-side framebuffer and
  slot-texture helpers.
- `VDP::readSurfacePixels(...)` still reads the framebuffer through
  `readVdpFrameBufferPixels(...)` when the requested surface is the framebuffer.

Risk:

The VDP becomes a render coordinator instead of an emulated device. That makes
save-state determinism, libretro portability, headless tests, and TS/C++ parity
harder. It also makes new GPU features tempting to implement as host shortcuts
instead of device-visible behavior.

Desired direction:

- Keep VDP-owned state on the VDP side: registers, VRAM, DMA submit state,
  frame timing, framebuffer identity, atlas slot ids, skybox ids, committed
  visual state, and save-state pixel payloads.
- Move backend ownership and host texture reads/writes to the render side.
- Let the VDP publish explicit surface/readback state that render consumes after
  the machine step.
- Avoid solving this with a generic service/provider/facade layer. The boundary
  should be concrete and named after the data being handed over.

### 2. Frame Loop Still Mixes Host/IDE/Render Concerns With Machine Tick

The frame loop is narrower than it was, but it still mixes machine execution
with host shell, IDE, and render-side transient state.

Current evidence:

- `src/bmsx_cpp/machine/runtime/frame/loop.cpp` includes `core/engine.h`,
  `render/shared/hardware/lighting.h`, and `render/shared/queues.h`.
- The native frame loop still calls back to `EngineCore` for reboot handling.
- Both TS and C++ frame loops clear hardware lighting at frame start, which is
  semantically correct for current-frame light submissions but still shows that
  render transient state is being managed from the machine loop.
- `src/bmsx/machine/runtime/frame/loop.ts` imports IDE workbench mode, runtime
  asset edit flushing, render queues, hardware lighting, and IDE Lua fault
  handling.

Risk:

The machine runtime is not just ticking the machine. It is also coordinating
IDE overlay behavior, render transient state, reboot routing, asset edit
flushes, and fault presentation. That makes the runtime harder to reason about
as deterministic emulated hardware.

Desired direction:

- Split host frame pump from machine tick.
- Host code supplies time, input snapshot, run-gate state, and presentation
  preferences before the machine step.
- Machine runtime advances CPU/devices/VBLANK using explicit frame inputs.
- Screen/render consumes committed machine output after the machine step.
- IDE overlay and terminal input should stay outside the machine tick contract.
- Keep current-frame render submissions explicit; do not make them persistent
  just to avoid a frame-loop dependency.

### 3. Firmware, Resource, And Devtool APIs Need Sharper Boundaries

Firmware setup still reaches through `EngineCore` for cart/system assets,
manifests, project roots, view settings, and clock functions. The Lua source
inspection APIs are now split into `devtools`, which is the right direction,
but that boundary must stay devtool-only.

Current evidence:

- `src/bmsx_cpp/machine/firmware/globals.cpp` resolves ROM asset ranges through
  `EngineCore::instance().cartAssets()` and `systemAssets()`.
- The same file builds globals from `loadedCartManifest()`,
  `loadedCartEntryPath()`, `cartAssets()`, `machineManifest()`,
  `cartProjectRootPath()`, and `view()`.
- `src/bmsx/machine/firmware/devtools.ts` exposes source inspection APIs and
  deliberately checks workspace cached source and dirty buffers before packed
  source.
- `src/bmsx_cpp/machine/firmware/devtools.cpp` mirrors the devtool source
  inspection surface on the native side.

Risk:

Cart-visible API can silently become "whatever host/runtime data is convenient"
instead of a stable console contract. Devtools need access to workspace source,
but normal cart hardware should not gain that capability by accident.

Desired direction:

- Separate ROM/resource lookup as a firmware or machine resource contract, not
  a direct `EngineCore` query.
- Keep `devtools.*` as a deliberately isolated source/workspace API.
- Keep presentation flags and viewport state behind a deliberate firmware or
  MMIO contract if carts are meant to observe them.
- Preserve the rule that cart code does not call `engine.*` or host shortcuts.

### 4. EngineCore Is Still A Large Startup And Runtime Meeting Point

`EngineCore.init(...)` performs system asset layer setup, workspace overlay
assignment, platform/view host setup, input initialization, browser backend
selection, cart index parsing, `GameView` construction, GPU backend creation,
texture manager setup, render pass registration, resize wiring, initial
render-target layout, default texture initialization, debug setup, exit
handling, and runtime initialization.

`EngineCore.start()` still owns platform frame scheduling and the top-level
runtime frame drive.

Risk:

Because so much starts at `EngineCore`, other systems naturally reach back into
it for whatever they need. That reinforces the engine-shell shape and makes
ownership drift harder to notice.

Desired direction:

- Keep `EngineCore` as a startup coordinator, not the source of truth for
  machine-visible behavior.
- Move concrete ownership closer to the subsystem that owns the data.
- Prefer explicit data handoff over new wrapper layers.
- Do not add compatibility bridges or host-provider abstractions while shrinking
  this surface.

### 5. Libretro Save State Is Wired, But Needs Proof

The libretro platform serialization entry points are no longer placeholders:

- `LibretroPlatform::getStateSize()` returns the encoded runtime save-state
  byte size when a runtime is loaded and initialized.
- `LibretroPlatform::saveState(...)` captures runtime bytes into the libretro
  buffer.
- `LibretroPlatform::loadState(...)` applies runtime bytes, reapplies host view
  state, resets the libretro audio queue, and clears wall-frame timing state.

Recent save-state work also includes CPU/runtime state, RAM/string handles,
input, frame scheduler/VBLANK state, game-view state, render state, and VDP
surface pixels.

Risk:

Save-state support can look wired while still missing deterministic behavior
under real libretro save/load cycles. The highest-risk areas are VDP render
surfaces, display/render framebuffer page state, scheduler/VBLANK timing,
queued/transient render work, audio queue state, and source/runtime edge cases
such as empty strings.

Desired direction:

- Add focused save/load tests that mutate RAM, string handles, VDP surfaces,
  framebuffer pixels, atlas slots, input state, scheduler/VBLANK state, and cart
  persistent state before restoring.
- Exercise libretro serialization through the platform boundary, not only the
  lower-level runtime codec.
- Exclude host-only render backend handles, platform objects, transient queues,
  IDE/editor state, and cached presentation resources.
- Treat serialization requirements as part of new device design.

### 6. TS/C++ Parity Is Selective, Not Systematic

The C++ implementation mirrors important machine structure, and recent work has
kept several runtime/save-state/render paths aligned. Parity should still be
claimed subsystem by subsystem, not globally.

Risk:

Assuming global parity can hide differences in firmware API behavior, VDP
submission semantics, input timing, resource lookup, serialization, and render
presentation. Those differences become expensive when libretro becomes a serious
target instead of a parallel experiment.

Desired direction:

- Track parity at subsystem level: memory/MMIO, VDP, input, scheduler/VBLANK,
  firmware globals, devtools/source lookup, ROM/resource lookup, save state, and
  host test behavior.
- Prefer small deterministic parity tests over broad claims.
- Do not add compatibility fallbacks to mask divergence.

### 7. IDE/Editor Layering Is Large Debt, But Not The First Console Blocker

The IDE/editor remains a sizeable layering hotspot, especially around UI,
input, contrib features, render paths, runtime error support, workspace source,
and semantic services.

Risk:

Editor feature work can slow down because UI, input, contrib, rendering, and
runtime support know too much about each other. This matters, but it is less
fundamental than the machine/render/firmware boundary leaks.

Desired direction:

- Clean IDE layering in focused slices.
- Keep editor/runtime/debugger support out of cart-visible hardware contracts.
- Keep workspace source ownership professional: dirty editor buffers are the
  authoritative devtools source, but not a normal cart runtime capability.
- Do not let IDE convenience APIs leak into firmware or runtime semantics.

## Recommended Work Order

1. Finish the VDP/render boundary cleanup.
2. Split host frame pump from machine tick.
3. Separate firmware/resource/devtool APIs from host `EngineCore` queries.
4. Prove libretro save-state serialization end to end.
5. Audit TS/C++ parity subsystem by subsystem.
6. Clean IDE/editor layering after the machine boundaries are safer.

This order protects future feature work. The goal is not to make the codebase
look abstractly tidy. The goal is to keep BMSX's cart-visible machine contract
fast, explicit, deterministic, and hard to accidentally bypass.

## Guardrails

- Do not introduce defensive-check clutter around internal contracts.
- Do not add legacy fallbacks or compatibility aliases.
- Do not solve boundary leaks with generic facade/host/provider/service layers.
- Do not move hot-path work behind allocation-heavy helpers.
- Do not treat analyzer warnings as a reason to make product code worse.
- When a boundary is intentionally local and exceptional, document it at the
  owner instead of adding rename-sensitive global exceptions.
