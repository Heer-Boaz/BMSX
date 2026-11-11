# Runtime Bench

One cartridge for interpreter/native and host/renderer comparisons. It boots
through the real BIOS and uses cartlib's input and World schedule. No assets
are needed beyond the existing default font.

## Controls and work

| Control | Keyboard | Controller |
| --- | --- | --- |
| Previous/next mode | Left/right arrow | D-pad left/right |
| Larger/smaller population | Up/down arrow | D-pad up/down |
| Restart selected run | X | A |

The initial selection is **WORLD DRAW, 16 rows**. Populations are 16, 128 and
512. Each selection/restart starts a deterministic **256-update run**, then
holds its final state. Input remains active after completion.

1. **LUA TABLES:** ordinary nested tables, numeric/indexed fields, eight-slot
   histories and bounded row replacement. The common BIOS/input/World schedule
   remains; this mode skips World actor lifecycle and event dispatch.
2. **WORLD NO DRAW:** prefab-created WorldObjects, retained active-definition
   views, Registry identity and tag changes, object-method calls, scoped event
   subscriptions and structural admission/disposal barriers.
3. **WORLD DRAW:** exactly the same World simulation as mode 2, plus a retained
   visual component and default-font text submitted by `world:render()`.

Every eighth update broadcasts a pulse (the table reference applies the same
state transition directly). Every sixteenth update replaces one row/object.
Other row/history/event storage is retained. There is no host-time input, random
seed or scene-dependent work reduction. Drawing displays all live rows and
refreshes the work/counter text every sixteen updates.

All modes present **one selection card at reset**; modes 1/2 submit no more draw
work until selection/restart. Mode 3 presents its completed result once, then
stops drawing too. Thus neither a long timeline nor an average over its idle
tail is an active-work throughput measurement.

## Completed-work contract

`runtime_bench` is the actual guest state table, not a host profile API. Read
its `mode`, `size_index`, `count`, `generation`, `steps`, `target_steps`, `work`,
`checksum`, `events`, `replacements` and `finished` fields. For a completed run:

| Rows | Steps | Work | Events | Replacements | Checksum |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 256 | 4096 | 512 | 16 | 1726556469 |
| 128 | 256 | 32768 | 4096 | 16 | 1659401335 |
| 512 | 256 | 131072 | 16384 | 16 | 831473187 |

The checksum accumulates each update before its replacement barrier; it is not
a serialization hash. The regression additionally compares every row's final
position, velocity, statistics and history, and checks World/Registry membership.

Compare interpreter/native with **the same ROM, mode, population and completed
work**. Modes have different guest implementations and instruction counts;
matching gameplay fields across modes does not mean identical CPU/device state.
Report setup, active work and completed idle separately. No frame-rate or timing
conclusion follows from a successful determinism check.

## Build and validate

```sh
npm run build:toolchain:cart -- runtime_bench --debug -O3
npm run build:toolchain:bios -- --debug
npm run build:product:node-headless-tooling -- --debug
npm run headless:test -- runtime_bench tests/carts/runtime_bench/determinism_assert.lua
```

The three integration cases use real keyboard/pad input, complete all modes at
each population, restart the plain-table run and compare the retained results.
They exercise BIOS/cartlib and headless software rendering, not a visible
libretro window. For the release cartridge use:

```sh
npm run build:toolchain:cart -- runtime_bench -O3
```

Nine `tests/carts/runtime_bench/{plain,world,draw}_{16,128,512}.json` timelines
select the mode/population, restart at marker 480 and end at marker 2400. Their
40-frame key holds are for ordinary sampled input. These are **host timeline
markers, not simulation steps or proof of completion**. The libretro host counts
completed cartridge-session `retro_run()` calls, independent of video delivery;
the Node tooling timeline counts presented frames from cartridge activation.
Read the guest completed-work fields rather than assuming these clocks advance
one simulation update per marker. Use the same host/clock for a paired run.

The protocol follows [MAME's fixed-emulated-time benchmark distinction](https://docs.mamedev.org/commandline/commandline-all.html#mame-commandline-bench)
and [DuckStation's regression runner](https://github.com/stenzek/duckstation/blob/master/src/duckstation-regtest/regtest_host.cpp):
explicit input/horizon, separate rendering configurations and state validation.
