# BMSX Architecture Boundary Review

Status: current architecture review, not a quality rule.
Last checked: 2026-04-23.

BMSX is already usable as a quasi-professional fantasy-console codebase. The
important remaining work is not broad cleanup for its own sake. The largest
architecture pressure is that the top-level system still reads more like
engine + firmware + host shell than a strict driver/device-tree model.

That is not preferred for BMSX as Host/platform/render conveniences must not
become the cart-facing hardware contract.

This review uses MAME's general posture as the reference point:
https://github.com/mamedev/mame. MAME treats source code as hardware
documentation, with machine state and devices owning emulated behavior. BMSX
should not imitate MAME wholesale, but the same discipline applies to
machine-vs-host ownership.

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

The current state does not justify pausing feature work for a giant cleanup
phase. It does justify doing the next architecture fixes in the right order,
because new features will otherwise keep growing new direct edges into
`EngineCore`, `GameView`, IDE state, or platform state.

## Largest Boundary Problems

### 1. VDP Still Knows Too Much About Render And Host State

The C++ VDP is the most important boundary to clean first. It is a machine
device, but it still knows about host/render concepts such as `GameView`,
`RuntimeAssets`, render submissions, the texture manager, and backend reads.

Current evidence:

- `src/bmsx_cpp/machine/devices/vdp/vdp.h` includes `render/shared/submissions.h`
  and forward-declares `RuntimeAssets` and `GameView`.
- `VDP::registerImageAssets(...)` and `VDP::commitViewSnapshot(GameView&)` put
  asset and presentation concepts directly on the device API.
- `VDP::initializeFrameBufferSurface()` reaches
  `EngineCore::instance().view()->backend()`.
- `VDP::commitLiveVisualState()` checks `EngineCore::instance().texmanager()`
  and commits straight into `EngineCore::instance().view()`.
- `VDP::readSurfacePixels(...)` reads pixels through
  `EngineCore::instance().texmanager()->backend()`.

Risk:

The VDP becomes a render coordinator instead of an emulated device. That makes
save state, libretro portability, deterministic tests, and TS/C++ parity harder.
It also makes new GPU features tempting to implement as host shortcuts instead
of device-visible behavior.

Desired direction:

- Keep VDP-owned state on the VDP side: registers, VRAM, DMA submit state,
  frame timing, framebuffer identity, atlas slot ids, skybox ids, and committed
  visual state.
- Move backend ownership and host texture reads/writes to the render side.
- Let the VDP publish an explicit committed state/output snapshot that render
  consumes after the machine step.
- Avoid solving this with a generic service/provider/facade layer. The boundary
  should be concrete and named after the data being handed over.

### 2. Frame Loop Mixes Host Frame Pump With Machine Tick

The frame loop currently mixes host scheduling, IDE/input presentation, render
queue handling, and machine execution.

Current evidence:

- `src/bmsx_cpp/machine/runtime/frame/loop.cpp` includes `core/engine.h` and
  `render/shared/queues.h`.
- `FrameLoopState::beginFrameState(...)` reads
  `EngineCore::instance().view()`, then writes viewport and post-processing
  flags into Lua `game.viewportsize` and `game.view`.
- `src/bmsx/machine/runtime/frame_loop.ts` imports `../../core/engine`,
  IDE workbench mode, render queues, hardware lighting, and IDE Lua pipeline
  fault handling from the machine runtime frame loop.

Risk:

The machine runtime is not just ticking the machine. It is also polling host
input, coordinating IDE overlay behavior, managing presentation paths, and
projecting host view state into guest-visible tables. That makes the runtime
harder to reason about as deterministic emulated hardware.

Desired direction:

- Split host frame pump from machine tick.
- Host code supplies time, input snapshot, run-gate state, and presentation
  preferences before the machine step.
- Machine runtime advances CPU/devices/VBLANK using explicit frame inputs.
- Screen/render consumes committed machine output after the machine step.
- IDE overlay and terminal input should stay outside the machine tick contract.

### 3. Firmware And Cart API Reach Directly Into Host Assets And Source State

Firmware setup still reaches through `EngineCore` for cart/system assets,
manifests, project roots, view settings, and clock functions. The TypeScript
cart API also exposes Lua source/workspace mechanics.

Current evidence:

- `src/bmsx_cpp/machine/firmware/globals.cpp` resolves ROM asset ranges through
  `EngineCore::instance().cartAssets()` and `systemAssets()`.
- The same file builds globals from `loadedCartManifest()`,
  `loadedCartEntryPath()`, `cartAssets()`, `machineManifest()`,
  `cartProjectRootPath()`, and `view()`.
- `src/bmsx/machine/firmware/api/index.ts` exposes `list_lua_resources()`,
  `get_lua_entry_path()`, and `get_lua_resource_source(...)`, including
  workspace/dirty-source lookup.

Risk:

Cart-visible API can silently become "whatever host/runtime data is convenient"
instead of a stable console contract. That is the exact direction that would
turn BMSX from fantasy console hardware into an engine API.

Desired direction:

- Separate ROM/resource lookup as a firmware or machine resource contract, not
  a direct `EngineCore` query.
- Decide which source/workspace APIs are devtool-only and keep them out of the
  normal cart hardware contract.
- Keep presentation flags and viewport state behind a deliberate firmware or
  MMIO contract if carts are meant to observe them.
- Preserve the rule that cart code does not call `engine.*` or host shortcuts.

### 4. EngineCore Is Still A Large Startup And Runtime Meeting Point

`EngineCore.init(...)` currently performs system asset layer setup, workspace
overlay assignment, platform/view host setup, input initialization, browser
backend selection, cart index parsing, `GameView` construction, GPU backend
creation, texture manager setup, render pass registration, resize wiring,
initial render-target layout, default texture initialization, debug setup, exit
handling, and runtime initialization.

`EngineCore.start()` also owns platform frame scheduling and calls directly into
`runtime.frameLoop.runHostFrame(...)`.

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

### 5. Libretro Save State Is Not End-To-End Complete

The machine/runtime side has capture/restore-style pieces, but the libretro
platform serialization entry points are still placeholders:

- `LibretroPlatform::getStateSize()` returns `0`.
- `LibretroPlatform::saveState(...)` returns `false`.
- `LibretroPlatform::loadState(...)` returns `false`.

Risk:

For an emulator-style runtime, save-state support is a concrete architecture
test. If state cannot be serialized through the platform boundary, it usually
means host-only and machine-owned state are not separated sharply enough.

Desired direction:

- Wire libretro serialization to machine/runtime capture and restore.
- Serialize machine state, firmware/runtime state, RAM/ROM-visible mutable
  state, device state, scheduler/VBLANK state, and cart persistent state.
- Exclude host-only render backend handles, platform objects, transient queues,
  IDE/editor state, and cached presentation resources.
- Treat serialization requirements as part of new device design.

### 6. TS/C++ Parity Is Selective, Not Systematic

The C++ implementation mirrors important machine structure, but parity should be
claimed subsystem by subsystem, not globally.

Risk:

Assuming global parity can hide differences in firmware API behavior, VDP
submission semantics, input timing, resource lookup, serialization, and render
presentation. Those differences become expensive when libretro becomes a serious
target instead of a parallel experiment.

Desired direction:

- Track parity at subsystem level: memory/MMIO, VDP, input, scheduler/VBLANK,
  firmware globals, ROM/resource lookup, save state, and host test behavior.
- Prefer small deterministic parity tests over broad claims.
- Do not add compatibility fallbacks to mask divergence.

### 7. IDE/Editor Layering Is Large Debt, But Not The First Console Blocker

The current code-quality analyzer reports the IDE editor as a sizeable layering
hotspot:

```text
root: src/bmsx/ide/editor
files scanned: 137 TypeScript files
total issues: 385
top rule: cross_layer_import_pattern, 138 issues
top folders: ui 125, input 108, contrib 72
```

Risk:

Editor feature work can slow down because UI, input, contrib, rendering, and
runtime support know too much about each other. This matters, but it is less
fundamental than the machine/render/firmware boundary leaks.

Desired direction:

- Clean IDE layering in focused slices.
- Keep editor/runtime/debugger support out of cart-visible hardware contracts.
- Do not let IDE convenience APIs leak into firmware or runtime semantics.

## Recommended Work Order

1. Clean the VDP/render boundary.
2. Split host frame pump from machine tick.
3. Separate firmware/resource/devtool APIs from host `EngineCore` queries.
4. Finish libretro save-state serialization end to end.
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
