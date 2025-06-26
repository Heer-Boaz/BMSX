## Building

1. Install dependencies with `npm install`. Note that this project uses `tsx` for running TypeScript scripts directly, so you don't need to compile them to JavaScript first.
   If you want to use `tsc` instead, you can run `npm run build` to compile the `rompacker.ts` TypeScript file (and imports) in `scripts/` and run the resulting JavaScript file instead.
2. Ensure you have `tslib` installed globally, as it is required for the TypeScript runtime. You can install it with:
   ```bash
   npm install -g tslib
   ```
3. Run `npx tsx scripts/rompacker.ts -romname <game>` where `<game>` is a folder inside `src/`.
   The "build the game" task in `.vscode/tasks.json` executes this command for you.

During the build the bootloader is bundled with `esbuild`, a texture atlas is generated, resources are packaged and `<game>.rom` plus `game.html`/`game_debug.html` are produced in `dist/`.

Example for building the example game `testrom` which is located in `src/testrom`:
```bash
npx tsx scripts/rompacker.ts -romname testrom
```
> **WARNING**: Any other attempt at building the TypeScript project (e.g. `tsc` or `npm run build`) will **FAIL**! Always run the rompacker script to generate the `.rom` file and HTML loader. DON'T EVEN ATTEMPT TO RUN `tsc` OR `npm run build`! The TypeScript project is not a standalone game, but rather a collection of modules that are used by the rompacker script to create a final game package. That also implies that multiple games can be built from the same TypeScript project, as long as they have their own `bootloader.ts` and `src/`-folder that also includes a `res/`-folder.