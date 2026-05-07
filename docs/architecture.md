# BMSX Architecture Boundary Review

Status: current architecture review, not a quality rule.
Last checked: 2026-05-07.

BMSX is not currently in a healthy feature-development state. The problem is
larger than architecture boundaries: the code quality inside ordinary functions
and methods is also bad enough to block normal feature work. The current
working assumption is that most code must be treated as suspect until it has
been read, simplified, and proven to follow the lean BMSX style.

The cleanup cannot be limited to moving files or drawing better subsystem
boxes. A boundary can look cleaner while each function remains defensive,
wrapper-heavy, lazily initialized, null-normalized, callback-routed,
allocation-happy, or hidden behind analyzer exceptions. That still counts as
bad code and must not be used as a foundation for more feature work.

The top-level system also still reads more like engine + firmware + host shell
than a strict driver/device-tree model.

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

## Current Blocker

The codebase still has useful pieces, but those pieces are embedded in a broad
quality failure. The current state requires a cleanup phase before ordinary
feature work is acceptable.

- `src/bmsx/machine` and `src/bmsx_cpp/machine` contain real machine concepts:
  CPU/runtime state, memory, MMIO, VDP, input, DMA-style device work, scheduling,
  VBLANK, firmware, and capture/restore hooks.
- The preferred cart-visible flow is clear:

```text
cart Lua -> BIOS/firmware or cart library -> MMIO/RAM -> machine device -> host output
```

- ROM/resource lookup belongs on the Lua side of that boundary. The runtime maps
  system, cart, and overlay ROM bytes into memory; BIOS Lua interprets the ROM
  header and TOC through normal memory reads during cart initialization. Cart
  Lua may use BIOS lookup helpers, or parse the cart TOC itself, because the TOC
  is cart-visible ROM data rather than host runtime state.
- Host runtimes, including the TS and C++ runtimes, must not own a parallel
  resource registry for cart-visible data. Later workbench live updates can
  replace cart or overlay TOC bytes at a host edge and let BIOS/cart Lua rebuild
  lookup state from memory; that keeps live editing compatible with the same
  console-visible contract.
- Compiled Lua/YAML is source material, not mutable machine state. The ROM
  program asset `__program__` is a linked object image with `.text` instruction
  words/protos, `.rodata` literals/module-proto tables/static module paths,
  empty `.data`/`.bss` sections until mutable image data is introduced, and
  explicit relocation metadata. The symbols asset `__program_symbols__` remains
  debug/code metadata and never counts as RAM.
- The TS/C++ ownership map for this slice is intentionally mirrored:
  `src/bmsx/machine/program/loader.ts` and
  `src/bmsx_cpp/machine/program/loader.h/.cpp` own the `PROGRAM_IMAGE_ID`,
  `PROGRAM_SYMBOLS_IMAGE_ID`, `PROGRAM_BOOT_HEADER_VERSION`, `ProgramImage`,
  `EncodedValue`, section structs, and `inflateProgram()` contracts; `src/bmsx/machine/program/linker.ts`
  and `src/bmsx_cpp/machine/program/linker.h/.cpp` merge the same sections and
  return `LinkedProgramImage.programImage`; `src/bmsx/ide/runtime/lua_pipeline.ts`
  and `src/bmsx_cpp/machine/runtime/runtime.cpp` inflate sections at boot and
  install module-proto maps from `.rodata`.
- ROM package header constants and the `CartRomHeader` wire layout are likewise
  owned by `src/bmsx/rompack/format.ts` and
  `src/bmsx_cpp/rompack/format.h`. Loaders consume those constants; they do not
  redeclare magic bytes or header sizes locally.
- ROM TOC wire constants are owned by `src/bmsx/rompack/toc.ts` and
  `src/bmsx_cpp/rompack/toc.h`: magic/header/entry sizes, invalid sentinels,
  operation ids, and asset-type ids live there. The TS encoder
  `src/bmsx/rompack/tooling/toc_encode.ts` and the C++ decoder
  `src/bmsx_cpp/rompack/toc.cpp` consume those constants instead of open-coded
  schema numbers.
- Layered ROM source lookup is mirrored in `src/bmsx/rompack/source.ts` and
  `src/bmsx_cpp/rompack/source.h/.cpp`: both build id/path maps to entry
  indexes, resolve overlays through the same delete-blocking rule, and return
  payload-tagged records plus direct byte views from the owning cartridge layer.
  Generated host atlas artifacts follow the same filename contract in TS/C++:
  `host_system_atlas.generated.ts`, `host_system_atlas.generated.h`, and
  `host_system_atlas.generated.cpp`.
- Runtime RAM accounting follows the same boundary: `CPU.setProgram()` maps
  program const-pool strings and global/module/debug names as ROM-owned strings,
  zero-upvalue proto references are static text labels, and only runtime-created
  strings/tables/native handles/captured closures/upvalue cells increase the
  Lua heap component of `sys_ram_used`. Captured closures still allocate their
  closure/upvalue state; non-capturing const functions do not allocate per
  materialization.
- Save-state wire parity for this slice lives in the same relative files:
  `src/bmsx/machine/runtime/save_state/schema.ts`,
  `src/bmsx_cpp/machine/runtime/save_state/schema.h/.cpp`,
  `src/bmsx/machine/runtime/save_state/codec.ts`, and
  `src/bmsx_cpp/machine/runtime/save_state/codec.cpp`. The shared wire version
  is `9`; the string-pool entry field is `tracked`; ROM-owned strings remain
  untracked while runtime-materialized strings restore as tracked RAM.
- World/mundo content should follow the same object-image rule: room templates,
  maps, transitions, and export tables belong in `.rodata` records with offsets
  or pointers, while room load instantiates only active mutable state into RAM.
  `romdir.data()` remains for explicit decoded-data APIs, not as the internal
  representation of compiled world structures.
- Recent hardware notes such as `docs/geo_overlap2d_pass_v1.md` show the right
  style: concrete MMIO contracts, memory formats, deterministic behavior, and
  explicit division between hardware work and gameplay work.
- Runtime save-state plumbing now exists in both TS and C++, and libretro has
  serialization entry points wired to it. The next question is proof and
  completeness, not whether the platform functions are placeholders.

That useful baseline does not make the code good. Much of the code is still
hard to read, hard to debug, and hard to change because behavior is smeared
across unrelated owners and because many small functions are not honest units
of work. The function-level quality problem is first-class architecture debt.

Feature work is blocked unless it directly removes or proves one of these
problems:

- defensive internal checks that hide broken ownership instead of enforcing a
  contract;
- one-line forwarding wrappers, callback thunks, service/provider/facade
  shapes, and fake helpers that rename work without owning it;
- lazy `ensure` initialization in steady-state code paths;
- optional chaining, `typeof` checks, catch fallbacks, and nullish-to-null
  normalization around values that should be guaranteed by design;
- temporary arrays, objects, closures, or string work in hot emulator/runtime
  paths;
- duplicated state predicates, repeated lifecycle checks, and boolean soup that
  should be named once as a real state-machine transition or lifecycle query;
- cross-layer imports and singleton discovery that make local code depend on
  the whole engine shell;
- analyzer skip lists, name-based exemptions, usage-based exemptions, or broad
  suppressions that hide bad code instead of making local exceptions explicit.

Passing the quality scanner is not enough. The scanner has already hidden bad
patterns when it used name/usage skips, so every cleanup slice must be checked
by reading the touched code and by asking whether the functions became simpler,
more direct, better owned, and at least as fast.

Examples of current bad code shape:
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
```
void LibretroPlatform::setPlatformPaused(bool paused) {
    if (paused == m_platform_paused) {
        return;
    }
    m_platform_paused = paused;
    m_has_wall_frame_timestamp = false;
    if (!m_engine) {
        return;
    }
    if (paused) {
        if (m_engine->isRunning()) {
            m_engine->pause();
        }
        if (auto* sound = m_engine->soundMaster()) {
            sound->pauseAll();
        }
    } else {
        if (m_engine->state() == EngineState::Paused) {
            m_engine->resume();
        } else if (m_engine->state() == EngineState::Initialized && m_rom_loaded) {
            m_engine->start();
        }
        if (auto* sound = m_engine->soundMaster()) {
            sound->resume();
        }
    }
}
```

These examples are not merely ugly formatting. They show the larger disease:
state is queried and reinterpreted in scattered places, including duplicated
checks of the same state transition. In the first example, `Running`/`Paused`
is checked once as an admission guard, then `Paused` and not-paused presentation
state are recomputed immediately afterward under new local names. That should
be one owned lifecycle decision, not repeated condition fragments. The second
example shows host/platform logic reaching into engine state and accumulating
guard branches instead of making ownership and lifecycle transitions explicit.

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
dirty VDP-owned rows and the render bridge uploads those rows before execution
or page present, without reintroducing a generic scene API or host texture API
as cart-visible ingress.

Status: current cleanup target. The VDP/render singleton-discovery and renderer-callback leaks are being replaced by a stricter device/host-output boundary: the VDP device owns registers, latches, VRAM slot state, frame submission, fault latches, and explicit host-output transactions; render code consumes those transactions and acks execution tokens.

Current evidence:

- Cart-visible VDP ingress is MMIO/VRAM/DMA/VBlank only. The old runtime-side scene adapter `machine/runtime/vdp_submissions` has been removed in both TS and C++; TS `GameView` host/editor sprite/rect/poly/glyph submissions stay in a zero-copy render queue instead of being translated into VDP register writes. The native C++ host/editor 2D overlay path has no consumer, so those submissions do not enter a black-hole render queue and are not counted as VDP/machine output.
- `src/bmsx/render/shared` and `src/bmsx_cpp/render/shared` are render-side feature queues only. Boundary tests fail on `writeVdpRegister`, `consumeDirectVdpCommand`, `VDP_REG_`, or VDP register-file imports in those directories, and they also fail if renderer-side code writes `IO_VDP_REG_*` or `IO_VDP_CMD`.
- `machine/runtime` no longer imports render submission/font types for VDP command emission. Boundary tests fail on `render/shared/submissions`, `render/shared/bitmap_font`, `core/font`, or `vdp_submissions` in the runtime VDP path.
- The VDP device code does not import framebuffer or host render modules. Framebuffer/texture upload, page presentation, and backend synchronization sit on the render/runtime side of the host bridge. TS and C++ upload dirty framebuffer rows before page presentation; presentation helpers no longer receive a raw VDP object just to flip framebuffer pages.
- VDP host output is an explicit `VdpHostOutput` read/ack transaction: the renderer reads one output object/value, consumes the ready execution queue/BBU RAM/camera/SBX/dither/dirty-surface/framebuffer handles from that output, and acks execution with the same token. TS no longer returns a reused mutable singleton output object; C++ returns a value. The renderer still receives handles to VDP-owned buffers, so future hardening should add generation/frozen-snapshot semantics only if a concrete race appears.
- TS and C++ VDP expose the same public host-bridge names for this contract: `readHostOutput()` and `completeHostExecution(...)`, alongside the MMIO/DMA/VRAM entry points, frame/VBlank progression, save-state capture/restore, and surface-dirty clear.
- TS and C++ VDP expose cart-visible fault latches as VDP status registers: `IO_VDP_STATUS` carries the fault bit, `IO_VDP_FAULT_CODE` / `IO_VDP_FAULT_DETAIL` carry the sticky-first reason, and `IO_VDP_FAULT_ACK` is write-one-to-clear. Save-state stores the sticky fault code/detail plus device state, not raw transient status pins.
- Cart-originating VDP faults latch and cancel/drop device work instead of throwing host exceptions. Packet/header/count problems use `VDP_FAULT_STREAM_BAD_PACKET`; direct submit state errors use `VDP_FAULT_SUBMIT_STATE`; unknown command doorbells use `VDP_FAULT_CMD_BAD_DOORBELL`; busy submit rejection uses `VDP_FAULT_SUBMIT_BUSY`; DEX source faults use `VDP_FAULT_DEX_SOURCE_SLOT` or `VDP_FAULT_DEX_SOURCE_OOB`; invalid DEX scale and LINE width use their DEX fault codes; SBX/BBU faults use their unit-specific codes.
- Current per-unit fault policy is explicit and test-covered: direct DEX command faults drop the command and keep the open direct frame; DEX faults reached while replaying a sealed FIFO/DMA stream abort that sealed stream frame; FIFO/DMA stream parser faults abort the stream frame; SBX frame-seal faults reject the frame; BBU packet faults reject the packet/stream frame; submit-busy faults reject the attempt without mutating the visible frame.
- Exceptions are reserved for emulator bugs and impossible internal states, such as broken save-state schema, impossible host transaction invariants, null host buffers, or internal surface registration mistakes.
- `IO_VDP_DITHER` is a live VDP register. MMIO writes update the live latch directly in both runtimes; the old `syncRegisters()` read-self-back pass is gone.
- VDP VRAM power-on garbage is seeded from explicit machine/boot entropy words instead of `Math.random`, `Date.now`, or host wall-clock state.
- The 19-word `IO_VDP_CMD_ARG0` latch bank is the DEX/2D blitter ingress, not the whole VDP frontend. Direct MMIO writes and FIFO `REG1`/`REGN` replay feed the same latches, `IO_VDP_CMD`/FIFO `CMD` doorbells snapshot those latches, registers 10 and 11 are raw `DRAW_LAYER`/`DRAW_PRIORITY`, and register 12 is `DRAW_CTRL` for DEX flip/PMU control.
- Current parallax status is DEX/PMU-owned parallax execution. PMU register writes latch raw bank words. DEX resolves the selected bank into per-BLIT `dstX`/`dstY`/scale geometry when it latches BLIT work, and DEX/LINE faults are surfaced through VDP fault latches.
- Camera, PMU, SBX, and BBU state are real VDP unit state. SBX ingress is either the `IO_VDP_SBX_*` register window plus commit doorbell or a sealed `SKYBOX` packet. BBU ingress is the sealed `BILLBOARD` packet stream. Render backends consume resolved host-output state; they do not validate or program VDP device state.
- `src/bmsx/render/vdp` and `src/bmsx_cpp/render/vdp` remain the renderer/backend side of the VDP host bridge. They may upload textures, execute ready blitter queues, present framebuffer pages, and clear dirty-surface pins through the explicit VDP host-output contract; they must not be imported by `machine/devices/vdp`.

Risk:

The easy wrong fix is a generic callback, service, host, provider, or facade
layer that hides the dependency while keeping the same confused ownership. The
other wrong fix is a pretty ownership diagram that forces framebuffer writes
through CPU shadow memory before the backend sees them. Both are rejected. The
clean boundary must preserve direct backend texture writes and move discovery
to initialization time.

The legacy high-level VDP scene-packet ABI is gone. BIOS and cart code that still wants to submit DEX work must emit raw `VDP_PKT_REG*` plus `VDP_PKT_CMD` register/doorbell streams or use BIOS helpers that emit those raw packets. BIOS helpers accept raw framebuffer colors and write split layer/priority registers; they do not convert RGBA components or pack layer/priority values.

Desired direction:

- Keep VDP-owned state on the VDP side: registers, VRAM, DMA submit state,
  frame timing, framebuffer identity, atlas slot ids, skybox ids, committed
  visual state, and save-state pixel payloads.
- Model VDP work as named hardware units rather than one universal register
  frontend: DEX owns the 2D latch ingress/FIFO replay, PMU owns parallax/motion
  bank registers and BLIT resolve, SBX owns skybox face state, MSU owns mesh
      submissions, BBU owns billboard packet decode, source resolve, and per-frame instance
  limits, FBM owns framebuffer/present/readback, and
  VOUT owns device quantize/CRT output. Existing render passes remain the
  backend bridge outputs for those units.
- Keep PMU bank register state VDP-owned. DEX must resolve PMU output before
  backend handoff. Render backends must consume resolved VDP command geometry
  and must not source parallax timing or rig values from host renderer globals.
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

### 2. Frame Pump Split From Machine Tick

Status: complete for the machine-tick and host-frame boundary. The machine frame
loop now owns CPU/device/VBLANK advancement and local tick cleanup only. Host
time, IDE input, render presentation, game-view host sync, microtasks, runtime
asset texture/audio flushing, and surfaced runtime-fault presentation sit
outside the machine frame loop. TS workbench fault data is an explicit
workbench-owned runtime state object, not lazy side-table state and not loose
fields mixed into the machine tick. The render transient-frame owner has moved
out of `machine/runtime`, but the machine tick still enters it at
frame-start/VBLANK-wake boundaries because those are the points where machine
execution opens or clears current-frame render work.

Current evidence:

- `src/bmsx_cpp/machine/runtime/frame/loop.cpp` no longer includes
  `core/engine.h` and no longer calls `EngineCore` for reboot handling.
  Program reload and BIOS-to-cart boot transitions now sit behind the existing
  `CartBootState` owner.
- The native frame loop no longer imports the old
  `machine/runtime/render/state.h` owner. Frame-start lighting reset enters the
  concrete render lighting owner, and VBLANK IRQ wake cleanup enters the concrete
  render queue owner directly instead of hiding those calls behind wrapper-only
  runtime functions.
- Both TS and C++ frame loops still decide when current-frame render work begins
  and when VBLANK wake cleanup is needed, but the work itself is owned by
  `render/shared/hardware/lighting` and `render/shared/queues`.
- TS machine runtime faults now use `src/bmsx/machine/runtime/runtime_fault.ts`
  instead of importing the IDE Lua pipeline only to construct machine faults.
- `src/bmsx/machine/runtime/frame/loop.ts` no longer imports IDE workbench mode.
  Overlay gating reads the runtime's `executionOverlayActive` state, and
  back-queue cleanup enters the concrete render queue owner directly instead of
  passing through a wrapper-only runtime render-state function.
- TS and C++ frame loops no longer present or record surfaced runtime faults.
  They mark local tick cleanup state, clear IRQ-halt/pending-call state, and
  rethrow. The host frame pumps are the first presentation boundary for those
  failures.
- TS workbench fault state is no longer a lazy `WeakMap` side table and no
  longer lives as loose `Runtime` fields. `src/bmsx/ide/workbench/mode.ts`
  creates the explicit workbench fault state object that stores handled-error
  identity, the editor fault snapshot, the saved CPU fault stack, the Lua fault
  stack, and the overlay flush flag. Editor, terminal, and intellisense code read
  that state through the workbench owner instead of treating it as machine tick
  state.
- TS and C++ VBLANK still enter the concrete VDP presentation helper at the
  VBLANK commit edge. That is the direct video-hardware path, not a generic host
  presentation path.
- `src/bmsx/machine/runtime/frame/host.ts` has been deleted. The TS host frame
  pump now lives in `src/bmsx/core/host_frame.ts`, matching the native
  `src/bmsx_cpp/core/host_frame.cpp` ownership without putting IDE frame work
  directly in `EngineCore`. The TS machine runtime frame folder contains the
  machine tick loop, not IDE input polling or host presentation.
- TS and C++ frame loops no longer flush runtime asset edits from inside the
  machine tick. Host frame pumps flush them after the scheduled machine step and
  before presentation, keeping texture/audio host work outside CPU/VBLANK
  advancement.
- TS and C++ runtime asset edit flushing is drained at explicit host edges, then
  dispatched to the real owners: render texture upload code handles dirty image
  assets, and audio code handles dirty audio invalidation. The host edge no
  longer discovers `engineCore` or `EngineCore::instance()`, and machine
  save/resume restore functions no longer import asset flushing to mutate host
  texture/audio state as a side effect.
- TS IDE resume and C++ libretro save-state load are explicit host edges for
  post-restore asset flushing: they apply the restored machine state first, then
  flush dirty assets with the current texture/audio/view resources. Native audio
  dirty assets now invalidate active audio clips instead of being silently
  ignored.
- TS save-state byte restore still lacks a host-edge asset flush call because
  there is no TS host save-state load entrypoint wired like libretro yet.
- TS and C++ save/resume/runtime-reset paths clear transient render submissions
  through the concrete render queue owner instead of wrapper-only
  `runtime_state` pass-through functions.
- The native host frame pump no longer discovers `EngineCore::instance()` or
  probes `Platform::microtaskQueue()` during each frame. The libretro platform
  supplies the concrete engine and microtask queue when it calls the host frame
  pump, and the pump flushes that queue directly.
- The native host frame pump now lives under `src/bmsx_cpp/core/host_frame.cpp`
  instead of `src/bmsx_cpp/machine/runtime/frame/host.cpp`. The machine runtime
  frame folder contains the machine tick loop, while the host shell owns input
  polling, host timing counters, microtask flushing, asset edit flushing, and
  presentation.
- The native host frame pump is now an `EngineCore::runHostFrame(...)`
  operation, not a free function with friendship into engine internals.
  Host-frame admission, host timing counters, runtime tick delta switching, and
  tick-cost recording are owned by `EngineCore` instead of being patched from a
  sidecar helper.
- Libretro pause/resume and per-frame startup no longer duplicate
  `Running`/`Paused`/`Initialized` predicates or reach through
  `soundMaster()` to mirror audio state. The platform records its external
  pause flag, then asks `EngineCore` to apply the host pause/start transition
  against the loaded-ROM lifecycle.
- The native IMGDEC device no longer includes `core/engine.h` or looks up
  `EngineCore::instance().platform()` when starting decode work. The machine
  construction path passes the concrete microtask queue into the device.
- TS scheduler/CPU debug tick telemetry now reads the host frame time already
  supplied to the runtime frame pump, instead of importing `EngineCore` only to
  query `$.platform.clock`.
- TS and C++ save-machine-state restore deliberately do not flush runtime asset
  edits directly; post-restore host edges must perform texture/audio flushing
  with concrete host resources.

Risk:

The frame-pump boundary is now clean enough to build on, but `Runtime` is still
a broad startup/workbench meeting point for IDE lifetime and overlay activation.
That remaining disease belongs to the larger EngineCore/Runtime split, not to
the machine tick itself. Avoid reintroducing fault presentation, IDE input
polling, host resource flushing, or host singleton discovery into
`machine/runtime/frame`, and do not put workbench presentation state back onto
`Runtime`.

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

Firmware, resource lookup, and devtool source inspection are now separated from
host `EngineCore` query state. `EngineCore` still bootstraps platform/view/audio
objects, but cart-visible firmware and IDE/devtool source/resource queries use
runtime-owned program sources, active asset sources, runtime storage, runtime
clock, and machine memory.

Current evidence:

- TS `EngineCore` no longer carries the source/source-registry mirror,
  workspace-overlay getter, or engine-layer getter that firmware/devtool code
  used to query indirectly.
- TS runtime startup receives the system asset layer and workspace overlay from
  the host startup boundary, then owns `engineLuaSources`, `cartLuaSources`,
  `activeLuaSources`, `activeAssetSource`, and `activeAssets`.
- `LuaSourceRegistry` carries its project root, so editor/devtool workspace path
  resolution no longer asks `EngineCore` for cart or engine project roots.
- TS firmware builtins, JS bridge marshalling, debug source lookup, resource
  panels/viewers, bitmap font lookup, and AEM/editor resource code query runtime
  source/resource owners instead of `engineCore.sources`,
  `engineCore.source`, `engineCore.assets`, or `engineCore.platform.clock`.
- Native firmware globals use `Runtime::clock()` and runtime assets/manifests;
  native runtime memory refresh uses ROM spans owned by `RuntimeOptions`
  instead of `EngineCore::engineRomView()` / `cartRomView()`.
- `src/bmsx/machine/firmware/devtools.ts` exposes source inspection APIs and
  deliberately checks workspace cached source and dirty buffers before packed
  source.
- `src/bmsx_cpp/machine/firmware/devtools.cpp` mirrors the devtool source
  inspection surface on the native side.

Remaining risk:

Host presentation, input, audio, and platform scheduling still legitimately use
`EngineCore` until the larger startup split happens. Do not move source,
resource, firmware, or devtool state back onto that host shell just because it
is globally reachable.

Guardrails:

- Keep ROM/resource lookup as a firmware or machine resource contract, not a
  direct `EngineCore` query.
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

Recent save-state work also includes CPU/runtime state, RAM, the CPU-owned
string pool, input, frame scheduler/VBLANK state, game-view state, render
state, and VDP surface pixels.

Risk:

Save-state support can look wired while still missing deterministic behavior
under real libretro save/load cycles. The highest-risk areas are VDP render
surfaces, display/render framebuffer page state, scheduler/VBLANK timing,
queued/transient render work, audio queue state, and source/runtime edge cases
such as empty strings.

Desired direction:

- Add focused save/load tests that mutate RAM, interned CPU strings, VDP
  surfaces, framebuffer pixels, atlas slots, input state, scheduler/VBLANK
  state, and cart persistent state before restoring.
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

Completed foundation:

1. VDP/render boundary cleanup for singleton discovery, framebuffer-page
   ownership, and direct hot-path texture writes.
2. Host frame pump split from machine tick for CPU/device/VBLANK advancement,
   host input/timing, presentation, runtime asset flushing, and fault
   surfacing.
3. Firmware/resource/devtool API split from host `EngineCore` source, asset,
   clock, project-root, and ROM-memory queries.

Next recommended work:

1. Prove libretro save-state serialization end to end.
2. Audit TS/C++ parity subsystem by subsystem.
3. Clean IDE/editor layering after the machine boundaries are safer.

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
