# IMGDEC cartridge example

An ordinary BLua cartridge, using the BIOS's typed-port, readonly-source and
BSS completion-sequence patterns. It programs raw DMA/IMGDEC register words;
there is no new BIOS API, cartlib wrapper, local token encoder or submission
helper. `results.lua` owns the typed BSS result record. DATA reads are explicit
because they consume output; DATA is not copied as part of a register snapshot.

The cartridge exclusively owns DMA0, DMA1, IMGDEC and GP0. It assumes no previous
DMA transfer, partial GPU packet or GPU readback is in flight. It configures a
static GX16 display window separately from the texture and CLUT storage.
Its direct `irq(flags)` entry services only DMA0,
IMGDEC and DMA1 (`00000181H`), increments three independent completion sequences,
and acknowledges only those owned bits. Each operation samples its sequences
before START and uses sequence-predicate `halt_until_irq` waits. Disabled,
unrelated IRQs may remain pending; the final IRQ mask is zero. The final GPU
marker is polled and acknowledged separately at the GPU and central controller.

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

## Display continuation

After the four decoder jobs, a raw palette4 quad uses the successful upload.
The 4 × 6 storage halfwords contain 16 × 6 indexed texels; the GPU draws them
over a purple `3088H` rectangle. Both palette indices 0 and 1 fetch `0000H`
and preserve that rectangle rather than drawing black.

The selected scanout starts at local X256. Its 120 × 40 patch appears at output
(64,72); the texture at (64,64) and CLUT at (64,128) are outside that scanout.
The exact affine UVs give four-pixel first/last source rows and columns and
eight-pixel interior ones, not a uniform eight-times image enlargement.
No fifth decoder job, local token encoder or new firmware interface is added.

## Reproduce

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- imgdec_manual --debug
npm run headless:test -- imgdec_manual tests/carts/imgdec_manual/imgdec_manual_assert.lua
```

The integration case checks every retained output word, decoder progress,
DMA count/status, both channels armed before each valid START, and per-phase IRQ
sequences ending at DMA0/DMA1/IMGDEC `3/3/4`. It then performs actual C0/GPUREAD
readback of all twelve texture words and eight CLUT words. Before readback it
captures the full 256 × 192 image at
`tests/carts/imgdec_manual/screenshots/frame_00001.png`. It additionally compares
360 packed picture words across six complete rows and one outside-background
word: 381 GPUREAD words in total. These selected raw rows and the displayed
capture are separate evidence; this is not raw readback of every displayed pixel.

The capture uses a derived integration image. With the headless player built,
ordinary-ROM playback is separate:

```sh
npm run headless:game -- imgdec_manual --ttl 2
```

TTL 2 is 2000 ms of virtual host time; exit alone does not verify the picture.
Neither route proves fixed CPU/IRQ latency, arbitration timing, physical
throughput, native/accelerated parity or whole-manual completeness.
