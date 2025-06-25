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

## Input State Manager

The `InputStateManager` tracks a short, rolling history of button events for each player, enabling features like input buffering, combo detection, and action prioritization. This system is central to responsive gameplay, especially for fighting games or platformers where precise input timing is critical.

### Key Features

- **Input Buffering:**
  Button presses and releases are stored for a few frames, allowing the game to "see" inputs that happen just before an action becomes available (e.g., buffering a jump or attack during an animation).

- **Action Queuing and Priority:**
  Actions can be queued with a `[pr{n}]` modifier, where higher `n` means higher priority. Higher-priority actions will override or preempt lower-priority ones in the buffer. This is useful for handling complex move sequences or interrupts.

- **Combo and Window Modifiers:**
  The `[w{ms}]` modifier allows you to define a sliding time window (in milliseconds) for chaining actions, enabling combos or multi-step moves that require rapid input.

- **Action Parsing and Modifiers:**
  Action definitions support logical operators (`&&`, `||`), grouping, and modifiers such as:
  - `[p]` for pressed
  - `[j]` for just pressed
  - `[aj]` for all just pressed (multi-button)
  - `[c]` for consumed
  - `[!c]` for not consumed
  - `[t{<50}]` for press time conditions (e.g., short tap)
  - `[ic]` to ignore the consumed state
  - Custom combos and conditions using functions like `?()` and `?j()`

- **Flexible Action Definitions:**
  Actions can be defined as simple button presses or as complex expressions, e.g.:
  - `jump[p] && attack[j]`
  - `?j(a[j!c], b[j!c])` (any just-pressed and not-consumed)
  - `special[w{200}]` (within a 200ms window)

- **APIs for Consuming and Peeking Actions:**
  - `PlayerInput.peekQueuedAction()` returns the highest-priority queued action without removing it.
  - `PlayerInput.consumeQueuedAction()` removes and returns the highest-priority action.
  - `PlayerInput.consumeAction(action)` and `PlayerInput.consumeActions(...actions)` mark actions as handled, preventing them from being processed again.

- **Action State Querying:**
  The `getActionState(action)` method returns a rich object with `pressed`, `justpressed`, `consumed`, `presstime`, and `timestamp` fields, supporting advanced gameplay logic.

- **Multiple Input Sources:**
  Supports keyboard, gamepad, and on-screen controls, with seamless mapping and aggregation.

### Example Usage

```typescript
// Check if a combo is triggered
if (playerInput.checkActionTriggered('down[p] && punch[j]')) {
    // Execute special move
}

// Peek at the next queued action
const nextAction = playerInput.peekQueuedAction();
if (nextAction?.action === 'jump') {
    // Prepare to jump
}

---

Building the TypeScript project alone will not produce a playable game. Always run the rompacker script (or the provided tasks) to generate the `.rom` file and HTML loader.
