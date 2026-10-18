# GTE depth-cue and material comparisons

One ordinary BLua cartridge uses the same typed ROM/BSS setup for two actual
images. No duplicated initialization, synthetic picture or local ABI helper is
needed. The complete program is 221 entry lines plus 29 const/BSS lines.

## A: depth cue

Four independent RTPS→NCDS pairs at Z256,384,512,768 retain IR0, both per-command
FLAGS and RGB2. The same supplied normal/material/light/color/ambient/far operands
apply to every row. Fixed44×96 screen-space rectangles isolate color, not
perspective size. IR0 is one register, not a per-vertex FIFO.

| Z | IR0 | GTE RGB2 | Raw GX16 | Displayed RGB |
|---|---|---|---|---|
|256|0|344B519E|A553|156,82,74|
|384|2048|34755876|B96E|115,90,115|
|512|3072|348A5C63|C56C|99,90,140|
|768|4096|34A05F4F|D169|74,90,165|

## B: same light, different material

Without changing normal/L/K/ambient, NCS produces the unmodulated light/color
reference, then NCCS applies material A and B. NCS ignores the input RGB bytes,
not CODE; neither command consumes IR0. CODE34 is excluded from GP0 opcode60.
All FLAGS00400000 describe negative-light IR3 saturation, not summaryERROR.

| Case | GTE RGB2 | Raw GX16 | Displayed RGB |
|---|---|---|---|
|NCS reference|3464D9FC|B37F|255,222,99|
|NCCS A|344B519E|A553|156,82,74|
|NCCS B|343EA33F|9E87|57,165,57|

The first surface is raw(0,0)..(255,191), the second(0,256)..(255,447), pitch1024.
After two callback increments for viewing A, the program masks delivery and
draws only B with E3/E4 bounds and E5 offsetY256. Both clear and swatches use60H;
02Hfill ignores that drawing offset/mask state. Three56×96 swatches are at
relativeX20,100,180/Y48; C0 centers use absoluteY352. SourceHIGH stays0; changing
onlyFBP0→64 (000FA000→000FA040) selects B after GPUidle and a fresh VBlank.
No surface is subsequently reused; this is not a generic release protocol.

## Build, assert and capture

Keep the supplied test/timeline files present before the debug build. From the
repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_cue_manual --debug
npm run headless:test -- gte_cue_manual tests/carts/gte_cue_manual/gte_cue_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_cue_manual/gte_cue_manual_demo.json gte_cue_manual
```

The existing case `depth_cue_and_display_words` checks all depth/material rows,
per-command flags, unchanged IR0, both raw surfaces and original-depth probes,
firmware exclusion and both fresh callback sequences. Immediate register reads,
raw probes, GPUidle and display observations are different evidence.

The separate ordinary timeline captures frames1/4 under
`tests/carts/gte_cue_manual/screenshots/`. Actual frame1 is byte-identical to the
accepted original depth plate. Every49,152 RGBA pixels of frame4 are independently
checked against the three-rectangle scene, not just center probes. Both PNGs are
copied unmodified into the manual. Their opaque capture alphaFF does not prove
PCRTC samplealpha80. These selected frames are not fixed hardware latencies.

## Ownership and precedents

The program owns GTE/GPU/display, its direct VBlank handler and both surfaces.
The actual BIOS `gpu/system_vram_region` query excludes the chosen raw footprint;
this is not an allocator or a promise every other coordinate is free. No other
reader/writer or supervisor may take over. Typed records and transfers follow
actual BIOS storage patterns and `cartlib/gx/gte`; no invented BIOS GTE setter.

Before this extension, the production
[PSn00bSDK GTE example](https://github.com/Lameguy64/PSn00bSDK/blob/master/examples/graphics/gte/main.c)
was inspected for separate authored operands, drawing and display buffers, and
explicit hand-off order. Earlier DuckStation GTE study is retained in the
baseline cue review. Foreign APIs, addresses and timing do not supply BMSX facts.
Paired BMSX owners and the ordinary executed cartridge are authority. No runtime,
compiler, BIOS, renderer, publisher, framework, encoder or frame-loop helper is
added; no native/accelerated/physical-display or fresh-OS acceptance is claimed.
