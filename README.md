# BMSX

BMSX is a fantasy console focused on Lua carts.

The TypeScript runtime is the browser/headless/CLI host for the console, and the C++ runtime is  the libretro/RetroArch host.

## Setup

- Node.js 22 or later
- `npm install -D`

## Current Build Model

- BIOS / engine assets: `src/bmsx/res`
- Lua carts: `src/carts/<cartname>`
- Cart resources: `src/carts/<cartname>/res`
- Cart entry + modules: Lua files directly under `src/carts/<cartname>`

There is no longer support for standalone TypeScript game folders under `src/<game>`.

## Common Commands

Build BIOS:

```bash
npm run build:bios -- --debug --force
```

Build a cart ROM:

```bash
npm run build:game -- pietious --debug --force
```

Build browser platform artifacts:

```bash
npm run build:platform:browser -- --debug --force
```

Build headless platform artifacts:

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

Build libretro WSL artifacts:

```bash
npm run build:platform:libretro-wsl
```

Run libretro host on WSL:

```bash
npm run run:libretro-host:wsl:sdl -- ./dist/pietious.debug.rom
```

Input timelines can now carry `capture: true` markers. When the libretro host sees them, it writes screenshots to a `screenshots/` subfolder next to the timeline JSON file.

<!-- Deploy browser artifacts for a cart:

```bash
npm run deploy:browser -- -romname pietious
``` -->

## Project Layout

- `src/bmsx`: shared TypeScript console runtime, BIOS assets, tooling hooks
- `src/bmsx_hostplatform`: browser/headless/CLI host platform code
- `src/bmsx_cpp`: C++ runtime for libretro/custom hosts
- `src/carts`: Lua carts and cart-local resources
- `scripts/rompacker`: BIOS/cart/platform/deploy builders
- `scripts/bootrom`: browser and Node boot entrypoints
- `dist`: generated ROMs and runtime artifacts

## Notes

- `build:game` means “build a Lua cart ROM”.
- Cart folder resolution is `src/carts/<name>`.
> N.B. Old TypeScript game projects were removed instead of being kept as deprecated paths or compatibility fallbacks. The last complete branch that still contains the old TypeScript full game engine lives at: `archive/ts-full-engine`
