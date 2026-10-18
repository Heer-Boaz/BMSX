# BLua numeric-loop observations

This ordinary cartridge uses `results.lua` for typed BSS and `entry.lua` for
the seven finite loops. No numeric RAM address or library replacement is needed.
The zero-step cases that enter their bodies deliberately end with `break`;
they do not rely on the step to make progress.

From the repository root with the existing development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- loops_manual --debug
npm run headless:test -- loops_manual tests/carts/loops_manual/loops_manual_assert.lua
```

Expect `[test] numeric_loop_control: passed`. Sixteen assertions check the
retained observations after completion. This uses a fresh derived integration
image, not byte-for-byte playback of the ordinary cartridge. The builder selects
the matching BIOS; linked addresses need not match between the two routes.

For separate ordinary playback:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/loops_manual/ordinary_timeline.json loops_manual
```

Compare all six lines; `print` separates arguments with tabs:

```text
Loops headers	3	4	10
Loops cached	4	10	0	7
Loops mutation	3	9	3	9
Loops zero-empty	0
Loops zero-fixed	3	9
Loops zero-equal	2	4
```

Header calls supply start 1, limit 4 and step 1 once, in that order. The cached
case still visits 1 through 4 after the source limit and step locals change.
The mutation cases visit 1,3,5 and 5,3,1. Zero step enters neither a positive
path nor an implicit error path: start 1/limit 3 skips the body, while start
3/limit 1 and start 2/limit 2 retain their values until the written breaks.

The timeline's zero-based presentation offset 4 is an observation endpoint,
not a startup/frame/cycle guarantee or an assertion. These finite TS executions
do not establish native execution, arbitrary numerical termination, NaN/infinite
loop behavior, the separate BIOS runtime compiler, or a whole-language/SDK
contract. CPU7, Table length and BZ01 remain open.
