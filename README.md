# BMSX

BMSX is an emulated machine with real emulator discipline.

BMSX is documented and implemented as if it were an obscure physical console:
carts run against CPU, RAM/ROM, MMIO registers, and device controllers. Host
code exists to present audio, video, input, files, and platform entrypoints; it
should not become the cart-facing hardware contract.

The TypeScript implementation builds a JavaScript machine runtime plus browser
and Node hosts. The C++ implementation mirrors the machine structure and supplies C++ machine and host artifacts.

The technical manuals specify the console. See `docs/architecture.md` only for
internal software ownership, dependencies and host/tooling boundaries.

## Setup

- Node.js 22 or later
- `npm ci --include=dev`
- Linux/WSL native requirements: see the [first-build prerequisites](docs/programming/getting-started.md#prerequisites).

## First cartridge and hardware reference

Start with [Build and inspect example cartridges](docs/programming/getting-started.md)
for a visible GPU picture, source layout and project-tool commands. That companion
describes this repository, not a manufacturer-mandated SDK. The working manual
series separates three scopes:

- **Book I — System and Hardware Reference:** begin with the
  [System overview](docs/book1/console.md), then follow its links to the owning
  hardware chapters and [Memory and bus access](docs/book1/memory.md).
- **Book II — BLua32 and BIOS Reference:** begin with
  [CPU and BLua32 instructions](docs/book1/cpu.md),
  [BLua source programs and extensions](docs/book1/blua-programs.md), and
  [Program images and startup](docs/book1/program-images.md). BIOS services
  include [monitor diagnostics](docs/book1/bios-monitor.md). Cartridge source
  is not assumed to be ordinary Lua.
- **Book III — Cartridge and Expansion Reference:**
  [Cartridge sockets and mapped card devices](docs/book3/cartridge.md).

These are working drafts, not a complete or released console-reference series.

### Publishing the manuals

The Markdown books use [Quarto](https://quarto.org/docs/get-started/) 1.10.19 or
later with LuaLaTeX. Install Quarto, then its supported TeX distribution with
`quarto install tinytex`. On Ubuntu/WSL, SVG conversion and the publication fonts
are supplied by `sudo apt-get install librsvg2-bin fonts-liberation fonts-dejavu-core`.

From the repository root, build and publish locally with one command:

```sh
npm run manual:build
```

The PDFs are committed under `docs/pdf/` for direct viewing on GitHub:

- [Book I — System and Hardware Reference](docs/pdf/bmsx-book-i.pdf)
- [Book II — BLua32 and BIOS Reference](docs/pdf/bmsx-book-ii.pdf)
- [Book III — Cartridge and Expansion Reference](docs/pdf/bmsx-book-iii.pdf)

The complete generated publication is `dist/manual/`: `index.html` opens the
HTML reference, and `pdf/` contains the same three volumes linked from its
download menu. This directory stays outside Git and can be served or copied as
a whole. Native MathML and system fonts avoid font/formula CDNs. No GitHub build
or deployment is involved.

For local browsing, `npm run manual:preview` serves the HTML with live reload.
The [authoring guide](docs/manual/README.md) describes source conventions.

## Project Layout

- `machine/ts/machine`: TypeScript CPU, memory, MMIO bus, device controllers, program loader, and runtime lifecycle
- `machine/ts/common`: low-level shared helpers
- `machine/ts/audio`: host-side audio playback/output code, not the machine audio device
- `ide`: editor, terminal, workbench, and IDE runtime tooling
- `machine/bios`: the guest system-ROM source, organized by BIOS responsibility
- `cartlib`: independent cartridge software, not installed BIOS or firmware; linked into carts that choose to use it
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

The technical manuals are the hardware and BIOS product specification; internal
architecture documentation is not another hardware reference. Machine ABI values such as register
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
- `dist/host_headless_tooling.js`: Node timelines, captures, scenario tests, IDE tests, and profiling.

## Timing integration

Machine scheduling is independent of host pacing, UI pause and output transport.
The device owners supply emulated deadlines; hosts admit execution and present
completed output through their existing frame owners. Installed clocks, reset
settings and programmable video timing belong in the [console](docs/book1/console.md)
and [PCRTC](docs/book1/pcrtc.md) references, not a second table in this README.

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

Run an explicit scenario test:

```bash
npm run headless:test -- pietious tests/carts/pietious/pietious_enter_world_assert.lua
```

Important:

- `headless:forcebuildallrun` and `headless:game` take the cart folder name
- `test:render-parity` force-builds and compares the render test carts through TS headless and the C++ libretro host
- headless runs `dist/host_headless.debug.js` with `dist/system/bmsx-bios.debug.rom`; it does not dynamically load `dist/libbmsx.debug.js`
- `headless:tooling` runs the separate `dist/host_headless_tooling.debug.js` validation product
- scenario tests are always explicit; `headless:game` does not auto-load assert modules
- the ordinary player never scans `tests/` or auto-loads `<cart>_demo.json`
- headless tooling timelines run unpaced, so the full scenario completes as fast as the emulator can simulate it
- `headless:test` and `headless:forcebuildalltest` are the explicit scenario-test paths
- Lua scenario tests run through the shared
  `ide/workbench/contrib/scenario_lab/execution_service.ts` owner; the headless
  host only adapts that owner to its frame and capture lifecycle. The packaged
  Lua API exposes `host.press(code, ticks)`, `host.down(code)`,
  `host.up(code)`, `host.at(tick, command)`, `host.capture(label)`, and
  `host.log(message)` for logical-tick input schedules

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
- the libretro core loads `dist/system/bmsx-bios.rom`, not `dist/system/bmsx-bios.debug.rom`
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
