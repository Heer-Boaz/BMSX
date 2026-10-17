# IMGDEC cartridge example

An ordinary BLua cartridge, using the BIOS's typed-port, readonly-source and
BSS completion-sequence patterns. It programs raw DMA/IMGDEC register words;
there is no new BIOS API, cartlib wrapper, local token encoder or submission
helper. `results.lua` owns the typed BSS result record. DATA reads are explicit
because they consume output; DATA is not copied as part of a register snapshot.

The cartridge exclusively owns DMA0, DMA1, IMGDEC and GP0. It assumes no previous
DMA transfer, partial GPU packet or GPU readback is in flight. Display timing
is left to the normal BIOS. Its direct `irq(flags)` entry services only DMA0,
IMGDEC and DMA1 (`00000181H`), increments three independent completion sequences,
and acknowledges only those owned bits. Each operation samples its sequences
before START and uses sequence-predicate `halt_until_irq` waits. Disabled,
unrelated IRQs may remain pending; the final IRQ mask is zero.

## Four phases

1. Feed the 19-word readonly stream with all four token kinds into IMGDEC using
   DMA0 (`CTRL=00003D41H`). DMA1 reads the fixed DATA port into 26 incrementing
   BSS words (`CTRL=00003C1AH`). Both channels are armed before IMGDEC START.
   The expected payload is twelve texture words and eight CLUT words; the six
   additional words are the two A0 headers. Final progress is received 19,
   decoded 20, IMGDEC status `2`, and both channels count `0`/status `2`.
2. Repeat the same stream with DMA1 writing the **fixed** GP0 port
   (`CTRL=00003C58H`). Set GP1 DMA direction 2, disable E6 mask protection, and
   establish initial GPU idle. Wait for both DMA sequences, independently wait
   for the IMGDEC sequence, then wait for GPU idle. Texture destination/size are
   `00400040H`/`00060004H`; CLUT destination is `00800040H`.
3. CPU-feed `[31444D49H, 3, 0, 80000000H]`: its first payload token requests a
   back-reference before any history exists. Neither DMA channel is armed for
   this phase, so a format fault cannot strand an output channel waiting for
   DREQ. Retain status `10H`, received `4`, decoded `0`; drain the three queued
   A0-header words and read DATA once more to retain the last header word.
4. START `[31444D49H, 0, 0]` using both DMA channels and a separate three-word
   BSS output. The new destination `00200020H` and size `0` distinguish its
   emitted header from the faulted stream. Final IMGDEC status is `2` with
   received `3`, decoded `0`, and both DMA counts `0`/status `2`.

## Reproduce

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- imgdec_manual --debug
npm run headless:test -- imgdec_manual tests/carts/imgdec_manual/imgdec_manual_assert.lua
```

The integration case checks every retained output word, decoder progress,
DMA count/status, both channels armed before each valid START, and per-phase IRQ
sequences ending at DMA0/DMA1/IMGDEC `3/3/4`. It then performs actual C0/GPUREAD
readback of all twelve texture words and eight CLUT words. This is data-path
evidence, not a displayed-picture claim, screenshot, fixed CPU/IRQ latency,
arbitration trace, throughput measurement, native execution claim or complete
IMGDEC manual. No scratch replay timing is presented as guest routine latency.
