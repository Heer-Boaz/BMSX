# Memory bus-fault manual example

`entry.lua` is the complete cartridge program. It deliberately loads a Word
from `0x01000000`, the beginning of the unmapped gap after system ROM. The
load enters the installed BIOS monitor before its result can be assigned to
`reached_after_load`. There is no cartridge exception handler or repair path.

Build and exercise the ordinary keyboard/terminal route from the repository
root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- memory_fault_manual --debug
npm run ide:test -- memory_fault_manual tests/ide/memory_fault_manual.idetest.js
```

The existing host test sends real keyboard events to the BIOS terminal. It
inspects physical latches without modifying them or running a guest expression.
Its commands are:

```text
MEM 08010208 3
FAULT CLEAR
CONT
```

The actual first command prints:

```text
08010208: 00000001 01000000 00000801
```

These words are the Memory fault CODE, ADDR and ACCESS, respectively. The BIOS
reports DBE with cause `0000001C`. Its EPC identifies this particular linked
load instruction; do not use that build's EPC as a universal address. DBE does
not establish a fresh CP0 bad-address value.

`FAULT CLEAR` discards the BIOS's saved fault report, not the hardware bus-fault
latch. `CONT` retries at the unchanged EPC; the bad address has not been
repaired, so this program faults again. The test verifies both distinctions,
plus the retained first hardware fault and the newly published supervisor
fault sequence. It does not claim successful recovery, native parity or
instruction-timing measurement.

Captures go to the existing `tests/ide/screenshots/` directory. No new capture
tooling, exception API, runtime/compiler change or source-manipulation path is
part of the example.
