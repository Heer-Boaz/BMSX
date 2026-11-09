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

1. Feed the 16-word readonly stream with all four token kinds into IMGDEC
   using TO_IMGDEC on DMA0. FROM_IMGDEC on DMA1 writes twenty raw BSS words:
   twelve texture words and eight CLUT words, with no headers. Both channels
   are armed before decoder START. Final progress is received 16, decoded 20,
   IMGDEC status `2`, and both channels count `0`/status `2`.
2. Repeat the same stream using IMGDEC_TO_GPU on DMA1. The CPU supplies an
   A0 header for the texture, drains twelve words, then supplies the CLUT header
   and drains the remaining eight words. GPU destinations/sizes are
   `00400040H`/`00060004H` and `00800040H`/`00010010H`. DMA1 completes twice;
   neither IMGDEC nor DMA manufactures either header.
3. CPU-feed `[80000000H]`, an invalid reference before any history exists,
   declaring three output words. No DMA channel is armed. Retain status `10H`,
   received `1`, decoded `0`; DATA reads retain the input token without exposing
   unpublished output.
4. Recover with `[40000002H, 12345678H]`: TO_IMGDEC feeds the two-word stream
   and FROM_IMGDEC writes three repeated raw words to a separate BSS buffer.
   Final IMGDEC status is `2`, received `2`, decoded `3`, and both DMA channels
   have count `0`/status `2`.

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
sequences ending at DMA0/DMA1/IMGDEC `3/4/4`. It then performs actual C0/GPUREAD
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
