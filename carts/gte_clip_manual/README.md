# Cartridge-defined near plane

One genuine BLua program supplies both images from one transform/projection
setup. It first submits ABC unchanged despite its divide FLAG, then constructs
D/E at the cartridge-selected plane Z=256 and submits DBC and DCE. This is one
known outside vertex and two inside vertices, not a general clipping library.

Compute the signed view-space coordinates in ordinary numeric locals. Emit
`gte_vector` records only at the transfer boundary: BLua `i16` storage reads
are raw U16LE, whereas the GTE decodes signed lanes. There is no local signed
unpacker, register-image table, runtime/compiler repair or clipping BIOS API.
The exact intersections need no fractional-coordinate rounding decision.

| RTPT inputs | SXY0 / SXY1 / SXY2 | Projection FLAG | NCLIP MAC0 |
|---|---|---|---|
| ABC | 00200080 / 008000B0 / 00800050 | 80020000 | 9216 |
| DBC | 006000A0 / 008000B0 / 00800050 | 0 | 3072 |
| DCE | 006000A0 / 00800050 / 00600060 | 0 | 2048 |

All retained IR0 values are zero. Projection FLAG is saved before NCLIP clears
it; positive area does not prove near-plane inclusion. Nominal RTPT CYCLES=23
is not total elapsed time. No command suppresses GP0 submission in this program.

The opaque RGB(64,160,224) triangle path stores GX16 F288 and displays
RGB(66,165,231). Probes (128,64)/(128,112) are F288/F288 in A and8000/F288 in B.
Separate raw surfaces at rows0–191 and256–447 keep A untouched while drawing B;
GPU idle, pending-IRQ acknowledgement and fresh VBlank observation are explicit.
Neither surface is reused. The BIOS reservation query is not a general allocator.

From the repository root, with supplied tests/timeline present before building:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_clip_manual --debug
npm run headless:test -- gte_clip_manual tests/carts/gte_clip_manual/gte_clip_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_clip_manual/gte_clip_manual_demo.json gte_clip_manual
```

The ordinary-ROM timeline captures native256×192 frames1 and4. Both images are
copied unmodified into the manual; every49,152 RGBA pixels in each is checked
against the controlled scene, not only the raw probes. Frames1/4 and the hold
are chosen observation checkpoints, not fixed hardware/display latencies.
This is TS/headless evidence, not native/backend, physical display or fresh-OS
SDK acceptance. Opaque capture alpha does not establish PCRTC sample alpha.

Before implementation the production
[PSn00bSDK GTE example](https://github.com/Lameguy64/PSn00bSDK/blob/master/examples/graphics/gte/main.c)
was inspected for authored operand storage, explicit projection/submission and
separate draw/display surfaces. It supplies no BMSX address, timing or clipping
behavior. Current paired BMSX owners and ordinary execution are the authority.
