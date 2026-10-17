# Shared display storage example

The ordinary cartridge shows three poses using two GX16 regions:

1. A at raw `(0,0)`: red, white square at display `(16,64)`.
2. B at raw `(0,256)`: blue, square at display `(208,64)`. While B is
   selected, the cartridge rebuilds A in green with a square at `(112,80)`.
3. A is selected again: the reused storage displays green, not its old red.

Both regions are 256 × 192 with a 1,024-word row stride. This isolated example
owns GP0, circuit 1 and its direct VBlank handler. It assumes no supervisor
takeover or other reader/writer of those regions. It is not an allocator or a
general frame-loop framework. It calls the exported BIOS
`gpu/system_vram_region` function and retains its two result words; the fixed
regions do not overlap the current installed firmware's bounding rectangle.
This does not grant ownership of every other VRAM coordinate.

`results.lua` supplies explicit typed BSS. `cart.lua` is the complete ordinary
entry, with readonly whole-word packets and scalar stores to fixed GP0.
The existing BIOS `gpu/gpu.lua` provides the typed-port and display-address
programming precedent, not another cartridge-callable function import.

## Build and check retained results

From the repository root, after the existing headless-tooling build:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- display_manual --debug
npm run headless:test -- display_manual tests/carts/display_manual/display_manual_assert.lua
```

Expect `[test] publication_and_two_surface_reuse: passed`. The derived
integration target checks the four retained one-pixel GPUREAD words
`001f / 7c00 / 03e0 / 7c00`, programmed framebuffer words A/B/A, all three
fresh-after-write callback observations, phases and the current BIOS query.
It does not capture or certify the displayed images.

## Capture actual ordinary playback

```sh
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/display_manual/display_manual_demo.json display_manual
```

The timeline runs the ordinary ROM, not the derived integration image. It
captures presentation frames 1, 4 and 7 under
`tests/carts/display_manual/screenshots/`: `frame_00001.png`,
`frame_00004.png`, `frame_00007.png`. These are chosen capture points for this
program, not a physical timing or throughput rating. All three current
256 × 192 outputs have been individually viewed and checked pixel-for-pixel.

The cartridge waits for GPU readback readiness and drains each requested word,
then waits GPU idle separately. For each display change it masks delivery,
writes the final display word, clears stale VBlank pending, records the
callback sequence while masked, unmasks VBlank and waits for a change. This
is a controlled fresh-publication observation, not an atomic multiword swap,
pixel snapshot, per-surface release interrupt or proof that other readers
have stopped using that surface.

Hardware exposition and complete listings belong in
[`docs/book1/memory.md`](../../docs/book1/memory.md); observation commands are
also documented in the programming companion. No native/backend parity,
arbitrary alias safety or supervisor restoration is established by this case.
