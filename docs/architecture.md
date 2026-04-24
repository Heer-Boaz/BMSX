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

The current state does not allow doing feature work and instead requires a giant cleanup.
The code is a complete mess of bullshit and junk and crap. The majority of the code is a tangled web of dependencies and spaghetti code. The code is a nightmare to read and understand. The code is a disaster to maintain and debug. The code is a catastrophe to extend and improve. The code is a tragedy to work with and use. The code is a horror to look at and deal with. The code is a shame to the programming profession and the software industry. The code is a disgrace to the developers who wrote it and the users who rely on it. The code is a failure of engineering and design. The code is a waste of time and resources. The code is a burden on everyone involved with it.

Examples of total bullshit and junk and crap:
```
	if (engine.m_state != EngineState::Running && engine.m_state != EngineState::Paused) {
		return;
	}

	const bool pausedPresent = engine.m_state == EngineState::Paused;
	const bool runtimePresentPending = !pausedPresent && consumePresentation(m_presentationScratch);
	const bool shouldPresent = pausedPresent || runtimePresentPending;
	if (!shouldPresent) {
		return;
	}
```
Another example of total bullshit and junk and crap:
```
namespace bmsx {
namespace {

const TextureParams DEFAULT_TEXTURE_PARAMS{};

} // namespace

TextureHandle getVdpDisplayFrameBufferTexture() {
	return vdpTextureByUri(FRAMEBUFFER_TEXTURE_KEY);
}

TextureHandle getVdpRenderFrameBufferTexture() {
	return vdpTextureByUri(FRAMEBUFFER_RENDER_TEXTURE_KEY);
}

static void swapVdpFrameBufferTexturePages() {
	swapVdpTextureHandlesByUri(FRAMEBUFFER_TEXTURE_KEY, FRAMEBUFFER_RENDER_TEXTURE_KEY);
#if BMSX_ENABLE_GLES2
	VdpGles2Blitter::invalidateFrameBufferAttachment();
#endif
}

void uploadVdpFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	updateVdpTexturePixels(FRAMEBUFFER_RENDER_TEXTURE_KEY, pixels, width, height);
}

void uploadVdpDisplayFrameBufferPixels(const u8* pixels, u32 width, u32 height) {
	updateVdpTexturePixels(FRAMEBUFFER_TEXTURE_KEY, pixels, width, height);
}
```

## Largest Boundary Problems

### 1. VDP/Render Boundary Needs A Native Video-Hardware Boundary

The VDP/render boundary remains the most important boundary to keep disciplined,
but the main problem is not that `render/vdp` exists. Serious emulator code does
not usually keep the video device pure by bouncing hot video writes through a
host callback layer. MAME-style screen/update paths and Dolphin's
VideoCommon-style consolidation both point to the same shape: graphics
emulation is part of the video hardware subsystem, while thin backend-specific
code sits underneath it.

For BMSX, that means the VDP video subsystem may own accelerated backend
textures and may write them directly from the VRAM/MMIO hot path. What must not
survive is VDP/video code reaching through `engineCore`, `EngineCore::instance()`,
`Runtime::instance()`, or generic host queues to discover the world at the moment
it needs to render.

The important contract now is performance-sensitive: framebuffer VRAM writes
must reach the backend texture directly, without adding a mandatory CPU
write-through pass, while still keeping the cart-visible contract as MMIO/VRAM
instead of host texture APIs.

Status: closed as an architecture boundary. `render/vdp` remains the VDP video
hardware implementation, but it no longer discovers host/runtime singletons from
inside the VDP video path.

Current evidence:

- `VDP::initializeFrameBufferSurface()` still creates a framebuffer-backed
  image slot and initializes display readback state from inside the device, but
  framebuffer texture creation and upload are now render-owned.
- In the TS runtime, direct framebuffer VRAM writes call the render framebuffer
  texture-region upload path immediately. The hot path does not probe for a
  texture and does not write through a CPU framebuffer mirror first.
- In the C++ runtime, render setup installs the concrete framebuffer
  texture-region writer on the VDP. Direct framebuffer VRAM writes call that
  writer immediately. The VDP does not include render headers or lazily discover
  render state during the write.
- Framebuffer texture creation is an explicit runtime/render initialization
  step in both TS and C++. Render context restore creates/seeds render and
  display framebuffer textures, then VDP execution/presentation paths assume
  that contract.
- VDP atlas/slot textures follow the same split: setup initializes the textures
  and uploads full slot contents; render sync resizes only on surface-size
  changes and otherwise uploads dirty rows directly to existing backend
  textures.
- `VDP::captureSaveState()` and `VDP::restoreSaveState()` now correctly include
  VDP surface pixels, VRAM staging, render framebuffer pixels, and display
  framebuffer pixels. Because direct framebuffer VRAM writes bypass the CPU
  mirror, save/readback captures framebuffer pages from the backend texture at
  the boundary where serialized state is requested.
- The GLES2 blitter now syncs rendered framebuffer pixels back into VDP-owned
  readback state after execution, so MMIO readback and save-state capture no
  longer depend on render backend reads from inside the VDP device.
- VBLANK frame commit now returns an explicit framebuffer-presentation signal
  from the VDP, and the render-side VDP presentation helper performs the texture
  page swap. The device no longer presents render framebuffer pages itself.
- The native VDP fault helper no longer includes `core/engine.h`; it depends on
  the shared primitive fault macro only, so device-side validation does not pull
  the host shell into VDP compilation.
- `render/vdp/texture_transfer` now owns concrete VDP texture memory installed
  during render setup. Framebuffer and atlas upload/readback helpers use that
  texture memory directly instead of looking up `engineCore` or
  `EngineCore::instance()`.
- TS and C++ VDP blitter execution receive frame timing explicitly from the
  runtime execution edge. They no longer import runtime singletons for frame
  time or backend discovery.
- `src/bmsx/render/vdp` and `src/bmsx_cpp/render/vdp` no longer contain
  `engineCore`, `Runtime.instance`, `EngineCore::instance()`,
  `Runtime::instance()`, `core/engine`, or `machine/runtime/runtime`
  dependencies.

Risk:

The easy wrong fix is a generic callback, service, host, provider, or facade
layer that hides the dependency while keeping the same confused ownership. The
other wrong fix is a pretty ownership diagram that forces framebuffer writes
through CPU shadow memory before the backend sees them. Both are rejected. The
clean boundary must preserve direct backend texture writes and move discovery
to initialization time.

Desired direction:

- Keep VDP-owned state on the VDP side: registers, VRAM, DMA submit state,
  frame timing, framebuffer identity, atlas slot ids, skybox ids, committed
  visual state, and save-state pixel payloads.
- Move backend ownership and host texture reads/writes to the render side.
- Treat `render/vdp` as the native VDP video-hardware implementation, not as a
  generic host renderer and not as a callback sink installed into the device.
- Let framebuffer VRAM writes use an explicit fast texture-memory contract:
  immediate backend subregion writes against textures that were created during
  runtime/render setup.
- Initialize framebuffer and VDP slot textures at runtime/render setup
  boundaries. Do not hide first-use texture creation behind `ensure` helpers in
  VDP execution, render sync, or presentation paths.
- Preserve CPU framebuffer pixels only where they are semantically required:
  software rendering, save-state capture/restore, and explicit readback. Do not
  make CPU shadow writes mandatory for the normal backend-texture hot path.
- Avoid solving this with a generic service/provider/facade layer. The boundary
  should be concrete and named after the data being owned.

### 2. Frame Loop Still Mixes Host/IDE/Render Concerns With Machine Tick

The frame loop is narrower than it was, but it still mixes machine execution
with host shell, IDE, and render-side transient state.

Current evidence:

- `src/bmsx_cpp/machine/runtime/frame/loop.cpp` no longer includes
  `core/engine.h` and no longer calls `EngineCore` for reboot handling.
  Program reload and BIOS-to-cart boot transitions now sit behind the existing
  `CartBootState` owner.
- The native frame loop still includes `machine/runtime/render/state.h`, but it
  no longer imports `render/shared/queues.h` directly. Back-queue cleanup after
  VBLANK IRQ wake is routed through the runtime render-state owner.
- Both TS and C++ frame loops now enter current-frame render transient reset
  through `beginRuntimeRenderFrame()` in the runtime render-state owner. That
  removes the direct hardware-lighting dependency from the frame loop, but the
  machine tick still decides when render transient state begins.
- TS machine runtime faults now use `src/bmsx/machine/runtime/runtime_fault.ts`
  instead of importing the IDE Lua pipeline only to construct machine faults.
- `src/bmsx/machine/runtime/frame/loop.ts` no longer imports IDE workbench mode
  or render queues directly. Overlay gating reads the runtime's
  `executionOverlayActive` state, runtime errors report through
  `Runtime.handleLuaError(...)`, and back-queue cleanup enters through the
  runtime render-state owner.
- `src/bmsx/machine/runtime/frame/host.ts` still owns TS IDE input ticking, but
  its runtime fault reporting now also goes through `Runtime.handleLuaError(...)`
  instead of calling IDE workbench fault presentation directly.
- TS and C++ frame loops no longer flush runtime asset edits from inside the
  machine tick. Host frame pumps flush them after the scheduled machine step and
  before presentation, keeping texture/audio host work outside CPU/VBLANK
  advancement.
- TS and C++ save/resume/runtime-reset paths no longer import
  `render/shared/queues` directly to clear transient submissions. They enter
  through the runtime render-state owner.
- The native host frame pump no longer discovers `EngineCore::instance()` or
  probes `Platform::microtaskQueue()` during each frame. The libretro platform
  supplies the concrete engine and microtask queue when it calls the host frame
  pump, and the pump flushes that queue directly.
- The native host frame pump now lives under `src/bmsx_cpp/core/host_frame.cpp`
  instead of `src/bmsx_cpp/machine/runtime/frame/host.cpp`. The machine runtime
  frame folder contains the machine tick loop, while the host shell owns input
  polling, host timing counters, microtask flushing, asset edit flushing, and
  presentation.
- The native IMGDEC device no longer includes `core/engine.h` or looks up
  `EngineCore::instance().platform()` when starting decode work. The machine
  construction path passes the concrete microtask queue into the device.
- TS scheduler/CPU debug tick telemetry now reads the host frame time already
  supplied to the runtime frame pump, instead of importing `EngineCore` only to
  query `$.platform.clock`.
- TS and C++ save-machine-state restore now both flush runtime asset edits after
  restoring machine/frame-scheduler/VBLANK state.

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

- `src/bmsx_cpp/machine/firmware/globals.cpp` no longer owns ROM asset-range
  search logic for the cart-facing `resolve_*_rom_asset_range` builtins. That
  lookup now lives in `src/bmsx_cpp/machine/memory/asset_memory.cpp`, matching
  the TS side where `RuntimeAssetState` owns ROM range resolution.
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

Current evidence:

- Workspace Lua override application now receives the cart project root
  explicitly. Early cart boot no longer depends on `engineCore.cart_project_root_path`
  having already been populated, and path joining remains strict about receiving
  concrete string segments.
- Workspace file/path/sync code now lives in `ide/workspace/files.ts` and
  `ide/workspace/path.ts` without importing the runtime engine. The runtime-facing
  `ide/workspace/workspace.ts` adapter applies those pure operations to Lua
  registries and editor resource state.

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
