# BIOS Math cartridge

This cartridge calls the installed BIOS math library and leaves the results in
typed BSS for inspection. Float fields use binary32; bounds, counters and
bounded random results use signed words. The entry checks result subtypes
before storage where the distinction would otherwise be lost.

From the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- bios_math_manual --debug
npm run headless:test -- bios_math_manual tests/carts/bios_math_manual/bios_math_manual_assert.lua
```

The integration test waits for the program to complete, then checks its results.
It exercises signed zero, range and type errors, rounding, angular functions and
the seeded generator, including its full-width signed interval. The draws after
rejected bounds and a rejected seed are compared against independent words
from the specified generator sequence. No clock seed or statistical claim is
involved. See the [BIOS math reference](../../docs/book1/bios-math.md).

For ordinary playback without the integration test, use:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_math_manual/ordinary_timeline.json bios_math_manual
```
