# DMA cartridge example

This cartridge follows the BIOS's typed word-port writes and BSS completion
sequence. It owns both DMA channels and GP0; no `cartlib/irq` or `cartlib/dma`
handler is installed alongside its direct `irq(flags)` entry. It assumes no
unfinished transfer, partial GP0 packet or readback from another owner. The
standard BIOS's display timing continues unchanged.

The three phases are deliberately different:

1. Copy twenty varied raw words from cartridge `rodata` into BSS RAM with
   channel 0. Both endpoints increment; blocks contain at most sixteen words.
2. Program both channels before either START. Copy that RAM source into two
   independent BSS destinations: channel 0 uses sixteen-word blocks and channel
   1 uses four-word blocks. Retain the two BUSY observations, then wait for both
   completion sequences. IRQ delivery order is not an arbitration trace.
3. Set GP1 DMA direction to CPU-to-GP0. Copy a five-word readonly command stream
   into the **fixed** GP0 port, gated by GX_WRITE. The stream clears the drawing
   mask mode, fills a red 64-by-64 area at `(0,0)`, then requests the GPU marker.
   Wait for DMA completion first; observe GPU status; separately wait for the
   GPU-local marker and GPU idle. Acknowledge the GPU-local and controller
   latches independently.

Each sequence is sampled **before** its START. The direct handler increments
only the DMA0/DMA1 BSS sequences and acknowledges `flags & 00000101H`. GPU
requests remain masked while phase 3 polls them. Disabled VBlank is neither
acknowledged by this handler nor treated as a failure. The final mask is zero.

`results.lua` declares the actual BSS record and exports its address at compile
time. Snapshots retain final addresses, count, control, status and trigger for
each transfer. There is no register table, heap-state facade, test MMIO or
runtime helper.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- dma_manual --debug
npm run headless:test -- dma_manual tests/carts/dma_manual/dma_manual_assert.lua
```

The ordinary integration case checks all sixty destination words, final raw
register words, three DMA0 services and one DMA1 service, and actual overlap of
BUSY channels. In this controlled run, GPU-local request and idle are both clear
at the first status observation after DMA completion; the later marker and idle
are retained separately. The suite then issues a one-pixel C0 readback and
checks raw RGB555 `0000001FH`, including the zero high half of an odd final
readback word.

These are executed submission/data-path observations, not a display screenshot,
native/backend parity, fixed CPU/IRQ latency, arbitration timing trace or
sustained DMA bandwidth measurement. Neither DMA DONE, the GPU marker nor GPU
idle alone proves that a picture was displayed.
