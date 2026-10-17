# IRQ-controller cartridge example

This is a direct `irq(flags)` experiment, not a rendering demonstration. It
keeps the standard BIOS's running display timing so periodic VBlank can become
pending, while `IRQ_MASK=0` prevents maskable delivery during preparation.

The experiment assumes no unrelated interrupt producers are enabled, no
concurrent GP0 owner, and no unfinished GP0 packet, readback or DMA transfer.
It waits for GPU idle before starting, clears the GPU-local latch and clears
controller requests other than the deliberately retained VBlank bit.

Two masked GPU markers coalesce into one pending bit. Unmasking only GPU
delivers the complete pending word `44`, including disabled VBlank. The direct
handler clears the GPU-local latch and acknowledges controller GPU only. A
third rearmed marker produces a second service; both handlers retain `44`.
The final mask is zero and pending VBlank remains `04`.

`results.lua` owns the explicit BSS result record and exports its address at
compile time. The cartridge and ordinary integration suite consume that same
address through typed pointers. The handler and experiment allocate no tables.
Predicate loops use `halt_until_irq` only while GPU delivery is enabled; masked
source preparation polls its actual pending/latch predicates instead.

```sh
npm run build:toolchain:cart -- irq_manual --debug
npm run headless:test -- irq_manual tests/carts/irq_manual/irq_manual_assert.lua
```

The suite checks all eight retained phase snapshots, both complete handler
words, service counts, ACK-zero preservation, and final controller/source
latches. It does not capture a picture or establish native/backend parity,
fixed IRQ latency, event-counting hardware, or sustained interrupt throughput.
