# GPU raw-image DMA example

A normal BLua cartridge uploads a raw 9×9 image from initialized RAM through
fixed GP0, then reads the same 81 sixteen-bit pixels through fixed GPUREAD into
a separate 41-word BSS buffer. It owns DMA0 and the GPU ports, masks interrupts
and polls. It does not program PCRTC or claim displayed-picture evidence.

The complete program is printed in the GPU chapter under
[Move a raw image through DMA](../../docs/book1/gpu.md#sec-gpu-move-a-raw-image-through-dma):
`storage.lua` is the const module; the following three code blocks concatenate
in order into the single entry module `cart.lua`. The literal files here are
those built and executed, not pseudocode or register values in Lua tables.

## Cartridge files and ordinary commands

The two Lua files are at this directory's root. The remaining source file is
`res/manifest/manifest.rommanifest`:

```yaml
title: GPU Image DMA Manual Example
hardware:
    - type: rom
```

From the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- gpu_dma_manual --debug
npm run headless:test -- gpu_dma_manual tests/carts/gpu_dma_manual/gpu_dma_manual_assert.lua
```

The ordinary integration case `raw_image_roundtrip` checks every returned word,
including the unused upload high half `ffff` becoming zero in the final returned
`00000051`. It checks completed counts/status/address advancement, the immediate
BUSY read retaining the earlier GPUREAD latch, READY drainage, and separate
marker and idle observations. This is real TypeScript guest-path evidence,
not native-runtime, electrical-rate or display acceptance.

## Existing production and BIOS patterns

Before implementing the example, DuckStation's
[DMA owner](https://github.com/stenzek/duckstation/blob/master/src/core/dma.cpp)
was inspected for separate request, transfer, cycle-charge and completion
responsibilities. No PSX address, bus timing, channel count or API supplies BMSX
facts. The BMSX paired owners and spec leaves supply those facts.

Actual BIOS precedents are [`kernel/dma.lua`](../../machine/bios/kernel/dma.lua)
(fixed GP0, typed MMIO, source increment and separate completion wait) and
[`gpu/commandlist.lua`](../../machine/bios/gpu/commandlist.lua)
(DMA completion versus ordered GPU marker and two acknowledgements).
The example programs the cartridge-owned channel directly; firmware-private
modules are not advertised as cartridge exports. Static initialized RAM and BSS
follow the already executed [`memory_manual`](../memory_manual/storage.lua).
No runtime, compiler, BIOS, cartlib, publisher, encoding helper or facade was
added. Counts use the static exports `#storage.upload` and `#storage.returned`,
not the runtime length of a numeric local pointer.
