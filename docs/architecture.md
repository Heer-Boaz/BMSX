# BMSX Architecture Boundary Review

Status: current architecture review, not a quality rule.
Last checked: 2026-05-12.

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
- The TS/C++ ownership map for this slice is intentionally mirrored and audited
  by `npm run audit:core-parity`: core TS files must have the same relative
  basename in C++, and selected mirrored files must expose the same public
  constants/functions/classes/methods unless `scripts/core_parity_manifest.json`
  carries a narrow exclusion with a reason. This is a real surface audit, not a
  basename-only placeholder check.
  `src/bmsx/machine/program/layout.ts` and
  `src/bmsx_cpp/machine/program/layout.h` own program placement constants and
  `resolveProgramLayout()`.
  `src/bmsx/machine/program/loader.ts` and
  `src/bmsx_cpp/machine/program/loader.h/.cpp` own the `PROGRAM_IMAGE_ID`,
  `PROGRAM_SYMBOLS_IMAGE_ID`, `PROGRAM_BOOT_HEADER_VERSION`, `ProgramImage`,
  `ProgramSymbolsImage`, `ProgramBootHeader`, `ProgramConstRelocKind`,
  `ProgramConstReloc`, `ProgramLink`, `EncodedValue`, section structs,
  `decodeProgramImage()`, `decodeProgramSymbolsImage()`,
  `buildProgramBootHeader()`, `inflateProgram()`, `buildModuleProtoMap()`,
  `stripLuaExtension()`, and `toLuaModulePath()` contracts. The remaining TS
  `encodeProgramObjectSections()` surface is a compiler/rompacker producer edge;
  C++ consumes linked images and does not expose a compiler producer API.
  `src/bmsx/machine/program/linker.ts`
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
  The public-symbol audit records the remaining source-surface exclusions:
  TS `RawRomSource` is a structural type contract and C++ deliberately keeps the
  concrete `RomSourceStack` public API instead of adding a virtual facade;
  C++ source-stack record carriers embed C++ `RomAssetInfo`, while TS owns the
  same wire-format record types in `rompack/format.ts`.
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
- Save-state byte parity for this slice lives in the same relative files:
  `src/bmsx/machine/runtime/save_state/schema.ts`,
  `src/bmsx_cpp/machine/runtime/save_state/schema.h/.cpp`,
  `src/bmsx/machine/runtime/save_state/codec.ts`, and
  `src/bmsx_cpp/machine/runtime/save_state/codec.cpp`. There is no save-state
  version byte and no compatibility layer; the current prop table is the
  contract and old saves are not supported. The APU state persists the raw
  parameter registerfile, raw command FIFO contents/cursors, per-slot raw
  parameter latches, per-slot lifecycle phases, per-slot source-DMA byte
  buffers, per-slot Q16 playback cursors, per-slot STOP-fade envelope countdown
  and total-duration latches, and the APU scheduler sample-carry/pending-sample latches,
  cart-visible event latch (`eventKind`, `eventSlot`, `eventSourceAddr`,
  `eventSequence`), and sticky APU fault/status latch. APU voice ids are
  runtime-only device tokens; restore mints fresh runtime voice ids and replays
  active AOUT output from the restored per-slot APU source-DMA buffers, playback
  cursor, and STOP-fade envelope position instead of reading cart RAM or
  preserving host clip handles. AOUT retained host-output queue frames are
  runtime-only; restore clears that queue inside the APU/AOUT device owner before
  replaying active voices, so cart-visible output-ring MMIO cannot expose stale
  pre-restore host samples.
  Restore rewrites the event, active-slot, and selected-source MMIO mirrors
  because RAM save-state intentionally excludes IO slots. The string-pool entry field is `tracked`;
  ROM-owned strings remain untracked while runtime-materialized strings restore
  as tracked RAM.
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

Status: the main VDP/render singleton-discovery and renderer-callback leaks have been replaced by a stricter device/host-output boundary: the VDP device owns registers, latches, VRAM slot state, frame submission, fault latches, and explicit host-output transactions; render code consumes those transactions and acks execution tokens.

Current evidence:

- Cart-visible VDP ingress is MMIO/VRAM/DMA/VBlank only. The old runtime-side scene adapter `machine/runtime/vdp_submissions` has been removed in both TS and C++; TS `GameView` host/editor sprite/rect/poly/glyph submissions stay in a zero-copy render queue instead of being translated into VDP register writes. The native C++ host/editor 2D overlay path has no consumer, so those submissions do not enter a black-hole render queue and are not counted as VDP/machine output.
- `src/bmsx/render/shared` and `src/bmsx_cpp/render/shared` are render-side feature queues only. Boundary tests fail on `writeVdpRegister`, `consumeDirectVdpCommand`, `VDP_REG_`, or VDP register-file imports in those directories, and they also fail if renderer-side code writes `IO_VDP_REG_*` or `IO_VDP_CMD`.
- `machine/runtime` no longer imports render submission/font types for VDP command emission. Boundary tests fail on `render/shared/submissions`, `render/shared/bitmap_font`, `core/font`, or `vdp_submissions` in the runtime VDP path.
- The VDP device code does not import framebuffer or host render modules. Framebuffer/texture upload, page presentation, and backend synchronization sit on the render/runtime side of the host bridge. TS and C++ upload dirty framebuffer rows before page presentation; presentation helpers no longer receive a raw VDP object just to flip framebuffer pages.
- VDP host output is an explicit `VdpHostOutput` read/ack transaction: the renderer reads one output object/value, consumes the ready execution queue/BBU RAM/camera/SBX/dither/dirty-surface/framebuffer handles from that output, and acks execution with the same token. TS no longer returns a reused mutable singleton output object; C++ returns a value. The renderer still receives handles to VDP-owned buffers, so future hardening should add generation/frozen-snapshot semantics only if a concrete race appears.
- TS and C++ VDP expose the same public host-bridge names for this contract: `readHostOutput()` and `completeHostExecution(...)`, alongside the MMIO/DMA/VRAM entry points, frame/VBlank progression, save-state capture/restore, and surface-dirty clear.
- TS and C++ VDP expose cart-visible fault latches as VDP status registers: `IO_VDP_STATUS` carries the fault bit, `IO_VDP_FAULT_CODE` / `IO_VDP_FAULT_DETAIL` carry the sticky-first reason, and `IO_VDP_FAULT_ACK` is write-one-to-clear. Save-state stores the sticky fault code/detail plus device state, not raw transient status pins.
- VDP cart-facing ABI constants are split by owner instead of being dumped into
  the bus map. `machine/bus/io` owns only MMIO addresses and ordered address
  banks; mirrored `machine/devices/vdp/registers` owns VDP register indices,
  packet words, and command opcodes; mirrored
  `machine/devices/vdp/contracts` owns VDP slot ids, readback modes/status bits,
  submit/status bits, SBX/FIFO strobes, and VDP fault codes. Firmware globals,
  device code, render consumers, and focused ingress tests import those values
  from the VDP owners, with no compatibility aliases left in the bus layer.
- Cart-originating VDP faults latch and cancel/drop device work instead of throwing host exceptions. Packet/header/count problems use `VDP_FAULT_STREAM_BAD_PACKET`; direct submit state errors use `VDP_FAULT_SUBMIT_STATE`; unknown command doorbells use `VDP_FAULT_CMD_BAD_DOORBELL`; busy submit rejection uses `VDP_FAULT_SUBMIT_BUSY`; DEX source faults use `VDP_FAULT_DEX_SOURCE_SLOT` or `VDP_FAULT_DEX_SOURCE_OOB`; invalid DEX scale and LINE width use their DEX fault codes; SBX/BBU faults use their unit-specific codes.
- Current per-unit fault policy is explicit and test-covered: direct DEX command faults drop the command and keep the open direct frame; DEX faults reached while replaying a sealed FIFO/DMA stream abort that sealed stream frame; FIFO/DMA stream parser faults abort the stream frame; SBX frame-seal faults reject the frame; BBU packet faults reject the packet/stream frame; submit-busy faults reject the attempt without mutating the visible frame.
- The TS and C++ VDP save-state stores now include the raw VDP registerfile and saved surface
  pixel geometry. Restore rehydrates the MMIO register mirror from the VDP
  owner, restores CPU-visible surface dimensions before copying saved pixels,
  and marks the restored surface dirty for host upload. This keeps register
  words and surface shape as VDP state rather than backend texture state.
- Exceptions are reserved for emulator bugs and impossible internal states, such as broken save-state schema, impossible host transaction invariants, null host buffers, or internal surface registration mistakes.
- `IO_VDP_DITHER` is a live VOUT register owned by mirrored TS/C++ `machine/devices/vdp/vout` units. MMIO writes update the live latch directly, frame seal snapshots the live dither word, and VBlank presentation promotes the sealed word to visible `VdpDeviceOutput.ditherType`; the old `syncRegisters()` read-self-back pass is gone.
- VOUT also owns the scanout beam timing rather than exposing only a coarse
  VBlank boolean. The mirrored VOUT units derive active scanline/dot and
  blanking scanline/dot positions from the runtime frame cycles, visible
  framebuffer dimensions, and VBlank start cycle; `VdpDeviceOutput.scanoutX/Y`
  now advances through blanking dots as well as visible pixels while
  `IO_VDP_STATUS.VBLANK` remains the cart-visible level pin.
- VDP VRAM power-on garbage is seeded from explicit machine/boot entropy words instead of `Math.random`, `Date.now`, or host wall-clock state.
- The 19-word `IO_VDP_CMD_ARG0` latch bank is the DEX/2D blitter ingress, not the whole VDP frontend. Direct MMIO writes and FIFO `REG1`/`REGN` replay feed the same latches, `IO_VDP_CMD`/FIFO `CMD` doorbells snapshot those latches, registers 10 and 11 are raw `DRAW_LAYER`/`DRAW_PRIORITY`, and register 12 is `DRAW_CTRL` for DEX flip/PMU control.
- DEX frame ingress now has an explicit TS/C++ state word instead of a boolean
  `open` latch. Direct MMIO `BEGIN_FRAME` enters `DirectOpen`; sealed FIFO/DMA
  stream replay enters `StreamOpen`; frame seal and cancellation return the unit
  to `Idle`; submit-busy status derives from that device state.
- BBU packet acceptance now owns a mirrored TS/C++ synchronous packet transition
  sequence: `PacketDecode`, `SourceResolve`, `InstanceEmit`, `LimitReached`, and
  `PacketRejected`; `reset()` returns the packet state to `Idle`. VDP still
  owns VRAM slot/surface resolution and the cart-visible fault latch, but BBU
  classifies zero-size and instance-limit rejection before emitting resolved
  billboard instance RAM. The ingress tests cover rejection
  without visible mutation and accepting the next valid packet after a rejected
  one.
- SBX now owns its mirrored TS/C++ face-window, packet-ingress, seal-snapshot,
  live, and visible register buffers. The VDP stream/MMIO ingress code writes
  raw words into SBX-owned buffers, then asks SBX to seal the frame; VDP still
  performs the VRAM slot/surface lookup and projects the returned SBX fault
  decision into the cart-visible fault latch. Rejected SBX frame seals leave
  visible skybox state untouched and the next valid SKYBOX packet can still
  commit normally.
- FBM now owns mirrored TS/C++ framebuffer page lifecycle state in
  `machine/devices/vdp/fbm`: configured framebuffer dimensions, display-page
  CPU readback, `PageWritable` / `PagePendingPresent` / `PagePresented` /
  `ReadbackRequested` state, pending presentation count, full-sync promotion,
  and dirty presentation spans. VDP still owns VRAM slot lookup, fault latching,
  and dirty-surface clearing, while render-side texture upload remains in
  `render/vdp/framebuffer`.
- Non-framebuffer VDP surface uploads now follow the same device-owned
  transaction rule. Normal `drainSurfaceUploads(...)` emits dirty-only
  non-framebuffer slot transactions, `syncSurfaceUploads(...)` emits full-sync
  transactions for renderer context or texture initialization, and VDP clears
  the dirty pin inside the device owner after the sink consumes the transaction.
  Renderer slot textures consume the raw upload payload and `requiresFullSync`
  flag only; they no longer return an ack boolean, classify framebuffer
  surfaces, or clear surface-dirty state themselves.
- VOUT now owns mirrored TS/C++ visible video-output state in
  `machine/devices/vdp/vout`: `Idle` / `RegisterLatched` / `FrameSealed` /
  `FramePresented` state, the live dither register, active/VBlank scanout
  phase and scanout X/Y position, retained sealed frame output,
  live/frame-sealed/visible framebuffer scanout dimensions, visible dither,
  visible XF matrix selection, visible
  resolved SBX samples, visible BBU instance RAM, and the retained
  `VdpDeviceOutput` host transaction. VDP maps `IO_VDP_DITHER`, framebuffer-size
  changes, runtime VBlank timing changes, frame seal, VBlank frame promotion,
  and VDP-owned VRAM/sample resolution into that unit; render code still
  consumes explicit device-output values instead of interpreting cart intent.
- Current parallax status is DEX/PMU-owned parallax execution. PMU register writes latch raw bank words. DEX resolves the selected bank into per-BLIT `dstX`/`dstY`/scale geometry when it latches BLIT work, and DEX/LINE faults are surfaced through VDP fault latches.
- Camera, PMU, SBX, and BBU state are real VDP unit state. SBX ingress is either the `IO_VDP_SBX_*` register window plus commit doorbell or a sealed `SKYBOX` packet. BBU ingress is the sealed `BILLBOARD` packet stream. Render backends consume resolved host-output state; they do not validate or program VDP device state.
- `src/bmsx/render/vdp` and `src/bmsx_cpp/render/vdp` remain the renderer/backend side of the VDP host bridge. They may upload textures, execute ready blitter queues, and present framebuffer pages through explicit VDP host-output transactions; dirty acknowledgement remains inside the VDP owner. Render modules must not be imported by `machine/devices/vdp`.

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
texture/view asset flushing, and surfaced runtime-fault presentation sit
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
  machine tick. Host frame pumps flush texture/view assets after the scheduled
  machine step and before presentation, keeping host resource uploads outside
  CPU/VBLANK advancement.
- TS and C++ runtime asset edit flushing is drained at explicit host edges, then
  dispatched to the real owners: render texture upload code handles dirty image
  assets, while AOUT voices keep their device-owned source snapshots and host
  audio only pulls PCM. The host edge no
  longer discovers `engineCore` or `EngineCore::instance()`, and machine
  save/resume restore functions no longer import asset flushing to mutate host
  texture/view state as a side effect.
- TS IDE resume and C++ libretro save-state load are explicit host edges for
  post-restore asset flushing: they apply the restored machine state first, then
  flush dirty assets with the current texture/view resources. Audio playback no
  longer owns host clips at this edge: active AOUT voices replay from
  device-owned source snapshots, and host audio only pulls device PCM.
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
  edits directly; post-restore host edges must perform texture/view flushing
  with concrete host resources while audio stays on device-owned AOUT snapshots.

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
state, and VDP surface pixels. The VDP save-state now stores its raw register
file and the logical geometry for saved surface pixel payloads, so restore
rebuilds the cart-visible MMIO register mirror and CPU-visible surface shape
through the VDP owner instead of relying on host texture state.

Risk:

Save-state support can look wired while still missing deterministic behavior
under real libretro save/load cycles. The highest-risk areas are VDP render
surfaces, display/render framebuffer page state, scheduler/VBLANK timing,
queued/transient render work, audio queue state, and source/runtime edge cases
such as empty strings.

Desired direction:

- Add focused save/load tests that mutate RAM, interned CPU strings, VDP
  framebuffer pixels, atlas slots, input state, scheduler/VBLANK
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

## Active Goal Resume State

This section records what continuing the active cleanup goal means from the
current working tree. It is not a new architecture rule; it is the handoff for
the next cleanup session.

The current goal is still active. The work has moved BMSX toward a stricter
emulator shape, but it has not completed the architecture cleanup. A resumed
goal should continue from the concrete ownership gaps below instead of starting
a new broad audit.

Already advanced in this goal:

- Runtime construction has moved required host-owned dependencies toward the
  runtime boundary. TS runtime construction receives the active `GameView`, and
  native runtime construction receives the concrete `Input` owner instead of
  discovering it internally.
- BIOS-less cart boot is closer to a real cart runtime path: native runtime boot
  no longer runs the system built-in prelude when no system ROM program is
  installed.
- Runtime/input pass-through APIs were reduced. Fake dispose wrappers, unused
  action-definition cache clearing, and PlayerInput forwarding helpers were
  removed or replaced by owner-level operations.
- The scratchbatch compatibility facade was removed in TS and C++; callers now
  use the actual scratch-buffer owner.
- IDE runtime fault capture, debugger pause state, workbench runtime-error UI,
  and overlay-mode transitions have been split into named owners instead of
  being exported from one broad workbench mode bucket.
- Terminal command parsing no longer owns workbench effects. It returns explicit
  actions for terminal deactivation, fault clearing, and workspace reset/nuke;
  workbench applies those effects at the owner boundary.
- Workspace listing can see open dirty buffers without terminal importing
  workbench code-tab internals. Open dirty workspace paths are tracked through a
  workspace-owned boundary and updated by code-tab context state.
- Semantic contract imports and keyword completion ownership were narrowed so
  runtime/editor modules do not depend on unrelated re-export surfaces.
- The code-quality CLI can now handle mixed TS/C++ roots, with CSV parsing moved
  to the shared analysis utility.
- Libretro save-state entry points are wired through the platform boundary, and
  a native save-state round-trip path exists in the working tree.
- The native program-cart test fixture no longer owns the ROM/program wire
  encoders or package layout. `tests/cpp/support/program_cart_fixture.cpp`
  chooses the tiny RET program and minimal manifest identity, while
  `machine/program/loader` owns `ProgramImage` encoding, `rompack/toc` owns TOC
  encoding, and `rompack/format` owns cart manifest encoding plus section
  offsets, boot-header fields, header bytes, and final cart-byte assembly. The
  libretro save-state test cart now enters through those ROM/program owners
  before `LibretroPlatform::loadRom` boots it.
- VDP save-state coverage now includes the raw VDP registerfile and saved
  surface geometry in both TS and C++. The focused VDP ingress tests mutate
  register words, surface dimensions, and surface pixels, restore through the
  VDP owner, then prove both the MMIO register mirror and the visible
  framebuffer result come from the restored device state. The libretro
  save-state test also mutates a VDP register through the platform-owned
  runtime, restores it through `LibretroPlatform::loadState`, and uses that
  restored register word to produce a visible framebuffer pixel.
- DEX frame ingress no longer uses a loose boolean open latch. TS and C++ now
  store the hardware ingress state as `Idle`, `DirectOpen`, or `StreamOpen`, so
  direct MMIO submit, FIFO/DMA replay, frame seal, cancel, and submit-busy
  status all consume the same explicit unit state.
- BBU packet acceptance has a mirrored synchronous unit transition in TS and
  C++ for packet decode, source-resolve admission, instance emit, packet
  rejection, and billboard-limit rejection. The slice keeps VDP-owned
  VRAM/surface lookup direct; it does not insert a renderer/host/provider layer
  or weaken the framebuffer/texture hot path.
- SBX now owns its register-window staging, packet staging, and frame-seal
  snapshot buffers in both TS and C++. VDP only writes ingress words, resolves
  sealed face samples against VDP-owned VRAM/surface state, and raises the
  returned SBX fault decision.
- VOUT now owns the live/frame-sealed/visible host-output buffers for dither,
  active/VBlank scanout phase, scanline/dot beam position across visible and
  blanking spans, framebuffer scanout dimensions, XF, resolved SBX samples,
  BBU instances, and retained
  `VdpDeviceOutput` in both TS and C++.
  VDP still performs VRAM/sample resolution and FBM dimension ownership, but it
  no longer passes framebuffer dimensions through the host-output read path or
  carries separate committed camera/skybox/billboard output mirrors.
- FBM framebuffer host sync is now a VDP-owned output transaction instead of a
  renderer pull of raw framebuffer internals. TS and C++ expose the pending
  presentation drain for normal VBLANK page flips and a forced full-sync
  transaction for host context restore. The renderer seeds GPU textures from
  that transaction, so it no longer calls public render/display readback getters
  or clears the pending presentation latch itself. Dirty framebuffer upload
  acknowledgement stays inside the VDP owner when that full-sync transaction is
  consumed, preserving the direct VRAM/readback buffers without adding a scene
  graph or host facade.
- Geometry now has mirrored TS/C++ controller phase state (`Idle`, `Busy`,
  `Done`, `Error`, `Rejected`) and the 16-word registerfile count in the
  Geometry contract owner instead of deriving the device lifecycle from
  active-job optionality or controller-local layout. The bus I/O map owns the
  ordered 16-word GEO register address bank; the controller and save-state path
  consume that bus-owned bank directly when capturing/restoring raw register
  words. Save-state persists the phase with the raw register words, active job
  latch, processed counters, and timing budget, and focused TS/C++ tests prove
  BUSY/DONE restore plus REJECTED command admission.
- Geometry now exposes `IO_GEO_FAULT_ACK` / `sys_geo_fault_ack` as a
  cart-visible write-one-to-clear fault doorbell. REJECTED and ERROR fault bits
  stay visible until acknowledged, command doorbells and ABORT strobes are
  ignored while that fault latch is pending, and the ACK register self-clears.
  The ACK doorbell is
  append-only in the I/O bank rather than part of the original contiguous
  16-word GEO registerfile, so existing downstream MMIO addresses do not move.
  This adds no legacy save-state compatibility logic.
- Geometry command ingress is now the `IO_GEO_CMD` doorbell itself. Firmware and
  carts stage operands in `SRC/DST/COUNT/PARAM/STRIDE`, then write the command
  word to `IO_GEO_CMD`; the controller snapshots those operand registers into
  the active job latch, enters BUSY, and schedules device work from that latched
  state. `IO_GEO_CTRL` no longer has a start bit and is abort-only. A command
  write during BUSY drops the active job and latches `GEO_FAULT_REJECT_BUSY`;
  command writes while ERROR/REJECTED is latched are ignored until
  `IO_GEO_FAULT_ACK`. The old duplicate CTRL-start ingress is intentionally
  gone, with no compatibility alias.
- Geometry command/status/fault/policy constants now live with the Geometry
  device contract in mirrored `machine/devices/geometry/contracts.ts` and
  `machine/devices/geometry/contracts.h`. The bus I/O map owns the MMIO
  addresses and ordered register address bank, while firmware globals,
  controller code, save-state code, and tests consume the geometry ABI from the
  geometry owner, including the packed fault-word masks, shift, and reject
  sentinel used by BIOS-side fault decoding. The overlap result
  `pair_meta` field is likewise a Geometry-owned cart ABI: full-pass mode packs
  instance A/B with mirrored `GEO_OVERLAP2D_PAIR_META_INSTANCE_*` constants, and
  BIOS decodes it through `sys_geo_overlap_pair_meta_instance_*` globals instead
  of local bit masks.
- Geometry also owns the command memory layouts. The live overlap instance,
  candidate pair, result, summary, and shape/bounds descriptor sizes and byte
  offsets are mirrored in the Geometry contract files and exposed as
  `sys_geo_overlap_*` globals. The older XFORM2 and SAT2 table formats now use
  the same owner: `GEO_VERTEX2_*`, `GEO_XFORM2_*`, and `GEO_SAT2_*` constants
  live in the mirrored Geometry contracts and are exported as
  `sys_geo_vertex2_*`, `sys_geo_xform2_*`, and `sys_geo_sat2_*` globals. BIOS
  now stages shapes, instances, summaries, and result reads from those globals
  instead of hard-coding the old stale 48-byte instance / 16-byte pair-table
  notes.
- Geometry command execution is now split out of the register/timing controller
  into mirrored datapaths: `GeometryXform2Unit`, `GeometrySat2Unit`, and
  `GeometryOverlap2dUnit` under `machine/devices/geometry`. The controller owns
  MMIO latches, phase, timing budget, service scheduling, active-job lifecycle,
  and IRQ/fault latch transitions. XFORM2 owns record/matrix/vertex/AABB
  memory traversal with a fixed per-record vertex capacity exposed as
  `sys_geo_xform2_max_vertices`, SAT2 owns descriptor/pair/projection/result
  traversal with a fixed convex-polygon vertex capacity exposed as
  `sys_geo_sat2_max_poly_vertices`, and overlap2d owns candidate/full-pass
  decoding, retained instance/bounds/piece views, fixed clip/contact scratch,
  summary/result writes, and cart-originating overlap faults. Shared projection
  interval scratch is a Geometry data shape, not controller state. All datapath scratch
  remains transient and unsaved because it is deterministically derived from the
  active job and RAM operands, while result and summary RAM remain
  cart-visible device output. The Geometry ABI now publishes only implemented
  command doorbells (`xform2`, `sat2`, `overlap2d`) and implemented primitive
  kinds (`aabb`, `convex_poly`, `compound`); placeholder XFORM3/PROJECT3
  command globals/descriptors and the unimplemented circle primitive global
  were removed instead of preserving fake hardware surfaces that only reject.
- APU command, status, fault, filter, event, slot, and fixed-point clock/gain
  constants now live with the mirrored APU device contract in
  `machine/devices/audio/contracts.ts` and
  `machine/devices/audio/contracts.h`. The bus I/O map owns the MMIO addresses
  and ordered APU parameter-register address bank; the APU controller, firmware
  globals, and tests consume cart-visible APU semantics from those owners instead
  of re-deriving register layout locally. The public Lua descriptor surface now
  advertises the APU fault/status register and fault-code ABI instead of leaving
  those globals as undocumented constants. The controller also owns the raw
  parameter registerfile, per-slot raw parameter latches, per-slot source-DMA
  byte buffers, mirrored per-slot lifecycle phases, a mirrored active-slot
  mask, runtime-only voice ids, sticky fault/status latches, and event latch
  state; save/load restores only the
  persistent device latches through the APU owner because RAM save-state does not
  carry IO slots and host output handles are runtime-only.
  The active-slot mask is now cart-visible at `IO_APU_ACTIVE_MASK` /
  `sys_apu_active_mask`, while the selected-slot active bit, `APU_STATUS_BUSY`,
  selected-source readback, and
  `IO_APU_SELECTED_SLOT_REG0` channel register window are derived from the
  per-slot latches and lifecycle phases instead of asking carts to inspect host
  voice handles or restoring an independent active-mask truth source. Carts may
  write the selected-slot window directly: those writes
  update the raw per-slot channel register bank, persist in APU save-state, and
  push live playback state such as gain, rate, loop bounds, start cursor, and
  filter words into AOUT at the AOUT datapath boundary. Source-buffer register
  writes (`source addr`, byte count, format, frame/data window) now split at the
  hardware boundary: `source addr` and byte count enter the
  mirrored APU source-DMA owner in `machine/devices/audio/source`: the device
  reloads the selected slot source bytes from machine memory and keeps the
  reloaded bytes in save-state, while AOUT owns format, frame/data-window, BADP,
  and PCM metadata validation before it restarts the voice from the device
  cursor. This keeps DMA from knowing codec rules and avoids routing active
  source changes through host sound objects or rejecting them as an AOUT
  limitation. The mirrored
  `machine/devices/audio/output` owner now contains raw parameter-register playback decode,
  voice-id shapes, BADP/PCM decode state, loop/rate/gain/filter/fade mixer
  state, and the raw PCM render path in both TS and C++. BADP/PCM little-endian
  word reads use the shared `common/endian` owner in both runtimes instead of
  local audio-private decode helpers. The `Machine` owns the
  AOUT mixer next to the APU controller; the APU controller talks to this AOUT
  owner directly. SoundMaster is only the host audio edge for
  latency, master gain, suspension, and native queue pumping. Active APU source
  bytes are captured by the source-DMA unit at `PLAY` time or selected-channel
  source-buffer writes and serialized per slot, so
  restored output replays from device-owned sample snapshots rather than
  whatever cart RAM happens to contain after load. The browser runtime no longer
  routes APU playback through asynchronous host clip/voice creation or public
  host-side core-queue push APIs: the browser host exposes only a runtime-audio
  pull boundary into its worklet transport, and the native libretro platform
  drains the same mirrored AOUT mixer into its audio callback. AOUT also owns the
  reusable host-output queue state in both runtimes: hosts request/pull sample
  spans from AOUT, AOUT fills/retains queued PCM frames behind a bounded device
  queue, and platform audio backends consume those spans instead of owning the
  core output ring bookkeeping themselves. The queue is cart-visible through
  APU MMIO readback: `IO_APU_OUTPUT_QUEUED_FRAMES`,
  `IO_APU_OUTPUT_FREE_FRAMES`, and `IO_APU_OUTPUT_CAPACITY_FRAMES` expose the
  device-owned ring occupancy/capacity, while `APU_STATUS_OUTPUT_EMPTY` and
  `APU_STATUS_OUTPUT_FULL` are derived from the same AOUT queue state on
  `IO_APU_STATUS`. The obsolete platform clip/voice facades were deleted from
  both runtime audio contracts; APU voices are AOUT device records, not host
  handles.
  APU restore/reset also clear the retained AOUT output queue at the device
  owner; host/platform reset paths only clear their transport timing and do not
  mutate AOUT queue state.
  Host audio availability is not a cart-visible APU fault; a muted or absent host
  speaker does not change APU register, active-mask, cursor, or event state.
  Cart-originating AOUT start/decode faults are now reported through the APU
  sticky fault/status latch instead of host logging or swallowed output setup:
  unsupported BADP headers, metadata/range mismatches, invalid encoded blocks,
  undersized PCM data windows, and non-positive playback step values clear the
  replacement slot and expose an `APU_FAULT_*` code/detail through
  `IO_APU_FAULT_CODE` / `IO_APU_FAULT_DETAIL`. Live selected-channel writes
  that cannot be replayed by AOUT, such as non-positive rate steps or source
  DMA reloads that fail source/range/decode validation, fault and clear the
  active channel rather than leaving save-state dependent on stale pre-fault
  host/AOUT residue.
  The APU is now a device-scheduled participant in machine time: it accrues
  fixed 44.1 kHz sample ticks from CPU cycles, advances per-slot Q16 playback
  cursors at each source's sample rate, wraps looped cursors, owns
  `Idle`/`Playing`/`Fading` channel phases, owns STOP fade sample countdowns
  plus the full fade-duration latch, replays restored or source-reloaded fading
  voices into AOUT with the effective current gain derived from those device
  latches, and raises `APU_EVENT_SLOT_ENDED`/`IRQ_APU` from the device when playback or
  fade completes. Generator playback is also device-owned now: the raw
  `IO_APU_GENERATOR_KIND` and `IO_APU_GENERATOR_DUTY_Q12` parameter words live
  in the APU latch/slot banks, source DMA skips RAM capture for generator
  sources, and AOUT renders the square generator from the device cursor,
  source-rate register, loop bounds, and duty register. Restored generator
  voices therefore replay the same phase without re-reading cart RAM or
  depending on host voice state; richer generator/noise/envelope/pan/pitch
  channels are the next APU datapath work. `IO_APU_CMD` is now a doorbell into
  a bounded device-owned command FIFO. Doorbell writes snapshot the 21-word raw
  parameter latch bank, clear the
  visible doorbell/latch pad, and device service drains queued commands in FIFO
  order. `IO_APU_CMD_QUEUED`, `IO_APU_CMD_FREE`, and
  `IO_APU_CMD_CAPACITY` expose FIFO occupancy/capacity, while
  `APU_STATUS_CMD_FIFO_EMPTY`, `APU_STATUS_CMD_FIFO_FULL`, and
  `APU_FAULT_CMD_FIFO_FULL` come from the same controller-owned queue state.
  The FIFO is persisted in save-state because it is machine-visible work, not a
  host backend cache. `SET_SLOT_GAIN` is an APU command that copies the latched
  `sys_apu_gain_q12` snapshot through the same selected per-slot current-gain
  register write path used by direct selected-slot MMIO; AOUT decodes the raw
  Q12 word into output gain at the datapath boundary.

Open problems to continue with:

1. The libretro save-state proof is no longer blocked by a test-private cart
   packer, but the proof is still narrow. The current native test covers public
   `LibretroPlatform::loadRom` boot, runtime initialization, RAM restore, IRQ
   line restore, cart-visible IRQ flags, one VDP registerfile restore, and a
   restored-register-driven visible framebuffer pixel. It still needs a more
   cart-driven mutation program instead of direct test mutation of runtime
   state, plus device-by-device expansion for VDP framebuffer page/VBlank edge
   timing, BBU/queued VDP work, input latches, cart-persistent state, and any
   APU state that becomes machine-visible. The platform path itself should stay
   public: `LibretroPlatform::loadRom` should create the console/runtime
   through `ConsoleCore`, and cart program mode should be entered by the normal
   console boot sequence, not by a private backdoor or manual runtime-state
   patch.

2. `src/bmsx/ide/terminal/ui/mode.ts` remains a large IDE/terminal layering
   hotspot. The known debt includes terminal imports from editor internals,
   wrapper-only methods, repeated panel layout/drawing logic, repeated numeric
   sanitization, empty-string fallback behavior, repeated command expression
   handling, and string OR-comparison dispatch. This should be cleaned in
   focused ownership slices, not hidden behind analyzer exceptions.

3. `src/bmsx/ide/workbench/ui/code_tab/contexts.ts` still exposes several
   wrapper-like state accessors. Some are public workbench contracts today, but
   the file remains a state-bucket smell. The next cleanup should either inline
   access at real owners or split code-tab context mutation/query responsibilities
   by actual lifecycle ownership.

4. Geometry is not proven complete. It is more hardware-shaped than many
   older surfaces because it has MMIO registers, scheduler service, IRQs,
   status/fault words, and mirrored TS/C++ controllers. That is not the same as
   being done. The geometry controller now stores an explicit mirrored hardware
   phase from the mirrored Geometry contract and saves/restores that phase with
   its bus-owned raw register address bank, in-flight command latch, processed
   counters, and timing budget state instead of aborting BUSY work at load time,
   so a save-state preserves the device as an active coprocessor rather than
   reconstructing work from visible registers.
   XFORM2, SAT2, and overlap2d command execution now live in mirrored unit-owned
   datapaths instead of in the generic register/timing controller. XFORM2 owns
   transform record decoding, a fixed per-record vertex capacity, and
   result/AABB writes, SAT2 owns pair/descriptor decode plus retained
   projection scratch, a fixed polygon vertex capacity, and result writes, and
   overlap2d owns candidate/full-pass decoding, retained piece views, fixed
   clip/contact scratch, and summary/result writes. Placeholder 3D Geometry
   command globals/descriptors and the circle primitive global are no longer
   exposed as if they were implemented hardware. That scratch remains excluded
   from save-state because it is deterministically derived from the active job
   and RAM operands. The remaining Geometry work is to audit whether every
   cart-visible error is represented as
   device status rather than host exception or ad-hoc rejection, and whether the
   register/latch contract is tight enough for future geometry commands. The existing
   `docs/geo_overlap2d_pass_v1.md` is a good hardware-contract note, but it does
   not certify the whole geometry device. The OVERLAP2D contact datapath now
   decodes shape descriptors into retained device scratch views and clips into a
   fixed scratch arena; it no longer materializes full world-polygon staging
   arrays/vectors before SAT/contact work.

5. The public API surface is not proven complete. Firmware globals, BIOS helper
   APIs, Lua API metadata, editor overlay APIs, devtools APIs, and terminal or
   workspace command surfaces must be audited separately. The desired rule is
   still: cart-facing behavior goes through BIOS/firmware helpers or MMIO/RAM,
   editor/workbench helpers stay out of cart-visible semantics, and host/private
   runtime shortcuts do not become de-facto cartridge APIs.

6. The broader emulator boundary work is still not globally complete. The VDP,
   render host bridge, runtime startup, IDE/workspace edge, device APIs, and
   TS/C++ parity surfaces are better than before, but the goal should still be
   treated as subsystem-by-subsystem cleanup rather than a completed architecture
   rewrite.

If `/goal resume` is invoked, it should mean this order of work:

1. Continue auditing Geometry as a device, not as a math helper: register/latch
   ownership, scheduler timing, IRQ/status/fault behavior, scratch/result
   memory, save/load behavior, and TS/C++ parity should be checked as one
   hardware contract.
2. Continue the APU hardware contract beyond device-owned cursor/timer events,
   cart-visible AOUT start faults, the mirrored AOUT mixer, cart-visible AOUT
   output-ring status, the persisted command FIFO, the writable selected
   channel register bank, the mirrored source-DMA byte-buffer owner, and the
   mirrored slot lifecycle phases, and the mirrored STOP-fade envelope level:
   remaining generator and richer envelope work must stay device-owned instead
   of growing through host-side sound shortcuts.
3. Continue the Input Controller (ICU) cleanup by removing the remaining pass-through APIs and making the
   device owner the single source of truth for input state, including the
   active `Input` snapshot, input timing, and any future input features such as
   buffered input or rumble.
4. Audit the API surfaces that carts or tools can observe: BIOS/firmware helper
   APIs, Lua API metadata, devtools source APIs, overlay/editor APIs, terminal
   commands, and workspace APIs. Separate cart-visible contracts from editor or
   host-only conveniences.
5. Continue the IDE/terminal cleanup with `terminal/ui/mode.ts`, because it is
   the next concentrated quality hotspot exposed by the current slice.
6. Clean `code_tab/contexts.ts` state access after terminal mode no longer
   needs editor/workbench internals by convenience.
7. Revisit VDP only if a concrete host-output race appears that requires
   generation/frozen snapshot semantics; do not invent a new renderer-facing
   scene API.
8. Only then perform a fresh completion audit of the active goal against this
   document and the actual working tree. The expected result today is still
   "not complete" unless every open item above has been resolved by concrete
   owner-owned code.

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

1. Continue Geometry as a real coprocessor device beyond the explicit
   controller phase and mirrored XFORM2/SAT2/overlap2d datapaths: re-audit
   register/latch ownership, scheduler timing, scratch/result memory,
   status/fault behavior, and focused TS/C++ tests.
2. Continue APU hardware work through MMIO/FIFO/device state/AOUT instead of
   host sound shortcuts; after the mirrored AOUT mixer, cart-visible AOUT
   start faults, cart-visible output-ring status, persisted command FIFO,
   selected-channel register writes, source-DMA ownership, sample-rate-scaled
   cursors, slot lifecycle phases, and STOP-fade envelope level restore, the
   next APU step is generator and richer envelope state owned by the device.
3. Continue Input Controller (ICU) cleanup by removing the remaining pass-through APIs and making the
   device owner the single source of truth for input state, including the
   active `Input` snapshot, input timing, and any future input features such as
   buffered input or rumble.
4. Continue TS/C++ parity cleanup subsystem by subsystem, including public API
   surfaces instead of assuming they are already covered.
5. Clean IDE/editor layering after the machine boundaries are safer, starting
   with `terminal/ui/mode.ts` and then code-tab context ownership.

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
