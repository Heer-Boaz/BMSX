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
- `machine/ts/ide`: editor, terminal, workbench, and IDE runtime tooling
- `machine/firmware`: BIOS/system ROM Lua, default cart boot source, and BIOS/system resources
- `cartlib`: shared Lua library for carts; bundled into cart ROMs when required
- `hosts/browser`: browser host services
- `hosts/node`: headless and CLI host services
- `machine/cpp`: C++ machine/runtime implementation
- `hosts/libretro`: libretro core host entrypoint for BMSX
- `hosts/libretro_host`: local libretro frontend executable, an alternative to RetroArch
- `carts`: Lua cart software for the machine and cart-local resources
- `scripts/rompacker`: BIOS/cart/platform builders
- `scripts/bootrom`: browser and Node boot entrypoints
- `dist`: generated ROMs and runtime artifacts

## Build Model

- BIOS/system assets live in `machine/firmware/res`
- BIOS/system Lua lives in `machine/firmware/bios` and `machine/firmware/system`
- shared cart Lua lives in `cartlib`
- current carts live in `carts/<cart-folder>`
- current cart resources live in `carts/<cart-folder>/res`
- `build:game` takes the cart folder name, not the ROM manifest name
- headless/CLI use debug artifacts
- libretro/custom-host runs require non-debug BIOS and non-debug cart ROMs

## Architecture Doctrine

BMSX can be playful at the product level, but the machine layer is not a service grab bag. New cart-visible hardware should be represented as memory-mapped devices under `machine/devices`, with register addresses in `machine/bus/io`.

The documentation is the hardware manual. Machine ABI values such as register
addresses, status bits, IRQ flags, packet fields, opcodes, fixed-point words,
and device constants are numbers in that manual and in the owning TS/C++
machine constants. They are not fantasy-console convenience globals injected by
the emulator runtime.

Preferred direction for cart-visible features:

```text
cart Lua -> BIOS/firmware or cart library -> MMIO/RAM -> machine device -> host output
```

Avoid this for new hardware-facing behavior:

```text
cart Lua -> C++ host/runtime shortcut
```

The host may accelerate implementation details, but it must not own the semantics of machine hardware. Use the architecture roles precisely: the machine owns cart-observable semantics, a host owns the embedding/process and physical services, and a mode is a behavior variant inside one host.

Current artifact names encode that split:

- `dist/libbmsx.js`: JavaScript machine/runtime.
- `dist/engine.js`: browser host/bootstrap.
- `lib/libbmsx.a`: C++ machine/runtime.
- `dist/libretro_bmsx.so`: libretro core built around the C++ machine runtime.
- `dist/host_headless.js` and `dist/host_cli.js`: Node host modes.

## Runtime Timing

BMSX takes video standard from the raw PSX GP1 display-mode word. Bit 3 selects
PAL (50 Hz, 313 scanlines); a clear bit selects NTSC (60000/1001 Hz,
262 scanlines). The machine model fixes the CPU at 50 MHz and scanout at
320×240. Cart manifests do not own refresh rate, render size, or a
`vblank_cycles` override.

The runtime derives the frame and VBLANK cycle budgets from those hardware
words:

```text
cyclesPerFrame = cpuHz / refreshHz
visibleCycles = floor(cyclesPerFrame * renderHeight / totalScanlines)
vblankCycles = cyclesPerFrame - visibleCycles
```

Carts own lower game cadence by counting VBLANK IRQs. They program GX through
GP0/GP1 and may DMA native GP0 streams directly from ROM/RAM; there is no VDP
stream or manifest timing facade.

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

Run the bare-metal cart through both headless runtimes:

```bash
npm run headless:bare-metal
```

Run an explicit host test:

```bash
npm run headless:test -- pietious tests/carts/pietious/pietious_enter_world_assert.lua
```

Important:

- `headless:forcebuildallrun` and `headless:game` take the cart folder name
- `headless:bare-metal` force-builds and runs `bare_metal_cart` through TS headless and the C++ libretro host
- headless uses `dist/host_headless.debug.js`, `dist/libbmsx.debug.js`, and `dist/bmsx-bios.debug.rom`
- host tests are always explicit; `headless:game` does not auto-load assert modules
- if no explicit test is provided, `headless:game` falls back to `<cart>_demo.json`
- headless timelines run unpaced, so the full scenario completes as fast as the emulator can simulate it
- `headless:test` and `headless:forcebuildalltest` are the explicit host-test paths
- Lua host tests run through `scripts/bootrom/platforms/hostrunner/host_test_runner.lua`; TypeScript only installs the native bridge and schedules ticks. The Lua runner exposes `host.press(code, frames)`, `host.down(code)`, `host.up(code)`, `host.at(frame, command)`, `host.capture(label)`, and `host.log(message)` for simple Lua-built input timelines

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
- when a cart folder name differs from the generated ROM filename, use `--rom-folder <cart-folder>` or an explicit `--input-timeline <file>` when running the custom libretro host manually

## ROM Inspection

`scripts/rominspector/rominspector.ts` is a CLI for inspecting a built `.rom`
file. It loads (and transparently decompresses) the ROM, parses the cart header
and TOC, and reports asset layout, manifest, and program/link details. This is
the tool for confirming the `bmsx/assets` address/length symbols and the rest of
the ROM layout without disassembling by hand.

Run it directly with `tsx`:

```bash
npx tsx scripts/rominspector/rominspector.ts dist/nemesis_s.debug.rom --list-assets
```

Options:

- `--list-assets` print the asset table to stdout (id, type, path, size, and
  buffer/metabuffer start/end offsets in hex); this is the default when no other
  output flag is given
- `--manifest` print the cart manifest (and project root path) as JSON
- `--program-asm` print the program image disassembly and exit; source-line
  comments are included when the ROM is not stripped
- `--program-asm-bias <value>` add a base PC to the disassembly addresses,
  accepts decimal or hex (`0x80000` or `80000h`)
- `--program-link-info` print const-pool size, const-reloc count, and any
  symbolic `module`/`export_proto` relocations
- `--cycle-cost` print a fantasy-CPU cycle-cost analysis of the program
- `--ui` / `--ui-native` open the interactive native inspector UI

The header line printed on every run shows header/manifest/toc/data/metadata
offsets and lengths plus the program boot entry, proto count, and code byte
count, so the section layout is visible at a glance.

## Notes

- `build:game` means “build a Lua cart ROM”
- cart folder resolution is `carts/<name>`
- old TypeScript full-game projects were removed instead of being kept as compatibility fallbacks
- the last complete branch that still contains the old TypeScript full-game runtime lives at `archive/ts-full-engine`
