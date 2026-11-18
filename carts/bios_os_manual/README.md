# BIOS time and calendar cartridge

This cartridge calls the installed `os.clock`, `os.time`, `os.date` and
`os.difftime` interfaces from the [BIOS OS chapter](../../docs/book1/bios-os.md).
It publishes exact calendar timestamps in word fields and fractional or
out-of-Integer results in Float fields. Date tables, strings and protected-call
results remain guest values.

From the repository root:

```sh
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- bios_os_manual --debug
npm run headless:test -- bios_os_manual tests/carts/bios_os_manual/bios_os_manual_assert.lua
```

The case waits for the cartridge to finish. It checks the calendar fields
and formatting of known instants, normalization, differences and error results.
Live clock readings are checked by range, not against the time of the host.
