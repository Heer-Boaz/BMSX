# BMSX

BMSX is now a fantasy console focused on Lua carts.

The TypeScript runtime remains the browser/headless/CLI host for the console, and the C++ runtime remains the libretro/RetroArch host. Standalone TypeScript game projects have been removed from this branch.

The last complete branch that still contains the old TypeScript full game engine lives at:

- `archive/ts-full-engine`

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
npm run build:bios -- --force
```

Build a cart ROM:

```bash
npm run build:game -- 2025 --force
```

Build browser platform artifacts:

```bash
npm run build:platform:browser
```

Build headless platform artifacts:

```bash
npm run build:platform:headless -- --debug --force
```

Force-build headless + BIOS + cart and run:

```bash
npm run headless:forcebuildallrun -- 2025
```

Run an already-built cart in headless mode:

```bash
npm run headless:game -- 2025
```

Build libretro WSL artifacts:

```bash
npm run build:platform:libretro-wsl -- 2025
```

Run libretro host on WSL:

```bash
npm run run:libretro-host:wsl:sdl -- ./dist/2025.rom
```

Deploy browser artifacts for a cart:

```bash
npm run deploy:browser -- -romname 2025
```

## Project Layout

- `src/bmsx`: shared TypeScript console runtime, BIOS assets, tooling hooks
- `src/bmsx_hostplatform`: browser/headless/CLI host platform code
- `src/bmsx_cpp`: C++ runtime for libretro/custom hosts
- `src/carts`: Lua carts and cart-local resources
- `scripts/rompacker`: BIOS/cart/platform/deploy builders
- `scripts/bootrom`: browser and Node boot entrypoints
- `dist`: generated ROMs and runtime artifacts

## Notes

- `build:game` now means “build a Lua cart ROM”.
- Cart folder resolution is `src/carts/<name>` only.
- Old TypeScript game projects were removed instead of being kept as deprecated paths or compatibility fallbacks.
