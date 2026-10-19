# BIOS Math ordinary cartridge

`results.lua` owns typed BSS; `entry.lua` calls the installed Math library.
There is no cartridge math replacement, guessed address or local ABI helper.
The program uses `//1` explicitly: cartridge policy forbids math.floor.
It calls the other 24 Math routines and reads all four constant fields.

The [complete manual program](../../docs/book1/bios-math.md#sec-bios-math-programming-examples)
prints every source line. Save the storage listing as `results.lua` and join
entry parts 1–5 in order as `entry.lua`; do not create five entry modules.
The [development companion](../../docs/programming/getting-started.md#build-and-inspect-math-operations)
gives the exact project tree and manifest.

From the repository root with the existing development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_math_manual --debug
npm run headless:test -- bios_math_manual tests/carts/bios_math_manual/bios_math_manual_assert.lua
```

Expect `[test] math_observations: passed`: 84 retained assertions follow the
completion wait. The suite uses a fresh derived TS integration image, not
byte-identical ordinary playback; linked addresses may differ and the builder
selects the matching BIOS.

For separate ordinary playback:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_math_manual/ordinary_timeline.json bios_math_manual
```

Compare all 24 `Math ...` lines below. `print` separates arguments with tabs;
its default Number text is not a full-precision dump.

```text
Math rounding	12.5	1	2	-2	-1	2	-2
Math fractions	-1.5	0.5	-3	-0.75
Math selection	-3	8	1
Math supplied values	1	1	1	true
Math missing	true	nil
Math classification	9.0072e+15	1	1	1
Math unsigned	0	1	0
Math signs	-1	0	1
Math modf zero reciprocals	-inf	inf
Math zero signs	1	1	1	1	1	1	1
Math min error	false	min expects at least one argument.
Math max error	false	max expects at least one argument.
Math trigonometry	0	1	0	0.5	0.5	1
Math angles	3.14159	180	0.785398	2.35619	1.5708	0
Math root	3	1	true
Math exponentials	1	2.71828	0.367879	inf	0
Math logarithms	0	3	2	-inf	true
Math nonnumeric angles	nan	nan	nan	1.5708
Math random modes	1	0.236456	3	0	8
Math random replay	1	0.236456	true
Math random error	false	random upper bound must be positive.	0.504242
Math random interval error	false	random upper bound must be greater than or equal to lower bound.	0.0505436
Math random false	0.236068	true	0.819534
Math constants	-9.0072e+15	9.0072e+15	3.14159	inf
```

The stored radian examples are approximately 0.49999999999999994 and
0.5000000000000001; both print as 0.5, without Q16 output quantization. Seed 1 replay and the two bound rejections expose consumed updates;
false seed and false/nil bounds take different branches. No clock-default seed
or statistical quality is tested. The parked tail leaves the observations
available after completion.

The timeline's zero-based presentation offset 4 is an endpoint, not an output
assertion or startup/frame/cycle guarantee. These finite TS results are not
native, all-input/optimizer/accuracy, reset/persistence, BIOS runtime-parser,
SDK or whole-console acceptance. CPU7/Table/BZ01/LS01 remain open.
