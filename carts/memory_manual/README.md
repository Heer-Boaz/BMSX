# Memory manual example

A small BIOS-started BLua cartridge for byte-storage preparation. The complete
program is `storage.lua` plus `cart.lua`; neither file configures display,
rendering, DMA or interrupts. There is no visible-output claim, hardware
submission API, local encoder, raw-RAM allocator or runtime register table.

`storage.lua` declares two readonly `memory_sample` records, a DATA counter,
two BSS output records and a BSS status record. `cart.lua` uses typed address
views, snapshots the initial DATA value and ORs all six initial output words
before touching that output. It copies the scalar fields with zero-based
indices, advances the counter by the input count, publishes completion and
waits with `halt_until_irq`.

One compile-time `input_count` constant owns both array dimensions and the
exported count. The constant-module export producer does not accept `#inputs`
as an export expression; this example does not change that compiler boundary.
The test separately checks `#storage.inputs` against the exported count.

The source follows actual BIOS precedents: `machine/bios/math.lua`'s DATA scalar
and dereference, `machine/bios/shell/commands.lua`'s readonly array of structs,
and `machine/bios/tty/terminal.lua`'s BSS buffer and typed address views. It does
not introduce a new BIOS export or imply that a firmware-internal helper is
cartridge-callable.

## Run

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

The ordinary integration case requires the same static storage module and waits
for cartridge completion. It checks the initial DATA counter, zero initial BSS
output, final counter, scalar field values, record size/offsets, address-of
stride, raw byte-address arithmetic and every readonly/output word, including
padding. The expected six-word payload is:

```text
00000011 12345678 33441122 00000022 9abcdef0 77885566
```

This is a memory-only example, not permission to allocate beyond linked static
storage, an asynchronous device buffer-lifetime demonstration, persistence
across reboot/startup, a transfer-rate measurement, native execution or runtime
parity evidence. Test assertions live only in the separate guest suite.
