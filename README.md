# BMSX

BMSX is an emulated machine with real emulator discipline.

BMSX is documented and implemented as if it were an obscure physical console:
carts run against CPU, RAM/ROM, MMIO registers, and device controllers. Host
code exists to present audio, video, input, files, and platform entrypoints; it
should not become the cart-facing hardware contract.

The TypeScript implementation builds a JavaScript machine runtime plus browser
and Node hosts. The C++ implementation mirrors the machine structure and supplies C++ machine and host artifacts.

See `docs/architecture.md` for the machine/host boundary rules.

## Setup

- Node.js 22 or later
- `npm install -D`

## Project Layout

- `machine/ts/machine`: TypeScript CPU, memory, MMIO bus, device controllers, program loader, and runtime lifecycle
- `machine/ts/core`: shared runtime coordination and system bootstrap
- `machine/ts/common`: low-level shared helpers
- `machine/ts/audio`: host-side audio playback/output code, not the machine audio device
- `ide`: editor, terminal, workbench, and IDE runtime tooling
- `machine/bios`: the guest system-ROM source, organized by BIOS responsibility
- `cartlib`: the cart-side SDK, including direct device programming; bundled into cart ROMs when required
- `hosts/browser`: browser player/product owners
- `hosts/node`: headless and CLI product owners
- `machine/cpp`: C++ machine/runtime implementation
- `hosts/libretro`: libretro core host entrypoint for BMSX
- `hosts/libretro_host`: local libretro frontend executable, an alternative to RetroArch
- `carts`: Lua cart software for the machine and cart-local resources
- `scripts/rompacker`: BIOS/cart compiler, linker, asset, and ROM builders
- `scripts/products`: deployable player, Studio, Node, and libretro product builders
- `scripts/bootrom`: Node player and tooling entrypoints
- `dist`: generated ROMs and runtime artifacts

## Build Model

- BIOS code lives in `machine/bios`
- BIOS assets live in `machine/bios/res`
- resident base, table, string, math, and OS modules live directly in `machine/bios`
- shared cart Lua lives in `cartlib`
- current carts live in `carts/<cart-folder>`
- current cart resources live in `carts/<cart-folder>/res`
- `build:toolchain:cart` takes the cart folder name, not the ROM manifest name
- headless/CLI use debug artifacts
- libretro/custom-host runs require non-debug BIOS and non-debug cart ROMs

## Architecture Doctrine

BMSX can be playful at the product level, but the machine layer is not a service grab bag. New cart-visible hardware should be represented as memory-mapped devices under `machine/devices`, with register addresses in `spec/bmsx/io`.

The documentation is the hardware manual. Machine ABI values such as register
addresses, status bits, IRQ flags, packet fields, opcodes, fixed-point words,
and device constants are numbers in that manual and in the owning TS/C++
machine constants. They are not fantasy-console convenience globals injected by
the emulator runtime.

Preferred direction for cart-visible features:

```text
cart Lua -> BIOS service or cart library -> MMIO/RAM -> machine device -> host output
```

Avoid this for new hardware-facing behavior:

```text
cart Lua -> C++ host/runtime shortcut
```

The host may accelerate implementation details, but it must not own the semantics of machine hardware. Use the architecture roles precisely: the machine owns cart-observable semantics, a host owns the embedding/process and physical services, and a mode is a behavior variant inside one host.

Current artifact names encode that split:

- `dist/libbmsx.js`: importable JavaScript machine/runtime library.
- `dist/engine.js`: IDE-free browser player/bootstrap with its statically linked runtime composition.
- `dist/studio.js`: browser Studio composition with IDE and compiler tooling.
- `libbmsx.a` in its CMake build tree: C++ machine/runtime.
- `dist/libretro_bmsx.so`: libretro core built around the C++ machine runtime.
- `dist/host_headless.js` and `dist/host_cli.js`: IDE-free Node player modes with their statically linked runtime composition.
- `dist/host_headless_tooling.js`: Node timelines, captures, host tests, IDE tests, and profiling.

## Runtime Timing

BMSX fixes the CPU at 33.8688 MHz (`44100 × 768`) and resets GX to 320×240 PAL. The PSX GP1 register
set still owns raster/status state, including its native 256, 320, 368, 512 and
640-column modes. The PS2-style PCRTC is the sole scanout clock and geometry
owner: `SMODE1/2`, `SYNCH1/2` and `SYNCV` drive the physical beam, while
`DISPFB1/2`, `DISPLAY1/2` and `PMODE` select and merge the visible rectangles.
Cart manifests do not own refresh rate, render size, or a `vblank_cycles`
override.

The standard mode envelope reaches 1920×1080. Raw PCRTC programming covers the PSX
240p/480i family, PS2 640×448i NTSC and 640×512i PAL, and the PS2 DTV outputs
720×480p, 656×576p, 1280×720p and 1920×1080i. This envelope is not a register
clamp: other representable words still flow through the PCRTC datapath. The
cartlib exposes direct reset presets for 256/320/368/512/640×240,
640×480i, 640×448i and 640×512i; bare-metal carts may instead program the raw
registerfile. Libretro advertises 1920×1080 initially and raises its complete AV
contract when raw dual-circuit composition exceeds that standard envelope, so
startup does not reserve the theoretical maximum and metadata never becomes an
implicit clamp on raw words.

The GPU publishes composition words at VBlank. Physical timing writes take
effect in the PCRTC beam owner, which supplies exact rational CPU-cycle
deadlines to the scheduler. Carts own lower game cadence by counting VBLANK
IRQs. They program GX through GP0/GP1 and PCRTC MMIO and may DMA native GP0
streams directly from ROM/RAM; there is no VDP stream or manifest timing
facade.

## Common Commands

Build BIOS debug artifacts:

```bash
npm run build:toolchain:bios -- --debug --force
```

Build a cart debug ROM:

```bash
npm run build:toolchain:cart -- pietious --debug --force
```

Build the browser player:

```bash
npm run build:product:browser-player -- --debug --force
```

Build browser Studio:

```bash
npm run build:product:browser-studio -- --debug --force
```

Build the headless player or the separate validation tooling:

```bash
npm run build:product:node-headless-player -- --debug --force
npm run build:product:node-headless-tooling -- --debug --force
```

Force-build headless + BIOS + cart and run:

```bash
npm run headless:forcebuildallrun -- pietious
```

Run an already-built cart in headless mode:

```bash
npm run headless:game -- pietious
```

Run render parity through the TypeScript and C++ headless runtimes:

```bash
npm run test:render-parity
```

Run an explicit host test:

```bash
npm run headless:test -- pietious tests/carts/pietious/pietious_enter_world_assert.lua
```

Important:

- `headless:forcebuildallrun` and `headless:game` take the cart folder name
- `test:render-parity` force-builds and compares the render test carts through TS headless and the C++ libretro host
- headless runs `dist/host_headless.debug.js` with `dist/bmsx-bios.debug.rom`; it does not dynamically load `dist/libbmsx.debug.js`
- `headless:tooling` runs the separate `dist/host_headless_tooling.debug.js` validation product
- host tests are always explicit; `headless:game` does not auto-load assert modules
- the ordinary player never scans `tests/` or auto-loads `<cart>_demo.json`
- headless tooling timelines run unpaced, so the full scenario completes as fast as the emulator can simulate it
- `headless:test` and `headless:forcebuildalltest` are the explicit host-test paths
- Lua host tests run through `scripts/bootrom/platforms/hostrunner/host_test_runner.lua`; TypeScript schedules the machine and drives the explicit runner protocol. The Lua runner exposes `host.press(code, frames)`, `host.down(code)`, `host.up(code)`, `host.at(frame, command)`, `host.capture(label)`, and `host.log(message)` for simple Lua-built input timelines

## Libretro / Custom Host

Libretro requires non-debug BIOS and non-debug cart ROMs. Do not run it against `*.debug.rom`.

Build the non-debug BIOS and cart ROM:

```bash
npm run build:toolchain:bios -- --force
npm run build:toolchain:cart -- pietious --force
```

Build the libretro core:

```bash
npm run build:product:libretro-wsl
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
- the headless libretro-host path also passes `--no-audio`, so bare-metal smoke runs do not depend on an SDL or ALSA audio sink
- the silent SDL path uses the software backend on purpose
- the libretro core loads `dist/bmsx-bios.rom`, not `dist/bmsx-bios.debug.rom`
- the ROM argument must be the non-debug cart ROM, for example `./dist/pietious.rom`
- the custom libretro host falls back to `tests/carts/<cart>/<cart>_demo.json` when no explicit timeline is provided
- libretro timelines also run unpaced while the input timeline is active

## Input Timelines And Screenshots

- headless and the custom libretro host both support input timeline playback
- you do not need a separate `smoke` timeline
- timeline JSON files may include `capture: true` markers
- both runners execute the full chosen timeline; “fast” means they do not pace it to realtime
- screenshots are written to a `screenshots/` subfolder next to the timeline file
- timeline frame `N` is the boundary after accepted frontend presentation `N`; its input affects the next accepted presentation and a capture records that same next presentation under marker `N`
- the presentation clock starts at content load and counts BIOS output too; it does not inspect cart startup state
- when a cart folder name differs from the generated ROM filename, use `--rom-folder <cart-folder>` or an explicit `--input-timeline <file>` when running the custom libretro host manually

## ROM Inspection

`scripts/rominspector/rominspector.ts` is a CLI for inspecting a built `.rom`
file. It reads the raw ROM, parses the cart header and TOC, and reports asset
layout, manifest, and physical BLua32 details. This is the tool for confirming
the `bmsx/assets` address/length symbols and the rest of the ROM layout without
disassembling by hand.

Run it directly with `tsx`:

```bash
npx tsx scripts/rominspector/rominspector.ts dist/nemesis_s.debug.rom --list-assets
```

Options:

- `--list-assets` print the asset table to stdout (id, type, path, size, and
  buffer/metabuffer start/end offsets in hex); this is the default when no other
  output flag is given
- `--manifest` print the cart manifest (and project root path) as JSON
- `--blua32-asm` print the physical BLua32 disassembly and exit; source-line
  comments are included when the ROM is not stripped
- `--asset-symbols` print the generated `bmsx/assets` ROM address symbols
- `--cycle-cost` print a BLua32 cycle-cost analysis
- `--ui` / `--ui-native` open the interactive native inspector UI

The header line printed on every run shows header/manifest/toc/data/metadata
offsets and lengths plus the BLua32 image range, physical startup/IRQ/exception
function addresses, and static-layout token, so the section layout is visible
at a glance.

## Notes

- `build:toolchain:cart` means “build a BLua cartridge ROM”
- cart folder resolution is `carts/<name>`
- old TypeScript full-game projects were removed instead of being kept as compatibility fallbacks
- the last complete branch that still contains the old TypeScript full-game runtime lives at `archive/ts-full-engine`
