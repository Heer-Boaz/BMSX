# PCRTC horizontal source sampling

A complete 91-line BLua cartridge (75-line entry plus 16-line const/BSS module)
programs a single GX16 reading circuit. Under reset timing, signal step 4 and
magnification 3 are intentionally unequal. Signal origin 682 leaves first-pixel
phase 2. The 32-signal-unit window becomes 8×1 output pixels, reading source X
32,34,35,36,38,39,40,42 on row 16 from an uploaded 16-pixel red ramp 8000H..800FH.

The program owns GP0, circuit 1, its direct VBlank handler and raw source row
X=32..47, Y=16 with pitch 1024. It assumes no concurrent reader/writer or supervisor
takeover; it is not a general-purpose local-memory allocator. Normal firmware
startup supplies the reset timing words. It does not install a new timing mode.

## Build and ordinary guest check

From the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- pcrtc_sampling_manual --debug
npm run headless:test -- pcrtc_sampling_manual tests/carts/pcrtc_sampling_manual/pcrtc_sampling_manual_assert.lua
```

`unequal_magnification_source_row` verifies all 8 packed GPUREAD words, exact
source/window/extent, framebuffer/PMODE words, a fresh VBlank callback sequence,
and GPU idle with readback drained. Source-word readback and immediate register
reads are not by themselves proof of displayed pixel selection.

## Capture the ordinary cartridge

```sh
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/pcrtc_sampling_manual/pcrtc_sampling_manual_demo.json pcrtc_sampling_manual
```

The timeline captures presentation frame 1, not a guaranteed hardware latency.
The actual 8×1 PNG at `tests/carts/pcrtc_sampling_manual/screenshots/frame_00001.png`
is copied unmodified to `docs/book1/figures/pcrtc-sampling.png`. All 8 RGB pixels
are separately checked: red 0,16,24,33,49,57,66,82; green/blue 0. Capture alpha FF
is not evidence of PCRTC sample alpha 80. The public listing reconstructs both
complete modules and manifest without a private producer or local ABI helper.

## Source precedent and scope

Before implementation, MAME's production
[V9938 owner](https://github.com/mamedev/mame/blob/master/src/devices/video/v9938.cpp)
was inspected for separation of register state, per-line output work and VBlank
events. No foreign address, timing or scanout rule supplies BMSX facts. Actual
paired BMSX PCRTC owners and software consumers are indexed in
[the finite fact sheet](../../docs/book1/facts/pcrtc-sampling.md).

Typed ports/static source storage follow the actual BIOS and the already
executed `pcrtc_window_manual` cartridge. No runtime, BIOS, compiler, renderer,
publisher, helper, ABI encoder, allocation or frame-loop framework is added.
No native, accelerated-backend, physical-clock or whole-manual acceptance is
claimed by this finite example.
