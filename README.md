# BMSX

BMSX is a fantasy console focused on Lua carts.

The TypeScript runtime is the browser/headless/CLI host for the console. The C++ runtime is the libretro/custom-host runtime.

## Setup

- Node.js 22 or later
- `npm install -D`

## Project Layout

- `src/bmsx`: shared TypeScript runtime, BIOS resources, tooling hooks
- `src/bmsx_hostplatform`: browser/headless/CLI host platform code
- `src/bmsx_cpp`: C++ runtime for libretro/custom hosts
- `src/carts`: Lua carts and cart-local resources
- `scripts/rompacker`: BIOS/cart/platform builders
- `scripts/bootrom`: browser and Node boot entrypoints
- `dist`: generated ROMs and runtime artifacts

## Build Model

- BIOS / engine assets live in `src/bmsx/res`
- carts live in `src/carts/<cart-folder>`
- cart resources live in `src/carts/<cart-folder>/res`
- `build:game` takes the cart folder name, not the ROM manifest name
- headless/CLI use debug artifacts
- libretro/custom-host runs require non-debug BIOS and non-debug cart ROMs

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
npm run run:libretro-host:wsl:sdl -- ./dist/pietious.rom
```

Important:

- `run:libretro-host:wsl:sdl` now runs silently by default with `SDL_VIDEODRIVER=dummy` and `SDL_AUDIODRIVER=dummy`
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
- the last complete branch that still contains the old TypeScript full game engine lives at `archive/ts-full-engine`
