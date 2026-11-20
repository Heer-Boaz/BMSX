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
```

Automated BIOS library checks run in the shared [BIOS suite](../../docs/guest_testing.md#running-the-suites).
