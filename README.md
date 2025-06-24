# BMSX

BMSX is a lightweight TypeScript game engine and toolchain used to build small retro-style browser games. Instead of loading assets directly from the web, each game is packaged into a single `.rom` file that contains the engine, game code and resources.

## Features

- **WebGL renderer** with texture atlas support and optional CRT-style effects.
- **Web Audio** integration via the `SoundMaster` module.
- **Input handling** for keyboard, gamepad and on-screen touch controls.
- **Finite State Machine** and **Behaviour Tree** helpers for game logic.
- **Save state** support and built-in debugging tools (state machine and behaviour tree visualizers, rewind UI).

## Project Layout

- `src/bmsx` – the shared engine.
- `src/<game>` – individual games, each with a `bootloader.ts` and a `res/` folder.
- `scripts/` – build utilities such as `rompacker.ts` and `bootrom.ts`.
- `dist/` – output directory for the `.rom` file and generated HTML pages.

## Building

1. Install dependencies with `npm install`. Note that this project uses `tsx` for running TypeScript scripts directly, so you don't need to compile them to JavaScript first.
   If you want to use `tsc` instead, you can run `npm run build` to compile the `rompacker.ts` TypeScript file (and imports) in `scripts/` and run the resulting JavaScript file instead.
2. Run `npx tsx scripts/rompacker.ts -romname <game>` where `<game>` is a folder inside `src/`.
   The "build the game" task in `.vscode/tasks.json` executes this command for you.

During the build the bootloader is bundled with `esbuild`, a texture atlas is generated, resources are packaged and `<game>.rom` plus `game.html`/`game_debug.html` are produced in `dist/`.

Example for building the example game `testrom` which is located in `src/testrom`:
```bash
npx tsx scripts/rompacker.ts -romname testrom
```

## Running

Open `dist/game.html` in a modern browser. The inlined boot loader (`bootrom.js`) fetches the `.rom` file, unpacks it using `pako` and executes the game code.

## ROM Pack Structure

ROM packs are created by `finalizeRompack` in `rompacker.ts`. All resources are concatenated and zipped together with metadata and a small footer containing offsets. A PNG label can optionally be prepended to allow the ROM file to double as an image. Use `scripts/rominspector.ts` to inspect an existing ROM:

```bash
npx tsx scripts/rominspector.ts <file.rom>
```

---

Building the TypeScript project alone will not produce a playable game. Always run the rompacker script (or the provided tasks) to generate the `.rom` file and HTML loader.
