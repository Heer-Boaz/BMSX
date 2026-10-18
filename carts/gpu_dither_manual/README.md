# GPU dither comparison

A separate static-picture cartridge, not an addition to `gpu_manual`.
See the [GPU dither comparison](../../docs/book1/gpu.md#gpu-dither-output)
for the hardware explanation, complete listing and actual output plate.
The upper pair uses one modulated textured quad with dithering off and one
with it on. The lower pair uses textured rectangles as the unchanged control.
All four read the same RGB555 material; a uniform 96 × 64 source fill makes
rectangle U/V traversal explicit rather than relying on untouched VRAM.

The source uses the existing firmware's typed MMIO/readonly packet idioms;
no local GPU ABI, encoding helper or runtime register table is introduced.
It preserves firmware VRAM and separates the command marker, idle wait and
display publication as in the existing GPU example.

With the development dependencies and headless tooling built:

```sh
npm run build:toolchain:cart -- gpu_dither_manual --debug
npm run headless:test -- gpu_dither_manual tests/carts/gpu_dither_manual/gpu_dither_manual_assert.lua
```

Expect `polygon_dither_and_rectangle_controls: passed`. The fixture captures
`tests/carts/gpu_dither_manual/screenshots/frame_00001.png`, then reads five
4 × 4 blocks: the four panel origins and the source patch. It compares forty
packed GPUREAD words. This derived integration image contains the ordinary
entry and fixture; it is not byte-identical playback of the ordinary ROM.

For separate ordinary playback with the debug headless player built:

```sh
npm run headless:game -- gpu_dither_manual --ttl 2
```

TTL 2 ends after 2000 ms of virtual host time. That exit alone does not check
the picture or raw words. The execution and image do not establish native or
accelerated-backend parity, or a physical GPU throughput guarantee.
