# GPU shared-edge and joint example

Standalone 256 × 192 cartridge for the
[GPU coverage comparison](../../docs/book1/gpu.md#gpu-coverage-output).
The two upper cases use additive quads: a normal shared diagonal and an inward
fourth vertex that causes overlapping writes. The lower band consists of 24
separate polylines; both segments write their common endpoint.

The brighter material gives raw RGB555 `110CH` after one write and `2218H`
after two. The geometry is rerasterized, not an enlarged capture of the earlier
six-by-two-pixel lesson. Typed MMIO and the display/IRQ sequence follow the
existing manual examples; no local ABI or runtime helper is introduced.

With the development dependencies and headless tooling built:

```sh
npm run build:toolchain:cart -- gpu_coverage_manual --debug
npm run headless:test -- gpu_coverage_manual tests/carts/gpu_coverage_manual/gpu_coverage_manual_assert.lua
```

Expect `shared_polygon_edge_and_polyline_joint: passed`. The check captures
`tests/carts/gpu_coverage_manual/screenshots/frame_00001.png` before reading
twelve complete 96-pixel quad rows and one 97-pixel joint row. Its 625 packed
GPUREAD comparisons include untouched black, doubled material and the zero
high half of the odd final read. They do not read every pixel in the image.

The captured run uses a derived integration image, not byte-identical ordinary
ROM playback. For separate ordinary playback with the headless player built:

```sh
npm run headless:game -- gpu_coverage_manual --ttl 2
```

TTL 2 is 2000 ms of virtual host time; exit alone does not validate the picture.
Neither route establishes native/accelerated parity or physical throughput.
