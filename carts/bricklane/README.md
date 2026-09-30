# Bricklane

A small 320x240 brick-breaker, created from an empty cart through Studio.
Clear six bricks without losing all three lives.

- **Left / right:** move the paddle.
- **Space:** serve; after winning or losing, reset to the ready screen.
- Paddle edges steer the ball. The top-left markers show cleared bricks;
  the top-right markers show remaining lives.

Build with **Studio: Build Cartridge** (`bricklane`, debug, O3). In **Studio:
Build Jobs**, open the completed build. That window loads the published BIOS/cart
pair; it does not replace the original running machine or compile newer drafts.
For a normal exported ROM instead:

```sh
npm run build:toolchain:cart -- bricklane --debug -O3
```

Then open `/studio.debug.html?rom=bricklane.debug.rom` on the existing server.

## Studio authoring and live verification

The 2026-09-30 session used real browser keyboard/pointer input plus the public
Studio MCP endpoint through the official MCP SDK:

1. **File: New Cartridge** created `bricklane`; no shell-created scaffold.
2. Source reads and reviewed edit proposals authored `entry.lua`; the ordinary
   **Apply Workspace Edit** saved it. Source Reboot discovered the new input,
   clock and clamp imports without a shell rebuild or prepacking those modules.
3. Studio builds surfaced a Lua lint rejection. A second reviewed edit replaced
   the repeated phase comparison with a membership table; no lint rule was
   disabled. The subsequent full build completed and was opened from Build Jobs.
4. Actual arrow/Space input controlled the game. Structured runtime inspection
   read `bricklane`, its ball and all six brick flags. The published game was
   won with three lives remaining; Space reset score, lives, bricks and paddle.
5. Frame navigation verified collisions and winning in both directions. These
   are observed session positions, **not fixed gameplay or presentation tests**:

| Published-game observation | Video tick | Score | Phase | Ball x/y | Ball vx/vy |
| --- | ---: | ---: | --- | --- | --- |
| Before first brick | 771 | 0 | play | 247 / 61 | 2 / -3 |
| After one frame | 772 | 1 | play | 249 / 60 | 2 / 3 |
| Before final brick | 1520 | 5 | play | 248 / 48 | 3 / -3 |
| After one frame | 1521 | 6 | won | 248 / 45 | -3 / -3 |

Each backward/forward pair matched the original machine cycle, game fields,
ball fields and brick flags. The earlier source-Reboot run also exercised and
rewound life loss and game over. This is inspected-state equality, not a claim
that every hardware byte or renderer has been compared.

The ordinary cart Terminal returned `won, 6, 3`. An installed-source breakpoint
then exposed `update_cart` and its `game` local. Frame-context Terminal evaluation
read that actual binding. This uncovered and verified a fix to premature
Terminal/Actor completion receipts; see
[completion boundary](../../docs/studio_lua_terminal.md#completion-boundary-2026-09-30).

Gameplay was **not** driven through screenshots, private browser runtime objects,
heap injection or Terminal writes. Game captures were used only to inspect the
ready/won artwork. Browser DOM and debugger diagnostics were separately used to
investigate browser startup. Shell work was limited to environment setup,
diagnostic clients, product fixes/builds and this documentation.

Local evidence: `.bmsx/authoring/bricklane-20260930/` contains `actions.jsonl`,
`probe-tools.jsonl`, `states.jsonl`, `completion-sequence.jsonl` and build receipts.
The tested artifact was
`a487e5b665cfc0d14a7aa70d052ac722f22873bedec1b13042507e882ba1df23`.
These ignored local files are not build dependencies.

## Open observation: multiple accelerated windows

In the Playwright Chromium/SwiftShader environment, a third concurrent Studio
window stalled at `navigator.gpu.requestAdapter()`, before Studio initialization.
The same artifact booted in a fresh browser and continued immediately when the
old empty-cart window was unloaded. Two Studio windows, including reloading the
published game, worked. A minimal three-window WebGPU example did **not** hang,
so this has not been established as a general browser limit or an upstream bug.
No timeout, silent renderer fallback or forced closure of user windows was added.
Real GPU/phone behavior and the exact multi-window cause remain unverified.

The game retains state and separates input/update/render using existing cartlib
APIs. The production reference studied was
[SDL's snake example](https://github.com/libsdl-org/SDL/blob/main/examples/demo/01-snake/snake.c);
its loop is adapted to BMSX's normal IRQ/vblank scheduling, not host wall time.
