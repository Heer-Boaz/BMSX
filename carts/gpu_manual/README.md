# GPU cartridge example

The cartridge draws raw and modulated textures, an RGB-interpolated triangle,
additive rectangles, destination-mask-protected rectangles and an enlarged
palette4 strip. It reads three raw pixels back and uploads the returned words into a separate witness region.
The PCRTC publishes the resulting 256×192 picture.

## Existing BIOS precedents

This follows the actual firmware's source/storage model, not ordinary Lua tables:

- [`tty/terminal.lua`](../../machine/bios/tty/terminal.lua#L41-L73) uses typed
  ROM data, explicit BSS and whole-word command buffers.
- [`gpu/gpu.lua`](../../machine/bios/gpu/gpu.lua#L5-L11) declares typed MMIO
  pointers; its encoders write actual packet words into command storage.
- [`gpu/commandlist.lua`](../../machine/bios/gpu/commandlist.lua#L9-L16) uses an
  ordered GPU IRQ marker and acknowledges the controller and GPU latches.
- [`kernel/dma.lua`](../../machine/bios/kernel/dma.lua#L30-L36) demonstrates
  that DMA has a fixed GP0 destination and an incrementing source. This example
  instead uses scalar stores, always to the same GP0 pointer. A contiguous CPU
  word-sequence store would reach GP1 next and is not interchangeable.

The texture is a `rodata u16[4][4]`, not dynamically created pixel data.
A sixteen-entry `u16` palette and four packed `u16` index words add 40 readonly
bytes. Palette and index uploads use the same whole-word source view.
`drawing_commands` is a readonly sequence of complete packets, not a fake
register file. `readback_words` is eight bytes of explicit mutable BSS.
There is no cart-local ABI encoder, setter facade, DMA utility or allocation
needed to author this example.

## Operation and ownership

1. PCRTC CSR RESET also resets the GPU stream/register state; another GP1 RESET
   would repeat that work. The example explicitly selects the nine-bit Y gate
   and programs drawing state and a background fill. Reset does not erase VRAM.
2. The compiler packs sixteen RGB555/mask words into eight upload words. Their
   destination is raw `(640,0)`, outside the drawing/display region.
3. Each textured quad supplies direct16 page fields `010a` in T1. A following
   4×4 textured rectangle supplies no page and inherits that persistent state.
   The first quad is raw. The second uses RGB gain bytes `(64,128,192)`; its
   full-blue texels saturate, rather than becoming brighter than RGB5=31.
4. Subsequent rectangles demonstrate additive RGB and check/set-mask.
   Texture texel `0000` is transparent; `8000` is opaque black under the raw
   opaque command.
5. A separate palette at raw (768,256) and four packed index words at (704,16)
   supply a palette4 quad along the bottom. T0 CLUT `4030` and T1 page/depth `000b`
   locate them. Palette index 0 draws red, index 3 fetches transparent `0000`, and
   index 4 fetches opaque black `8000`. Raw mode ignores the zero color field.
6. A counted 3×1 readback yields `001f001f`, then `000003e0`. The complete
   second read releases the stream; its high half is zero. Re-upload ignores
   the final high half rather than treating it as a fourth pixel or command.
7. The ordered IRQ marker is acknowledged at both latches. Idle is waited for
   separately before PMODE enables the picture. Display acceptance is not
   inferred from the marker. No displayed buffer is subsequently modified.

The existing PCRTC chapter owns the display-word formats. The boot contract
provides the `irq(flags)` entry; the cartridge acknowledges its VBlank requests
and sleeps after completing the static picture.

## Execute

```sh
npm run build:toolchain:cart -- gpu_manual --debug
npm run headless:test -- gpu_manual tests/carts/gpu_manual/gpu_manual_assert.lua
```

The actual guest suite checks the retained odd-tail latch, the three-pixel
witness and twenty raw pixel probes covering gains, inherited T1, exact-zero
transparency, black bit15, additive results, destination protection and the
uploaded palette/index distinction. It captures the displayed picture under `tests/carts/gpu_manual/screenshots/`.
This is headless guest execution, not proof of native/backend parity or a
physical sustained raster rate. The complete GPU operation reference and programming chapter is in
[`docs/book1/gpu.md`](../../docs/book1/gpu.md).
