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
```

Automated BIOS library checks run in the shared [BIOS suite](../../docs/guest_testing.md#running-the-suites).

For ordinary playback, use:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_math_manual/ordinary_timeline.json bios_math_manual
```
