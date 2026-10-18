# GTE depth-cue swatches

This ordinary BLua cartridge computes four independent RTPS → NCDS samples and
draws equal 44×96 screen-space rectangles. Left to right: Z=256,384,512,768.
The same supplied normal, material, light/color matrices and far color apply to
all samples. Only the test position's depth changes; rectangle geometry does
not come from projection. This isolates the color effect, not world-size or
perspective changes.

Static typed ROM records follow the actual `gte_manual` and BIOS operand/BSS
patterns. `cartlib/gx/gte` supplies the existing layouts, mapped windows and
command constants; it is not a fabricated BIOS function. Position words are
replaced by normal words in V0 only after IR0/projection flags are retained.
NCDS uses that one retained coefficient; RTPT followed by NCDT would not create
four separately depth-cued samples.

## Ordinary execution

From the repository root, with the retained test files present before building:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- gte_cue_manual --debug
npm run headless:test -- gte_cue_manual tests/carts/gte_cue_manual/gte_cue_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_cue_manual/gte_cue_manual_demo.json gte_cue_manual
```

The guest case checks all four IR0/RGB2 results, per-command flags, unchanged
IR0 after NCDS, projected depth/screen pairs, raw GX16 probes, programmed display
words, firmware-region exclusion and a fresh VBlank callback sequence. Source
probes and immediate register reads are not proof of the entire output image.

The separate ordinary-ROM capture is native 256×192. It contains four rectangles
at X=16,76,136,196 and Y=48, on black. Every RGB pixel is checked, not just the
four center probes. Actual displayed RGB values are:

| Z | IR0 | GTE RGB2 | Raw GX16 | Displayed RGB |
|---|---|---|---|---|
| 256 | 0 | 344B519E | A553 | 156,82,74 |
| 384 | 2048 | 34755876 | B96E | 115,90,115 |
| 512 | 3072 | 348A5C63 | C56C | 99,90,140 |
| 768 | 4096 | 34A05F4F | D169 | 74,90,165 |

These displayed RGB values include ordinary GX16 channel truncation/expansion;
they are not presented as exact copies of GTE's eight-bit channels. CODE34 is
not a GP0 opcode. The cartridge emits opaque untextured 60H rectangles with
CODE masked out, dither off and stored bit15 forced on. Capture alpha FF does
not prove the separately selected PCRTC sample alpha80.

The program exclusively owns GTE, GPU ports, display configuration, its direct
VBlank handler and raw rectangle(0,0)..(255,191), with pitch1024. The actual
`gpu/system_vram_region` BIOS export reports the firmware bounding rectangle;
this chosen image is outside it, not a grant that all other memory is free.
No other reader/writer or supervisor may take over during the example. No
runtime, BIOS, compiler, renderer, publisher, local ABI encoder, allocation or
frame-loop framework is added.

## Production references

Before implementation, DuckStation's actual
[GTE owner](https://github.com/stenzek/duckstation/blob/master/src/core/gte.cpp)
was inspected for its separate projection, color interpolation and result-state
operations. The production
[PSn00bSDK GTE example](https://github.com/Lameguy64/PSn00bSDK/blob/master/examples/graphics/gte/main.c)
was inspected for authored matrix/vector storage and explicit result-to-packet
handoffs. Their APIs and hardware values do not supply BMSX facts. BMSX paired
owners, actual static operand layouts and executed cartridge are authority.
