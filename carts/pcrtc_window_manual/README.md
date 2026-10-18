# PCRTC source position and display-window example

This ordinary BLua cartridge draws one 256×192 GX16 image once, then presents
three states without changing its pixels. Circuit 2 stays fixed as the full
canvas. Circuit 1 reads a 128×96 cutout:

| State | Circuit-1 source origin | Circuit-1 output origin | Change |
|---|---|---|---|
| A | (0,0) | (64,48) | Initial configuration |
| B | (32,16) | (64,48) | Only DISPFB1_HIGH |
| C | (32,16) | (96,48) | Only DISPLAY1_LOW |

The twelve coloured cells, white L, black square and small red square make the
source pixels identifiable. Both circuits read the same raw local-memory image.
The fixed second circuit keeps output dimensions at 256×192: moving a single
circuit alone would also move the cropped output origin and obscure this lesson.
No source data is copied, redrawn, cleared or reallocated for B or C.

The cartridge exclusively owns GP0, both display circuits, the direct VBlank
handler and raw coordinates `(0,0)..(255,191)`, with pitch 1024 sixteen-bit words.
The actual exported BIOS `gpu/system_vram_region` query is retained in BSS.
The chosen fixed region excludes the current installed firmware's bounding
rectangle; this does not allocate every coordinate outside that rectangle.

## Complete ordinary files

`results.lua` is a const module with typed explicit BSS. `cart.lua` is the entry
module with static readonly command words and repeated scalar stores to fixed
GP0. The manifest is `res/manifest/manifest.rommanifest`:

```yaml
title: PCRTC Source and Window Manual Example
hardware:
    - type: rom
```

From the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- pcrtc_window_manual --debug
npm run headless:test -- pcrtc_window_manual tests/carts/pcrtc_window_manual/pcrtc_window_manual_assert.lua
```

`source_and_window_are_independent` checks the three retained source/window
pairs, fixed circuit-2 words, raw white/black/red probes FFFF/8000/801F, installed
BIOS reservation words and three fresh VBlank callback observations after the
last display write. Programmed-word readback alone is not display acceptance.

## Capture ordinary playback, not the derived integration target

```sh
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/pcrtc_window_manual/pcrtc_window_manual_demo.json pcrtc_window_manual
```

The timeline captures presentation frames 1,4,7 under
`tests/carts/pcrtc_window_manual/screenshots/`. These selected points are for
this controlled program, not fixed hardware latencies. The actual captured
256×192 images are copied unmodified into the manual's figure assets. Their RGB
pixels are checked against the complete drawn scene and circuit mapping, not
against three hand-selected colour probes. The capture path's opaque PNG alpha
is not evidence for PCRTC's retained sample alpha.

## Source and production precedents

MAME's production
[V9938 owner](https://github.com/mamedev/mame/blob/master/src/devices/video/v9938.cpp)
was inspected before implementation for separation of register state, scanline
work and VBlank events. No foreign address, timing constant or scanout rule
supplies BMSX facts. BMSX paired PCRTC/GPU owners and spec leaves are authority.

Actual BMSX precedents are the typed ports in
[`gpu/gpu.lua`](../../machine/bios/gpu/gpu.lua), explicit BSS/whole-word command
storage in [`tty/terminal.lua`](../../machine/bios/tty/terminal.lua), and the
already executed [`display_manual`](../display_manual/cart.lua) cartridge's
masked stale-pending/fresh-sequence VBlank publication protocol. No private
firmware module is newly advertised as cartridge-callable.

No runtime, BIOS, compiler, renderer, publisher, helper, ABI encoder, allocation
or frame-loop framework was added. The sample assumes no concurrent reader or
writer, supervisor takeover or restoration. It is not an atomic multiword
publication protocol or a general-purpose double-buffer allocator.
