# BMSX

BMSX is a fantasy console with real console discipline.

It is fictional hardware, but the architecture is treated like a real machine: carts run against CPU, RAM/ROM, MMIO registers, and device controllers. Host code exists to present audio, video, input, files, and platform entrypoints; it should not become the cart-facing hardware contract.

The TypeScript implementation is the canonical browser/headless/CLI machine runtime and host stack. The C++ implementation mirrors the machine structure for libretro/custom hosts.

See `docs/architecture.md` for the machine/host boundary rules.

## Setup

- Node.js 22 or later
- `npm install -D`

## Project Layout

- `src/bmsx/machine`: CPU, memory, MMIO bus, device controllers, firmware, program loader, and runtime lifecycle
- `src/bmsx/core`: shared runtime coordination and system bootstrap
- `src/bmsx/common`: low-level shared helpers
- `src/bmsx/audio`: host-side audio playback/output code, not the machine audio device
- `src/bmsx/ide`: editor, terminal, workbench, and IDE runtime tooling
- `src/bmsx/res`: BIOS/system ROM resources
- `src/bmsx_hostplatform`: browser/headless/CLI host platform code
- `src/bmsx_cpp`: C++ machine/runtime implementation for libretro/custom hosts
- `src/carts`: Lua carts and cart-local resources
- `scripts/rompacker`: BIOS/cart/platform builders
- `scripts/bootrom`: browser and Node boot entrypoints
- `dist`: generated ROMs and runtime artifacts

## Build Model

- BIOS/system assets live in `src/bmsx/res`
- carts live in `src/carts/<cart-folder>`
- cart resources live in `src/carts/<cart-folder>/res`
- `build:game` takes the cart folder name, not the ROM manifest name
- headless/CLI use debug artifacts
- libretro/custom-host runs require non-debug BIOS and non-debug cart ROMs

## Architecture Doctrine

BMSX can be playful at the product level, but the machine layer is not an engine-service grab bag. New cart-visible hardware should be represented as memory-mapped devices under `machine/devices`, with register addresses in `machine/bus/io`.

Preferred direction for cart-visible features:

```text
cart Lua -> BIOS/firmware or cart library -> MMIO/RAM -> machine device -> host output
```

Avoid this for new hardware-facing behavior:

```text
cart Lua -> native host/runtime shortcut
```

The host may accelerate implementation details, but it must not own the semantics of console hardware. Existing build artifact names still use `engine` in a few places; treat that as historical naming unless referring to concrete files such as `engine.debug.js`.

## Runtime Timing

BMSX derives VBLANK length automatically from `machine.ufps`, CPU frequency, and visible render height. It does not use a cart manifest `vblank_cycles` override.

The runtime assumes 50 Hz class machines are PAL-like 313-scanline frames and faster refresh rates are NTSC-like 262-scanline frames. This replaces the old `renderHeight + 1` derivation, which made Pietious at 5 MHz/50 Hz/192 visible lines get only 544 VBLANK cycles. The scanline model gives 38659 VBLANK cycles for that same case.

Keep `machine.ufps` as the display refresh rate, normally 50 or 60 Hz. Implement 25/30 Hz MSX/Konami-style game cadence in cart code by waiting for two VBLANK IRQs per game tick, not by lowering `machine.ufps`.

The runtime uses a simplified CRT scanline model:

- `machine.ufps <= 55 Hz` is PAL-like and uses 313 total scanlines.
- `machine.ufps > 55 Hz` is NTSC-like and uses 262 total scanlines.
- `machine.ufps` remains the display refresh rate, normally 50 or 60 Hz.
- A 25 or 30 Hz game loop is implemented by cart code waiting for two VBLANK IRQs per game tick.

The VBLANK calculation is:

```text
cyclesPerFrame = cpuHz / refreshHz
visibleCycles = floor(cyclesPerFrame * renderHeight / totalScanlines)
vblankCycles = cyclesPerFrame - visibleCycles
```

The scanline model produces:

```text
cyclesPerFrame = 100000
totalScanlines = 313
visibleCycles = floor(100000 * 192 / 313) = 61341
vblankCycles = 38659
```

This keeps the machine refresh at 50/60 Hz while giving carts enough VBLANK budget to use explicit MSX/Konami-style loops: arm input before waiting for VBLANK, update/draw according to the cart cadence, and submit VDP work inside the VBLANK window.

The BIOS exposes `update_world()` and `draw_world()` as separate cart-facing phases. Carts own the hardware cadence: arm input before the VBLANK that samples it, run `update_world()` during visible-frame CPU time, reset the VDP stream and call `draw_world()` in the next VBLANK, then DMA-submit the stream. There is no cart-facing `update()` wrapper.

## Common Commands

Build BIOS debug artifacts:

```bash
npm run build:bios -- --debug --force
```

Build a cart debug ROM:

```bash
npm run build:game -- pietious --debug --force
```

Build browser artifacts:

```bash
npm run build:platform:browser -- --debug --force
```

Build headless artifacts:

```bash
npm run build:platform:headless -- --debug --force
```

Force-build headless + BIOS + cart and run:

```bash
npm run headless:forcebuildallrun -- pietious
```

Run an already-built cart in headless mode:

```bash
npm run headless:game -- pietious
```

Run the explicit headless assert route:

```bash
npm run headless:assert -- pietious
```

Important:

- `headless:forcebuildallrun` and `headless:game` take the cart folder name
- headless uses `dist/headless_debug.js`, `dist/engine.debug.js`, and `dist/bmsx-bios.debug.rom`
- `headless:game` now prefers `src/carts/<cart>/test/<cart>_assert_results.mjs` when present
- if no auto assert module exists, `headless:game` falls back to `<cart>_demo.json`
- headless timelines run unpaced, so the full scenario completes as fast as the emulator can simulate it
- `headless:assert` and `headless:forcebuildallassert` are the explicit assert paths

## Libretro / Custom Host

Libretro requires non-debug BIOS and non-debug cart ROMs. Do not run it against `*.debug.rom`.

Build the non-debug BIOS and cart ROM:

```bash
npm run build:bios -- --force
npm run build:game -- pietious --force
```

Build the libretro core:

```bash
npm run build:platform:libretro-wsl
```

Build the custom WSL libretro host:

```bash
npm run build:libretro-host-wsl:debug
```

Run the custom libretro host:

```bash
npm run run:libretro-host:wsl:headless -- ./dist/pietious.rom
```

Important:

- `run:libretro-host:wsl:headless` now runs silently by default with `SDL_VIDEODRIVER=dummy` and `SDL_AUDIODRIVER=dummy`
- the silent SDL path uses the software backend on purpose
- the libretro core loads `dist/bmsx-bios.rom`, not `dist/bmsx-bios.debug.rom`
- the ROM argument must be the non-debug cart ROM, for example `./dist/pietious.rom`
- the custom libretro host falls back to `src/carts/<cart>/test/<cart>_demo.json` when no explicit timeline is provided
- libretro timelines also run unpaced while the input timeline is active

## Input Timelines And Screenshots

- headless and the custom libretro host both support input timeline playback
- you do not need a separate `smoke` timeline
- timeline JSON files may include `capture: true` markers
- both runners execute the full chosen timeline; “fast” means they do not pace it to realtime
- screenshots are written to a `screenshots/` subfolder next to the timeline file
- when a cart folder name differs from the generated ROM filename, use `--rom-folder <cart-folder>` or an explicit `--input-timeline <file>` when running the custom libretro host manually

## Notes

- `build:game` means “build a Lua cart ROM”
- cart folder resolution is `src/carts/<name>`
- old TypeScript full-game projects were removed instead of being kept as compatibility fallbacks
- the last complete branch that still contains the old TypeScript full-game runtime lives at `archive/ts-full-engine`
