# GEO docking-scene example

This ordinary BLua cartridge renders two textured docking drones and then makes
its explicitly authored collision hulls and actual GEO results visible. It does
not derive collision geometry from texture alpha. The geometry jobs and GPU
packets are separate; GEO does not draw the diagnostics.

## Files and authored data

- `results.lua`: concrete register/job/result layouts and explicit BSS. Every
  retained pose owns two matrices, sixteen world vertices, two AABBs, its SAT
  result, two F32 instances, a historical contact, summary and three job reports.
- `assets.lua`: the complete 16 x 16 indexed drone artwork, six raw RGB555/mask
  words, eight local Q16 vertices, transform/pair/shape records and translations.
- `cart.lua`: the IRQ entry, real scene drawing, geometry submission, typed
  texture generation/upload and six display publications.
- `res/manifest/manifest.rommanifest`: the ordinary ROM manifest.
- `../../tests/carts/geo_scene_manual/geo_scene_manual_assert.lua`: the retained
  integration case; it does not capture the ordinary playback.
- `../../tests/carts/geo_scene_manual/geo_scene_manual_demo.json`: the existing
  headless player's ordinary-ROM capture timeline.

Both drones use the same artwork, origin `(0,0)`, pivot `(8,8)` and ordered local
hull `(4,0),(12,0),(16,4),(16,12),(12,16),(4,16),(0,12),(0,4)`. Palette index zero
becomes transparent word `0000`; index one becomes visible black word `8000`.
The cartridge expands each indexed pixel into 4 x 4 equal texels in a typed
64 x 64 `u16` BSS image. The texture is uploaded unchanged; blue and red sprite
colors come from separate modulation packet fields, not different hulls.

## Storage and display ownership

The isolated example owns GP0, PCRTC circuit 1, the GEO job registers and IRQ
sources VBlank/GEO_DONE/GEO_ERROR. It does not restore the firmware console or
serve another cartridge subsystem. The BIOS `gpu/system_vram_region` import
reports the installed firmware reservation; the retained suite checks its
current packed origin `02D002C0` and size `00FC0140`.

| Allocation | Raw VRAM rectangle | Use |
|---|---|---|
| A | `(0,0)` through `(255,191)` | 256 x 192 GX16 framebuffer |
| B | `(0,256)` through `(255,447)` | Second framebuffer |
| Texture | `(640,0)` through `(703,63)` | Shared 64 x 64 direct16 drone |

These rectangles do not overlap one another or the current firmware region.
The framebuffer words are `000FA000` and `000FA040`. E1 `E100050A` selects
texture page `(640,0)` and direct16; each sprite uses UV `(0,0)` and size
`00400040`. The A0 upload streams 2048 payload words to the same GP0 address.
Each word contains two adjacent raw texels. Nothing treats incrementing MMIO
register addresses as a GP0 command array.

A scene is built only into the alternate surface. E3/E4/E5 explicitly select
its drawing bounds and integer offset. The fill packet ignores that offset,
so its raw destination is separately `(0,buffer_y)`. The cartridge waits for
GPU idle, masks IRQ delivery, writes the final framebuffer/PMODE words,
acknowledges stale VBlank, records the sequence while masked, unmasks and waits
for a fresh VBlank callback. GPU idle is not used as proof of publication.

## Local, world and screen coordinates

The local view places the sprite origin at display `(96,64)` with four pixels
per local unit. Gray axes start there. Cyan lines are the authored hull; the
white cross at display `(128,96)` marks the central pivot `(8,8)`.

In game views, display coordinates are `(32 + 4*x, 64 + 4*y)`. A has world
translation `(0,0)`; B uses `(20,0)`, `(16,0)` or `(12,0)`. The two identity
matrices translate local Q16 vertices into the retained world pools. Drawing
reads those completed world vertices, not separately guessed sprite bounds.
All these scene coordinates are nonnegative exact integers; the drawing code
is not a general signed/fractional Q16 graphics conversion library.

## Geometry sequence and retained results

For each pose:

1. Write two identity/translation matrices and matching F32 instance translations.
2. Submit two XFORM2 records with eight vertices each, then wait for the distinct
   GEO completion sequence. Retain `STATUS`, `PROCESSED`, `FAULT`.
3. Submit SAT2 against that completed Q16 world pool. Wait again and retain its
   five words and completion report.
4. Submit one candidate OVERLAP2D job against a separate typed F32 polygon and
   instances. The polygon is staged with F32 stores, not a Q16 reinterpretation.
   Its data offset is 32 bytes and bounds offset 16 bytes. Capacity is one.
5. Retain the completed summary and copy all nine contact words into that pose's
   historical storage. The summary, not existing slot bytes, determines validity.

| B world x | SAT `(hit,nx,ny,depth,meta)` as words | F32 summary `(count,exact,broad,flags)` |
|---|---|---|
| 20 | `(0,0,0,0,0)` | `(0,0,1,0)` |
| 16 | `(1,00010000,0,0,2)` | `(0,1,1,0)` |
| 12 | `(1,00010000,0,00040000,2)` | `(1,1,1,0)` |

The overlapping F32 record is normal `(-1,0)`, depth `4`, point `(14,8)`, pieces
`(0,0)`, feature `2`, and authored pair metadata `44524F4E`. SAT's normal points
A toward B; this OVERLAP2D normal points B toward A. Touching has a SAT hit with
zero depth but no F32 contact record.

The yellow bracket at y=136 depicts the actual winning X-projection depth: for
B x=12 it runs from display x=80 to x=96, a 16-pixel span for four game units.
The green SAT direction arrow is deliberately anchored below A at `(64,144)`;
SAT supplies no contact point. The magenta OVERLAP2D direction arrow starts at
the actual point, display `(88,96)`, also marked by a white cross. Both direction
arrows are drawn 24 pixels long (six game units) for visibility, **not** scaled
to penetration depth. Cyan/amber outlines identify A/B independently of arrows.
The arrowheads and X-projection bracket are specific to these horizontal poses.

## Six visible phases

| Phase | Timeline frame | Displayed role |
|---|---:|---|
| 1 | 4 | Local asset, hull, axes and pivot |
| 2 | 13 | Plain separated dummy game, no collision overlays |
| 3 | 22 | Separated world-hull diagnostics |
| 4 | 31 | Touching: zero-depth SAT hit, green direction, no contact cross |
| 5 | 40 | Overlap: actual depth bracket, both directions and actual contact |
| 6 | 49 | Separated return: no stale contact marker |

Each phase is held for eight fresh VBlank callbacks after its publication.
These counts and capture frames are authored demo/capture choices, not a GEO,
GPU, PCRTC, bus-bandwidth or physical throughput specification.

Before phase 6, the cartridge reruns the separated candidate using the **same**
live contact output slot that still contains the overlapping point `(14,8)`.
The new summary count is zero. Drawing checks that completed count and does
not draw the old cross or normal. It does not clear the old contact to simulate
absence. The original three pose snapshots remain retained separately.

## Build, execute and capture

From the repository root:

```sh
npm run validate:toolchain:cart -- geo_scene_manual --debug
npm run headless:test -- geo_scene_manual tests/carts/geo_scene_manual/geo_scene_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/geo_scene_manual/geo_scene_manual_demo.json geo_scene_manual
```

The integration case checks all 48 transformed vertices, all 24 AABB words,
three SAT results, three summaries, the overlapping contact, ten job reports,
six fresh-publication sequences, selected typed texture words and the retained
old contact with new zero count. It runs a derived integration image, not the
byte-identical ordinary ROM. Its passing assertions alone do not prove pictures.

The separate timeline runs the ordinary ROM and writes six 256 x 192 images to
`tests/carts/geo_scene_manual/screenshots/frame_00004.png`, `frame_00013.png`,
`frame_00022.png`, `frame_00031.png`, `frame_00040.png` and `frame_00049.png`.
Actual image inspection is required to accept those pictures. This bounded
example does not establish native/accelerated-backend parity, arbitrary hull
winding, rotations, general signed/fractional conversion, malformed geometry,
clipping capacity, sustained timing or collision-response physics.
