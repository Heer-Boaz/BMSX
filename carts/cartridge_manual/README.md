# Two cartridge sockets, mailbox edges and independent DMA endpoints

`cartridge_manual` is the bootable **socket 0** card: ROM,256 bytes RAM and a
mailbox. `cartridge_manual_data` is the **socket 1** data-only card:256 bytes
RAM and a mailbox, with no ROM device and no program entry. A package filename
ending in `.rom` does not override its manifest's hardware definition.

The ordinary program uses typed BLua ports, readonly payload and explicit BSS.
It owns DMA0, both mailboxes, central cartridge bits9/10 and card-RAM bytes0–31
in both sockets. It masks IRQ delivery and polls raw status; it does not use a
cartlib DMA callback or an invented BIOS cartridge-discovery API. Both payload
endpoints carry explicit DMA socket overrides while ordinary CPU data selection
remains1. This is not a FIFO or remote-processor protocol.

With the supplied assertion present before the debug build, run from repository
root on a **fresh machine**, not a warm-reset/rerun whose card RAM is retained:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- cartridge_manual --debug
npm run build:toolchain:cart -- cartridge_manual_data --debug
npm run headless:test -- cartridge_manual \
  tests/carts/cartridge_manual/cartridge_manual_assert.lua \
  --slot1 dist/cartridge_manual_data.debug.rom
```

The existing integration route retains both immutable media definitions but
compiles a derived socket0 image containing the ordinary program and supplied
assertions. Absolute linked seed/result addresses need not equal those in the
ordinary ROM. A successful test verifies both independent RAM sentinels, both
mailbox readbacks/IRQ rearm sequences, all four transferred words, untouched
socket0 destination words, DMA addresses/count/status/masked pending, CPU
SELECT1 and zero bus fault. It does not measure a CPU launch-to-completion
interval. The chapter's72cycle block budget is conditional on admission under
installed coefficients, not a value inferred from these polling snapshots.

Before implementation, MAME's
[MSX HALNOTE cartridge owner](https://github.com/mamedev/mame/blob/master/src/devices/bus/msx/cart/halnote.cpp)
was inspected for separation of socket mapping, owned ROM/RAM and reset. No
foreign mapper addresses, capacity, API, behavior or timing is a BMSX fact.
The manual chapter, development route and independent reviews are separate
from this short example description. No runtime/compiler/BIOS/publisher change
is made. No native execution of this complete cartridge or physical-hardware
rating is claimed by the focused native owner tests.
