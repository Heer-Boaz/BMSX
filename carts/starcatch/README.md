# Starcatch

A small 320x240 game authored from `emptycart` in Studio. Catch twelve gold
stars, dodge the red blocks, and keep at least one of three lives.

- **Left / right:** move the paddle.
- **Space:** start or restart after winning or losing.
- Missing a star or catching a red block costs one life.
- Every third drop is a red block; stars fall faster as the score increases.

Build through **Studio: Build Cartridge** (`starcatch`, debug, O3), or build and
export to `dist` with:

```sh
npm run build:toolchain:cart -- starcatch --debug -O3
```

With the ordinary Studio server running, open
`/studio.debug.html?rom=starcatch.debug.rom`. A Studio build publishes media; it
does not replace the running cartridge. The CLI command above exports that same
artifact for a subsequent normal boot.

## Inspecting gameplay in Studio

The `starcatch_*` globals expose the paddle, falling object, score, lives, delay
and game state. Use the shared runtime inspection tools to read them without
executing Lua. Use `studio_step_frames` in either direction and
`studio_seek_history` to navigate retained history, then open a fresh inspection.
Do not evaluate Lua merely to read a historical frame: that is guest execution,
not read-only inspection.

The authoring run on 2026-09-30 exercised a complete win (12 stars, 3 lives), a
red-block hit, missed stars, game over and restart. A subsequent MCP session
navigated the same running Studio window without screenshots or state writes:

| Navigation | Video tick | Lives | Drop | Drop Y |
| --- | ---: | ---: | ---: | ---: |
| Before a miss | 10083 | 2 | 4 | 232 |
| Forward one frame | 10084 | 1 | 5 | 28 |
| Backward one frame | 10083 | 2 | 4 | 232 |
| Forward again | 10084 | 1 | 5 | 28 |

The repeated positions matched in machine cycles and all ten inspected game
globals. These are observations from that session, not hard-coded game contracts.
Local receipts are in `.bmsx/authoring/starcatch-20260930/mcp-actions.jsonl` and
`frame-navigation-evidence.json`; they are not required to build the cart.

Preparation outside Studio was limited to the initial unchanged `emptycart`
scaffold, development-server/browser setup, artifact export and this packaging
metadata/documentation. Gameplay source was edited and saved in Studio. The
initial screenshot-heavy validation was replaced with the structured tool loop.

The game uses `cartlib/gx/gpu` and `cartlib/input/input`; no local hardware ABI
encoders or new runtime hooks were added. The update/draw and screen-state
structure was informed by Raylib's production examples:
[screen manager](https://github.com/raysan5/raylib/blob/master/examples/core/core_basic_screen_manager.c)
and [rectangle collisions](https://github.com/raysan5/raylib/blob/master/examples/shapes/shapes_collision_area.c).
